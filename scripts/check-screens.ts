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
import { digest, fromLayout, moveItem, replaceSymbol } from '../apps/web/src/editor/doc.ts';
import { buildComposition, dropHiddenChoices, effectiveAnswers } from '../packages/knowledge/src/index.ts';
import { hvStretches } from '../apps/web/src/editor/hvCable.ts';
import { layout } from '../packages/layout/src/index.ts';

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
  // 図面を保存しておく（図面のタブが、空でなく、記号の並んだ図面を開くように。拡大・スクロールの検査に使う）
  {
    const created = (await cr.json()) as { id: string; updatedAt: string };
    const comp = buildComposition(answersSpread);
    const basis = digest(JSON.stringify(comp.map((i) => [i.role, i.symbolId, i.label, i.unit ?? 0])));
    const drawing = { ...fromLayout(layout(comp, answersSpread), basis), edited: true };
    const pr = await fetch(`${base}/api/projects/${created.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: '画面検査の案件', answers: answersSpread, drawing, baseUpdatedAt: created.updatedAt, force: true }) });
    if (!pr.ok) throw new Error('試験用の案件に、図面を保存できませんでした');
  }
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
      // 複数エリアの案件を、名前で開く（一覧の先頭は、あとから作った「余白の検査」の案件になるため）
      await page.locator('tr', { hasText: '画面検査の案件' }).first().locator('button.job-open').click({ timeout: 2000, force: true }).catch(() => {});
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      const tabs = page.locator('.tabbar > button, .tabbar .tab-wrap > button');
      const n = await tabs.count();
      const names = ['読み取り', '音声', '入力', '図面'];
      for (let i = 0; i < Math.min(4, n); i++) {
        await tabs.nth(i).click({ force: true, timeout: 1500 }).catch(() => {});
        await sleep(800);
        rec(`${names[i]}のタブ`, await measure(page, c.touch));
        // 図面のタブ：拡大しても、図面の左右・上下の端まで、スクロールで行ける（大きい図面の左側が、枠の外にはみ出して見えなくならない。第18弾 B-1）
        if (names[i] === '図面') {
          // Ctrl＋ホイールの拡大縮小は、カーソルの位置を中心に行う（カーソルを置いた記号が、拡大・縮小のあとも、カーソルの下に残る。第18弾 B-2）
          if (!c.touch) {
            await page.waitForSelector('svg.canvas g.item', { timeout: 4000 }).catch(() => {});
            const cands = await page.evaluate(() => {
              const wr = document.querySelector('.canvas-wrap') as HTMLElement | null;
              if (!wr) return [];
              const a = wr.getBoundingClientRect();
              return Array.from(document.querySelectorAll('svg.canvas g.item'))
                .map((g, k) => {
                  const r = g.getBoundingClientRect();
                  return { k, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
                })
                .filter((o) => o.w > 6 && o.x > a.left + 40 && o.x < a.right - 40 && o.y > a.top + 40 && o.y < a.bottom - 40)
                .sort((p, q) => Math.hypot(p.x - (a.left + a.right) / 2, p.y - (a.top + a.bottom) / 2) - Math.hypot(q.x - (a.left + a.right) / 2, q.y - (a.top + a.bottom) / 2));
            });
            // 枠の真ん中から、いちばん遠い記号で試す（真ん中に近いと、中心がずれていても、ずれが小さくて、見つからない）
            const pick = cands[cands.length - 1];
            if (pick) {
              await page.mouse.move(pick.x, pick.y);
              await page.keyboard.down('Control');
              await page.mouse.wheel(0, -100);
              await sleep(150);
              await page.mouse.wheel(0, -100);
              await sleep(250);
              await page.keyboard.up('Control');
              const gap = await page.evaluate(({ k, x, y }: { k: number; x: number; y: number }) => {
                const g = document.querySelectorAll('svg.canvas g.item')[k];
                if (!g) return null;
                const r = g.getBoundingClientRect();
                return Math.hypot(r.x + r.width / 2 - x, r.y + r.height / 2 - y);
              }, pick);
              screens++;
              if (gap !== null && gap > 4) {
                failed++;
                problems.push(`${name}／図面：Ctrl＋ホイールで拡大したとき、カーソルの位置を中心にしていません（カーソルの下の記号が、${Math.round(gap)}pxずれました）`);
              }
            }
          }
          const zin = page.locator('.zoom-group button').nth(1);
          for (let k = 0; k < 6; k++) {
            if (!(await zin.isVisible().catch(() => false)) || (await zin.isDisabled().catch(() => true))) break;
            await zin.click({ force: true, timeout: 1000 }).catch(() => {});
            await sleep(120);
          }
          const reach = await page.evaluate(() => {
            const wr = document.querySelector('.canvas-wrap') as HTMLElement | null;
            const sv = wr?.querySelector('svg.canvas') as SVGElement | null;
            if (!wr || !sv) return null;
            wr.scrollLeft = 0;
            wr.scrollTop = 0;
            const a = wr.getBoundingClientRect();
            const s0 = sv.getBoundingClientRect();
            const left = s0.left - a.left;
            const top = s0.top - a.top;
            wr.scrollLeft = wr.scrollWidth;
            wr.scrollTop = wr.scrollHeight;
            const s1 = sv.getBoundingClientRect();
            return { left, top, right: a.right - s1.right, bottom: a.bottom - s1.bottom };
          });
          screens++;
          if (reach && (reach.left < -1 || reach.top < -1 || reach.right < -1 || reach.bottom < -1)) {
            failed++;
            problems.push(`${name}／図面：拡大すると、図面の端まで、スクロールで行けません（左${Math.round(reach.left)}・上${Math.round(reach.top)}・右${Math.round(reach.right)}・下${Math.round(reach.bottom)}。マイナスの分が見えません）`);
          }
        }
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
  // 作り直したとき、手で動かした記号が重なっていたら、その記号を、赤い点線で囲み、お知らせを閉じると、消える（第18弾 C-5）
  {
    const created3 = await (
      await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: '重なりの検査', answers: answersSpread }) })
    ).json() as { id: string; updatedAt: string };
    const comp3 = buildComposition(answersSpread);
    const gen3 = fromLayout(layout(comp3, answersSpread), 'stale');
    const tops = gen3.items.filter((i) => i.kind === 'symbol' && !i.parent && i.y > 100) as { id: string; x: number; y: number }[];
    const moved3 = { ...moveItem(gen3, tops[0]!.id, tops[1]!.x - tops[0]!.x, tops[1]!.y - tops[0]!.y), edited: true, base: gen3.base };
    const pr3 = await fetch(`${base}/api/projects/${created3.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: '重なりの検査', answers: answersSpread, drawing: moved3, baseUpdatedAt: created3.updatedAt, force: true }) });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('zumen.helpSeen', '1');
        localStorage.setItem('zumen.display', JSON.stringify({ lang: 'ja', theme: 'light', textScale: 1, uiScale: 1, bold: false }));
      } catch {}
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(6000);
    screens++;
    try {
      if (!pr3.ok) throw new Error('重なりの検査の案件に、図面を保存できませんでした');
      await page.goto(base);
      await sleep(400);
      await page.fill('#login-id', USER);
      await page.fill('#login-pw', PASS);
      await page.click('button[type=submit]');
      await sleep(1100);
      await page.locator('button', { hasText: /閉じる|Close/ }).first().click({ timeout: 400 }).catch(() => {});
      await page.locator('tr', { hasText: '重なりの検査' }).first().locator('button.job-open').click({ timeout: 2000, force: true });
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      await page.locator('.tabbar > button, .tabbar .tab-wrap > button').nth(3).click({ force: true, timeout: 1500 });
      await sleep(1200);
      const marks = await page.locator('svg.canvas rect.rebuilt-overlap').count();
      if (marks < 2) {
        failed++;
        problems.push(`重なりの検査：作り直したあと、重なった記号が、赤い点線で囲まれていません（${marks}個）`);
      } else {
        await page.locator('.stale-note button').first().click({ timeout: 2000 });
        await sleep(300);
        const after = await page.locator('svg.canvas rect.rebuilt-overlap').count();
        if (after !== 0) {
          failed++;
          problems.push(`重なりの検査：お知らせを閉じても、赤い点線の囲みが残っています（${after}個）`);
        }
      }
    } catch (e) {
      failed++;
      problems.push(`重なりの検査：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 80)}）`);
    }
    await ctx.close();
  }
  // すでに、高圧ケーブルの途中に、ZCT 以外が入っている図面を開くと、赤い印と知らせが出て、閉じると消える（第18弾 D）
  {
    const ans = dropHiddenChoices({ ...answersSpread, areaCount: '1', cableInstallation: 'overhead', mainGroundRelay: 'dgr', hasZpd: 'yes', mainZctPos: 'cable', midSwitch: 'no' } as typeof answersSpread);
    const eff = effectiveAnswers(ans);
    const g4 = fromLayout(layout(buildComposition(eff), eff));
    const zid = hvStretches(g4).find((s) => s.mid.length > 0)?.mid[0];
    const created4 = await (
      await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'ケーブルの検査', answers: ans }) })
    ).json() as { id: string; updatedAt: string };
    const basis4 = digest(JSON.stringify(buildComposition(eff).map((i) => [i.role, i.symbolId, i.label, i.unit ?? 0])));
    const stuck = { ...replaceSymbol({ ...g4, basis: basis4 }, zid ?? '', 'vcb'), edited: true, base: g4.base };
    const pr4 = await fetch(`${base}/api/projects/${created4.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'ケーブルの検査', answers: ans, drawing: stuck, baseUpdatedAt: created4.updatedAt, force: true }) });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('zumen.helpSeen', '1');
        localStorage.setItem('zumen.display', JSON.stringify({ lang: 'ja', theme: 'light', textScale: 1, uiScale: 1, bold: false }));
      } catch {}
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(6000);
    screens++;
    try {
      if (!zid) throw new Error('ケーブルの途中の ZCT が見つかりませんでした');
      if (!pr4.ok) throw new Error('ケーブルの検査の案件に、図面を保存できませんでした');
      await page.goto(base);
      await sleep(400);
      await page.fill('#login-id', USER);
      await page.fill('#login-pw', PASS);
      await page.click('button[type=submit]');
      await sleep(1100);
      await page.locator('button', { hasText: /閉じる|Close/ }).first().click({ timeout: 400 }).catch(() => {});
      await page.locator('tr', { hasText: 'ケーブルの検査' }).first().locator('button.job-open').click({ timeout: 2000, force: true });
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      await page.locator('.tabbar > button, .tabbar .tab-wrap > button').nth(3).click({ force: true, timeout: 1500 });
      await sleep(1200);
      const marks = await page.locator('svg.canvas .issue-mark').count();
      const note = await page.locator('.layer-note', { hasText: '高圧ケーブルの途中' }).count();
      if (marks < 1 || note < 1) {
        failed++;
        problems.push(`ケーブルの検査：途中に VCB が入っている図面を開いても、赤い印（${marks}個）か知らせ（${note}件）が出ません`);
      } else {
        await page.locator('.layer-note', { hasText: '高圧ケーブルの途中' }).locator('button').first().click({ timeout: 2000 });
        await sleep(300);
        const after = await page.locator('svg.canvas .issue-mark').count();
        if (after !== 0) {
          failed++;
          problems.push(`ケーブルの検査：知らせを閉じても、赤い印が残っています（${after}個）`);
        }
      }
    } catch (e) {
      failed++;
      problems.push(`ケーブルの検査：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 80)}）`);
    }
    await ctx.close();
  }
  // スケッチを読み取ったあと、未回答の必須項目は、エリアごとにまとまり、「全○問中○問」が出る。複数エリアは、1か所目だけ開く（第18弾 E-①）
  // （AI には頼まず、読み取りの返事を、画面に差し込んで試す）
  {
    const proj = await (
      await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: '読み取りの検査', answers: { startMode: 'sketch' } }) })
    ).json() as { id: string };
    void proj;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('zumen.helpSeen', '1');
        localStorage.setItem('zumen.display', JSON.stringify({ lang: 'ja', theme: 'light', textScale: 1, uiScale: 1, bold: false }));
      } catch {}
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    await page.route('**/api/analyze', (r: any) => (r.request().method() === 'POST' ? r.fulfill({ json: { jobId: 'job-x' } }) : r.continue()));
    await page.route('**/api/analyze/job-x', (r: any) => {
      const m = r.request().method();
      if (m === 'GET') return r.fulfill({ json: { state: 'done', result: { answers: { areaCount: '8', siteName: 'テスト工場' }, uncertain: [], evidence: {}, notes: [], questions: [] } } });
      return r.fulfill({ json: {} });
    });
    screens++;
    try {
      await page.goto(base);
      await sleep(400);
      await page.fill('#login-id', USER);
      await page.fill('#login-pw', PASS);
      await page.click('button[type=submit]');
      await sleep(1100);
      await page.locator('button', { hasText: /閉じる|Close/ }).first().click({ timeout: 400 }).catch(() => {});
      await page.locator('tr', { hasText: '読み取りの検査' }).first().locator('button.job-open').click({ timeout: 2000, force: true });
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      await page.locator('.tabbar > button, .tabbar .tab-wrap > button').nth(0).click({ force: true, timeout: 1500 });
      await sleep(500);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      await page.setInputFiles('input[type=file]', { name: 'sketch.png', mimeType: 'image/png', buffer: png });
      await sleep(400);
      await page.locator('section button.primary').first().click({ timeout: 3000 });
      await page.waitForSelector('details.sketch-group', { timeout: 12000 });
      const groups = await page.locator('details.sketch-group').count();
      const opened = await page.locator('details.sketch-group[open]').count();
      const count = await page.locator('.sketch-count').innerText();
      const fieldsInOpen = await page.locator('details.sketch-group[open] .field, details.sketch-group[open] .fields > *').count();
      if (groups !== 8 || opened !== 1 || !/全\d+問中\s*0問/.test(count) || fieldsInOpen < 1) {
        failed++;
        problems.push(`読み取りの検査：8エリアの結果が、まとまりと件数で出ていません（まとまり ${groups}個・開いている ${opened}個・「${count.replace(/\s+/g, ' ')}」）`);
      } else {
        await page.locator('details.sketch-group:not([open]) > summary').first().click({ timeout: 2000 });
        await sleep(200);
        const after = await page.locator('details.sketch-group[open]').count();
        if (after !== 2) {
          failed++;
          problems.push(`読み取りの検査：見出しを押しても、エリアが開きません（開いている ${after}個）`);
        }
      }
    } catch (e) {
      failed++;
      problems.push(`読み取りの検査：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 100)}）`);
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
