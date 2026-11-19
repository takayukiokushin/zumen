/**
 * 画面の検査（機器 × 画面の大きさ・文字の大きさ × 言語 × 明るさ）：全部の画面で、
 *   ・横にはみ出さない（画面全体・ボタンなど）
 *   ・指で押す端末（スマホ・タブレット）で、押す部品が、縦も横も44ピクセル以上
 *   ・文字が、箱からはみ出して切れていない
 *   ・画面の中でエラーが出ない
 * ことを、実際に画面を開いて確かめる（全体デバッグ 直し9）。
 *
 *   pnpm build          （画面を先に組み立てておく）
 *   pnpm screens        ふつうの検査（約17通り）
 *   pnpm screens -- --full   たくさん（約60通り。`pnpm fuzz` が使う）
 *
 * 試験用の一時フォルダの中だけで動かす（本物の案件・APIキーには触らない）。
 * ブラウザを動かす道具（Playwright）が無い端末では、そのことを知らせて、飛ばす（失敗にはしない）。
 *
 *   node --experimental-strip-types scripts/check-screens.ts [--full]
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answersSpread } from './check-drawing/common.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FULL = process.argv.includes('--full');
const require = createRequire(import.meta.url);

console.log('■ 画面の検査（機器 × 大きさ × 言語 × 明るさ）');

let pw: { chromium: { launch: (o?: object) => Promise<any> } };
try {
  pw = require('playwright');
} catch {
  console.log('  ブラウザを動かす道具（Playwright）が見つからないので、この検査は飛ばしました。');
  process.exit(0);
}
if (!existsSync(resolve(ROOT, 'apps/web/dist/index.html'))) {
  console.error('  NG: 画面が組み立てられていません。先に「pnpm build」を行ってください。');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise<number>((done, bad) => {
    const s = createServer();
    s.once('error', bad);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => done(port));
    });
  });
const runNode = (args: string[], env: NodeJS.ProcessEnv) =>
  new Promise<number>((done) => {
    const p = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
    p.on('close', (c) => done(c ?? 1));
  });

/* ---------- 試験用のサーバー ---------- */
const dataDir = mkdtempSync(join(tmpdir(), 'zumen-screens-'));
const env = { DATA_DIR: dataDir, ANTHROPIC_API_KEY: '' };
const USER = 'screens';
const PASS = 'Zq7-kelp-orbit-93';
let server: ChildProcess | null = null;
const cleanup = () => {
  try {
    server?.kill();
  } catch {}
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {}
};
process.on('exit', cleanup);

let failed = 0;
const problems: string[] = [];

try {
  if ((await runNode(['apps/server/src/cli.ts', 'add', USER, '画面検査', PASS, 'admin'], env)) !== 0) throw new Error('試験用の利用者を作れませんでした');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], { cwd: ROOT, env: { ...process.env, ...env, PORT: String(port) }, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(500);
    up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
  }
  if (!up) throw new Error('サーバーが起動しませんでした');
  // 案件を1つ作る（複数エリアのある回答で、図面にも部品が並ぶ）
  const lr = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: USER, password: PASS }) });
  const cookie = (lr.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const cr = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: '画面検査の案件', answers: answersSpread }) });
  if (!cr.ok) throw new Error('試験用の案件を作れませんでした');
  // 1つずつ開く方式（白紙から）の案件：入力の途中の、下の余白の検査に使う（第17弾 項目4）
  const cr2 = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: '余白の検査', answers: { startMode: 'blank' } }) });
  if (!cr2.ok) throw new Error('試験用の案件（白紙）を作れませんでした');

  /* ---------- 検査する組み合わせ ---------- */
  type Combo = { dev: string; w: number; h: number; touch: boolean; theme: 'light' | 'dark'; lang: string; scale: number };
  const DEV: Record<string, [number, number, boolean]> = { phone: [390, 844, true], phoneS: [360, 740, true], phoneL: [844, 390, true], tablet: [820, 1180, true], tabletL: [1180, 820, true], pc: [1280, 800, false] };
  const mk = (dev: string, lang: string, scale: number, theme: 'light' | 'dark' = 'light'): Combo => ({ dev, w: DEV[dev]![0], h: DEV[dev]![1], touch: DEV[dev]![2], theme, lang, scale });
  let combos: Combo[] = [
    mk('phone', 'ja', 1), mk('phone', 'ja', 1.3), mk('phone', 'en', 1.3), mk('phone', 'fr', 1.3, 'dark'), mk('phone', 'zh', 1), mk('phone', 'ko', 1.3),
    mk('phoneS', 'ja', 1), mk('phone', 'ja', 1.6),
    mk('tablet', 'ja', 1), mk('tablet', 'en', 1.3), mk('tabletL', 'ja', 1, 'dark'), mk('tablet', 'fr', 1.6),
    mk('phoneL', 'ja', 1), mk('phoneL', 'ja', 1.3), mk('phoneL', 'fr', 1.6),
    mk('pc', 'ja', 1), mk('pc', 'en', 1.6),
  ];
  if (FULL) {
    const langs = ['ja', 'en', 'fr', 'zh', 'ko'];
    const more: Combo[] = [];
    for (const dev of Object.keys(DEV)) for (const lang of langs) for (const scale of dev === 'pc' ? [0.6, 1, 1.6] : [1, 1.3]) more.push(mk(dev, lang, scale, (more.length % 3 === 0 ? 'dark' : 'light')));
    const key = (c: Combo) => `${c.dev}/${c.lang}/${c.scale}/${c.theme}`;
    const seen = new Set(combos.map(key));
    combos = [...combos, ...more.filter((c) => !seen.has(key(c)))];
  }

  const browser = await pw.chromium.launch();
  const measure = (page: any, touch: boolean) =>
    page.evaluate((touch: boolean) => {
      const vw = window.innerWidth;
      const out = { docOverflow: document.documentElement.scrollWidth > vw + 1, over: [] as string[], small: [] as string[], clipped: [] as string[] };
      const inScroller = (el: Element) => {
        for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
          const s = getComputedStyle(e);
          if (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth) return true;
        }
        return false;
      };
      for (const el of Array.from(document.querySelectorAll('button, input, select, textarea, a, [role=tab]'))) {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none') continue;
        const t = (el as HTMLInputElement).type;
        const label = ((el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.id || el.tagName) + '').trim().slice(0, 14);
        if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) out.over.push(`${label}@${Math.round(r.left)}-${Math.round(r.right)}`);
        if (touch && (r.height < 43.5 || r.width < 43.5) && el.tagName !== 'A' && !['checkbox', 'radio', 'file', 'range'].includes(t) && !el.closest('svg') && el.tagName !== 'TEXTAREA') out.small.push(`${label}:${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      for (const el of Array.from(document.querySelectorAll('button, label, h1, h2, h3, th, td, p'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const s = getComputedStyle(el);
        if (el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis') out.clipped.push(((el.textContent || '') + '').trim().slice(0, 14));
      }
      out.over = [...new Set(out.over)].slice(0, 5);
      out.small = [...new Set(out.small)].slice(0, 5);
      out.clipped = [...new Set(out.clipped)].slice(0, 4);
      return out;
    }, touch);

  let screens = 0;
  for (const c of combos) {
    const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, hasTouch: c.touch, isMobile: false });
    await ctx.addInitScript(([lang, theme, scale]: [string, string, number]) => {
      try {
        localStorage.setItem('zumen.helpSeen', '1');
        localStorage.setItem('zumen.display', JSON.stringify({ lang, theme, textScale: scale, uiScale: scale, bold: false }));
      } catch {}
    }, [c.lang, c.theme, c.scale]);
    const page = await ctx.newPage();
    page.setDefaultTimeout(6000);
    const errs: string[] = [];
    page.on('pageerror', (e: Error) => errs.push(e.message.slice(0, 100)));
    page.on('console', (m: any) => {
      if (m.type() === 'error') errs.push(String(m.text()).slice(0, 100));
    });
    const name = `${c.dev}・${c.lang}・${Math.round(c.scale * 100)}%・${c.theme === 'dark' ? '暗' : '明'}`;
    const rec = (screen: string, m: Awaited<ReturnType<typeof measure>>) => {
      screens++;
      const bits = [m.docOverflow ? '画面が横にはみ出す' : '', m.over.length ? `はみ出す部品 ${m.over.join('、')}` : '', m.small.length ? `44px未満 ${m.small.join('、')}` : '', m.clipped.length ? `文字が切れる ${m.clipped.join('、')}` : ''].filter(Boolean);
      if (bits.length > 0) {
        failed++;
        problems.push(`${name}／${screen}：${bits.join('／')}`);
      }
    };
    try {
      await page.goto(base);
      await sleep(400);
      rec('ログイン', await measure(page, c.touch));
      await page.fill('#login-id', USER);
      await page.fill('#login-pw', PASS);
      await page.click('button[type=submit]');
      await sleep(1100);
      await page.locator('button', { hasText: /閉じる|Close|Fermer|关闭|닫기/ }).first().click({ timeout: 400 }).catch(() => {});
      rec('一覧', await measure(page, c.touch));
      await page.locator('button.job-open').first().click({ timeout: 2000, force: true }).catch(() => {});
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      const tabs = page.locator('.tabbar > button, .tabbar .tab-wrap > button');
      const n = await tabs.count();
      const names = ['読み取り', '音声', '入力', '図面'];
      for (let i = 0; i < Math.min(4, n); i++) {
        await tabs.nth(i).click({ force: true, timeout: 1500 }).catch(() => {});
        await sleep(800);
        rec(`${names[i]}のタブ`, await measure(page, c.touch));
      }
      if (n === 0) {
        failed++;
        problems.push(`${name}：タブが見つかりません`);
      }
      await page.locator('.icon-btn').nth(1).click({ timeout: 1500, force: true }).catch(() => {});
      await sleep(600);
      rec('設定', await measure(page, c.touch));
      await page.keyboard.press('Escape');
      await sleep(300);
      // 入力の途中の、下の余白：入力欄を表示している枠の高さの、半分（もとからある下の余白は、引いた分）。画面の大きさ・文字の大きさが変わっても、そうなっていること
      await page.goto(base);
      await sleep(900);
      await page.locator('button', { hasText: /閉じる|Close|Fermer|关闭|닫기/ }).first().click({ timeout: 400 }).catch(() => {});
      await page.locator('tr', { hasText: '余白の検査' }).first().locator('button.job-open').click({ timeout: 2000, force: true }).catch(() => {});
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      await page.locator('.tabbar > button, .tabbar .tab-wrap > button').nth(2).click({ force: true, timeout: 1500 }).catch(() => {});
      await sleep(900);
      const pad = await page.evaluate(() => {
        const form = document.querySelector('main.form') as HTMLElement | null;
        const padEl = document.querySelector('.step-pad') as HTMLElement | null;
        if (!form) return null;
        const sc = /(auto|scroll)/.test(getComputedStyle(form).overflowY) ? form : ((form.closest('.app') as HTMLElement | null) ?? form);
        const zoom = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
        return { has: !!padEl, h: padEl ? padEl.getBoundingClientRect().height / zoom : 0, want: Math.max(0, sc.clientHeight / 2 - parseFloat(getComputedStyle(form).paddingBottom)), short: document.documentElement.dataset.short === 'on', formTop: form.getBoundingClientRect().top, vh: window.innerHeight };
      });
      // 使える高さが小さい画面（コンパクト表示）：上の帯が、高さの55%を超えない（入力欄が、高さの45%以上、見える）。実効幅700px以下の狭い画面は、全体が上下に動く作りなので、対象外
      if (pad && pad.short && c.w / c.scale > 700) {
        screens++;
        if (pad.formTop / pad.vh > 0.55) {
          failed++;
          problems.push(`${name}／入力：上の帯が高すぎます（画面の高さの${Math.round((pad.formTop / pad.vh) * 100)}%。入力欄が、${Math.round((1 - pad.formTop / pad.vh) * 100)}%しか見えません）`);
        }
      }
      // 画面がせまい・大きく拡大していて、入力欄そのものが開けなかったとき（上の帯だけで画面が埋まる）は、調べない
      if (pad) screens++;
      if (pad && !pad.has) {
        failed++;
        problems.push(`${name}／入力の途中：下の余白がありません`);
      } else if (pad && Math.abs(pad.h - pad.want) > 3 && pad.want > 0) {
        failed++;
        problems.push(`${name}／入力の途中：下の余白の大きさが、枠の高さの半分になっていません（${Math.round(pad.h)}／${Math.round(pad.want)}）`);
      }
      // 左の目次・右の「今の構成」の幅（第17弾 項目5）：取っ手をドラッグすると幅が変わる／ダブルクリックで元の幅／再読み込みしても覚えている。
      // 実効幅が 900px 以下の画面は、枠が縦に並ぶ（出ない）ので、取っ手そのものを出さない
      if (pad && c.w / c.scale > 900) {
        const showPanels = async () => {
          const tg = page.locator('button.panel-toggle');
          for (let i = 0; i < (await tg.count()); i++) if ((await tg.nth(i).getAttribute('aria-pressed')) === 'true' && (await tg.nth(i).isEnabled())) await tg.nth(i).click({ force: true });
          await sleep(400);
        };
        const navW = () => page.evaluate(() => (document.querySelector('.app > .nav') as HTMLElement | null)?.getBoundingClientRect().width ?? -1);
        await showPanels();
        screens++;
        const z = c.scale;
        const innerW = c.w;
        const w0 = await navW();
        const hb = await page.locator('.nav-handle').boundingBox({ timeout: 1500 }).catch(() => null);
        if (!hb || w0 < 0) {
          failed++;
          problems.push(`${name}／入力：目次の幅の取っ手が見つかりません`);
        } else {
          await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
          await page.mouse.down();
          await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2, { steps: 4 });
          await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2, { steps: 4 });
          await page.mouse.up();
          await sleep(300);
          const w1 = await navW();
          if (Math.abs(w1 - w0 - 60) > 2 && Math.abs(w1 - w0) < 20) {
            failed++;
            problems.push(`${name}／入力：取っ手をドラッグしても、目次の幅が変わりません（${Math.round(w0)}→${Math.round(w1)}）`);
          }
          // 再読み込みしても、同じ幅
          await page.reload();
          await sleep(1000);
          await page.locator('button', { hasText: /閉じる|Close|Fermer|关闭|닫기/ }).first().click({ timeout: 400 }).catch(() => {});
          await page.locator('tr', { hasText: '余白の検査' }).first().locator('button.job-open').click({ timeout: 2000, force: true }).catch(() => {});
          await sleep(900);
          await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
          await page.locator('.tabbar > button, .tabbar .tab-wrap > button').nth(2).click({ force: true, timeout: 1500 }).catch(() => {});
          await sleep(900);
          await showPanels();
          const w2 = await navW();
          if (Math.abs(w2 - w1) > 2) {
            failed++;
            problems.push(`${name}／入力：再読み込みすると、目次の幅が元に戻っています（${Math.round(w1)}→${Math.round(w2)}）`);
          }
          // ダブルクリックで、元の幅（220）
          await page.locator('.nav-handle').dblclick({ timeout: 1500, force: true }).catch(() => {});
          await sleep(300);
          const w3 = await navW();
          // 元の幅は220。ただし、入力欄を480px以上に保つため、「今の構成」（最小220）を狭めても入りきらない画面（実効幅が900px台）では、入る幅まで
          const want = Math.min(220, Math.max(160, innerW / z - 480 - 220));
          if (Math.abs(w3 - want * z) > 2) {
            failed++;
            problems.push(`${name}／入力：ダブルクリックしても、目次の幅が元（${Math.round(want)}）に戻りません（${Math.round(w3 / z)}）`);
          }
        }
      }
      await page.locator('.icon-btn').nth(0).click({ timeout: 1500, force: true }).catch(() => {});
      await sleep(600);
      rec('使い方', await measure(page, c.touch));
    } catch (e) {
      failed++;
      problems.push(`${name}：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 80)}）`);
    }
    if (errs.length > 0) {
      failed++;
      problems.push(`${name}：画面の中でエラーが出ました（${[...new Set(errs)].slice(0, 2).join(' | ')}）`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`  ${combos.length}通り・${screens}画面を調べた（${FULL ? 'たくさん' : 'ふつう'}の検査）`);
} catch (e) {
  failed++;
  problems.push(`検査の準備で止まりました：${String((e as Error)?.message ?? e)}`);
} finally {
  cleanup();
}

for (const p of problems) console.error(`  NG: ${p}`);
console.log(failed === 0 ? '\n✓ 画面の検査は、問題ありませんでした' : `\n✗ ${failed}件の問題があります`);
process.exit(failed === 0 ? 0 : 1);
