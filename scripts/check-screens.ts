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
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answersSpread } from './check-drawing/common.ts';
import { VOICE_FORMAT, VOICE_VERSION } from '../packages/ai/src/index.ts';
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
/**
 * 編集中の印を、全部外す。この検査は、同じアカウントで、画面（ブラウザの窓）を、次々に開いては閉じる。
 * 本当の画面は、閉じるときに印を外すが、この検査の窓は、外す前に閉じてしまうことがある。
 * 同じアカウントの別の場所が編集中のときは、閲覧のみになる決まり（編集ロック）なので、次の窓を開く前に、外しておく。
 */
const freeLocks = () => {
  const sdb = new DatabaseSync(join(dataDir, 'zumen.db'));
  try {
    sdb.exec('UPDATE projects SET locked_by = NULL, locked_at = NULL, locked_client = NULL, locked_device = NULL');
  } finally {
    sdb.close();
  }
};
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
  const DEV: Record<string, [number, number, boolean]> = { phone: [390, 844, true], phoneS: [360, 740, true], phoneL: [844, 390, true], tablet: [820, 1180, true], tabletL: [1180, 820, true], pc: [1280, 800, false], pcW: [1600, 900, false] };
  const mk = (dev: string, lang: string, scale: number, theme: 'light' | 'dark' = 'light'): Combo => ({ dev, w: DEV[dev]![0], h: DEV[dev]![1], touch: DEV[dev]![2], theme, lang, scale });
  let combos: Combo[] = [
    mk('phone', 'ja', 1), mk('phone', 'ja', 1.3), mk('phone', 'en', 1.3), mk('phone', 'fr', 1.3, 'dark'), mk('phone', 'zh', 1), mk('phone', 'ko', 1.3),
    mk('phoneS', 'ja', 1), mk('phone', 'ja', 1.6),
    mk('tablet', 'ja', 1), mk('tablet', 'en', 1.3), mk('tabletL', 'ja', 1, 'dark'), mk('tablet', 'fr', 1.6),
    mk('phoneL', 'ja', 1), mk('phoneL', 'ja', 1.3), mk('phoneL', 'fr', 1.6),
    mk('pc', 'ja', 1), mk('pc', 'en', 1.6), mk('pcW', 'ja', 1), mk('pcW', 'ja', 0.6), mk('pcW', 'fr', 1.3),
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
        // 上の帯の「出す・隠す」（36px）と、右の行（40px）は、押しやすさの最低の高さを、少し下げてある（第21弾 項目13 案A）。そのほかは、44px
        const minH = el.classList.contains('tabbar-toggle') ? 35.5 : el.parentElement?.classList.contains('tabbar-right') ? 39.5 : 43.5;
        if (touch && (r.height < minH || r.width < 43.5) && el.tagName !== 'A' && !['checkbox', 'radio', 'file', 'range'].includes(t) && !el.closest('svg') && el.tagName !== 'TEXTAREA') out.small.push(`${label}:${Math.round(r.width)}x${Math.round(r.height)}`);
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
    freeLocks();
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
      // 図面一覧の枠の幅（第21弾 項目12）：PCの広い画面（実効幅1200超）は1150px（1000の15%増）まで広がる。iPad・スマホは、いまのまま（1000px以下）。広げても、横にはみ出さない
      {
        const pw = (await page.evaluate(() => (document.querySelector('.joblist .panel') as HTMLElement | null)?.getBoundingClientRect().width ?? 0)) / c.scale;
        const eff = c.w / c.scale;
        const room = Math.min(1150, eff - 56 - 2);
        const wantMax = eff > 1200 ? 1150 : 1000;
        if (pw > wantMax + 1 || (eff > 1200 && eff >= 1300 && pw < Math.min(room, 1150) - 2)) {
          failed++;
          problems.push(`${name}／一覧：枠の幅が ${Math.round(pw)}px です（実効幅 ${Math.round(eff)}px のとき、${eff > 1200 ? 'できるだけ1150px' : '1000px以下'}のはず）`);
        }
      }
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
                // 拡大したあとも、図面が枠より小さい向きは、図面が枠の真ん中に寄るので、記号を、カーソルの下に残せない（その向きのずれは、数えない）
                const wr = document.querySelector('.canvas-wrap') as HTMLElement | null;
                const sv = wr?.querySelector('svg.canvas') as SVGElement | null;
                const sr = sv?.getBoundingClientRect();
                const fitsX = !!wr && !!sr && sr.width < wr.clientWidth - 1;
                const fitsY = !!wr && !!sr && sr.height < wr.clientHeight - 1;
                return Math.hypot(fitsX ? 0 : r.x + r.width / 2 - x, fitsY ? 0 : r.y + r.height / 2 - y);
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
    freeLocks();
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
  // 入力画面：変圧器2台目に、「どこから接続しますか？」が出て、1台目の開閉器の二次側を選べる。1台目には出ない（第18弾 F-②）
  {
    const ans = dropHiddenChoices({ ...answersSpread, areaCount: '1', transformerCount: '2', trHasCable: 'yes', trCableUp1: 'ds', trCableUp2: 'vcb' } as typeof answersSpread);
    await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: '接続元の検査', answers: ans }) });
    freeLocks();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('zumen.helpSeen', '1');
        localStorage.setItem('zumen.display', JSON.stringify({ lang: 'ja', theme: 'light', textScale: 1, uiScale: 1, bold: false }));
      } catch {}
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    screens++;
    try {
      await page.goto(base);
      await sleep(400);
      await page.fill('#login-id', USER);
      await page.fill('#login-pw', PASS);
      await page.click('button[type=submit]');
      await sleep(1100);
      await page.locator('button', { hasText: /閉じる|Close/ }).first().click({ timeout: 400 }).catch(() => {});
      await page.locator('tr', { hasText: '接続元の検査' }).first().locator('button.job-open').click({ timeout: 2000, force: true });
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      await page.locator('.tabbar > button, .tabbar .tab-wrap > button').nth(2).click({ force: true, timeout: 1500 });
      await sleep(1000);
      const second = await page.locator('select[id="trFrom__2"]').count();
      const first = await page.locator('select[id="trFrom"]').count();
      const opts = second > 0 ? await page.locator('select[id="trFrom__2"] option').allInnerTexts() : [];
      // 1台目にも、同じ質問が出る（選べる開閉器は無いので、「母線から」だけ）。台ごとに、同じ質問がそろって並ぶ（第21弾 項目7）
      const firstOpts = first > 0 ? (await page.locator('select[id="trFrom"] option').allInnerTexts()).filter((o: string) => !/選択してください|Select/.test(o)) : [];
      if (second !== 1 || first !== 1 || firstOpts.length !== 1 || !/母線から/.test(firstOpts[0] ?? '') || !opts.some((o: string) => /VCBの二次側/.test(o)) || !opts.some((o: string) => /DSの二次側/.test(o))) {
        failed++;
        problems.push(`接続元の検査：入力画面の「どこから接続しますか？」が、1台目（母線からだけ）にも、2台目（開閉器の選択肢つき）にも、出ていません（2台目 ${second}・1台目 ${first}・1台目の選択肢「${firstOpts.join(' / ')}」・2台目の選択肢「${opts.join(' / ')}」）`);
      } else {
        await page.locator('select[id="trFrom__2"]').selectOption({ label: opts.find((o: string) => /VCBの二次側/.test(o))! });
        await sleep(300);
        const v = await page.locator('select[id="trFrom__2"]').inputValue();
        if (v !== 'tr-cable-up2:0') {
          failed++;
          problems.push(`接続元の検査：VCBの二次側を選んでも、答えが入りません（${v}）`);
        }
      }
    } catch (e) {
      failed++;
      problems.push(`接続元の検査：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 100)}）`);
    }
    await ctx.close();
  }
  // 入力画面：2か所目への送り出しで、分岐する位置を「ほかの機器の開閉器の二次側」にすると、「どの開閉器の二次側ですか？」が出て、選べる（第18弾 F-③）
  {
    const ans = dropHiddenChoices({ ...answersSpread, areaCount: '2', transformerCount: '2', trHasCable: 'yes', trCableUp1: 'ds', trCableUp2: 'vcb', 'a2:linkTap': 'device' } as typeof answersSpread);
    await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: '送り元の開閉器の検査', answers: ans }) });
    freeLocks();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('zumen.helpSeen', '1');
        localStorage.setItem('zumen.display', JSON.stringify({ lang: 'ja', theme: 'light', textScale: 1, uiScale: 1, bold: false }));
      } catch {}
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    screens++;
    try {
      await page.goto(base);
      await sleep(400);
      await page.fill('#login-id', USER);
      await page.fill('#login-pw', PASS);
      await page.click('button[type=submit]');
      await sleep(1100);
      await page.locator('button', { hasText: /閉じる|Close/ }).first().click({ timeout: 400 }).catch(() => {});
      await page.locator('tr', { hasText: '送り元の開閉器の検査' }).first().locator('button.job-open').click({ timeout: 2000, force: true });
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      await page.locator('.tabbar > button, .tabbar .tab-wrap > button').nth(2).click({ force: true, timeout: 1500 });
      await sleep(1000);
      const sel = page.locator('select[id$="linkDevice"]');
      const n = await sel.count();
      const opts = n > 0 ? await sel.first().locator('option').allInnerTexts() : [];
      if (n !== 1 || !opts.some((o: string) => /VCBの二次側/.test(o)) || !opts.some((o: string) => /DSの二次側/.test(o))) {
        failed++;
        problems.push(`送り元の開閉器の検査：「どの開閉器の二次側ですか？」が、開閉器の選択肢つきで出ていません（${n}個・選択肢「${opts.join(' / ')}」）`);
      } else {
        await sel.first().selectOption({ label: opts.find((o: string) => /VCBの二次側/.test(o))! });
        await sleep(300);
        const v = await sel.first().inputValue();
        if (v !== 'tr-cable-up2:0') {
          failed++;
          problems.push(`送り元の開閉器の検査：VCBの二次側を選んでも、答えが入りません（${v}）`);
        }
      }
    } catch (e) {
      failed++;
      problems.push(`送り元の開閉器の検査：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 100)}）`);
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
    const stuck = { ...replaceSymbol({ ...g4, basis: basis4 }, zid ?? '', 'ct'), edited: true, base: g4.base };
    const pr4 = await fetch(`${base}/api/projects/${created4.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'ケーブルの検査', answers: ans, drawing: stuck, baseUpdatedAt: created4.updatedAt, force: true }) });
    freeLocks();
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
        problems.push(`ケーブルの検査：途中に CT が入っている図面を開いても、赤い印（${marks}個）か知らせ（${note}件）が出ません`);
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
    freeLocks();
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
      if (m === 'GET') return r.fulfill({ json: { state: 'done', result: { answers: { areaCount: '8', siteName: 'テスト工場' }, uncertain: ['siteName'], evidence: { siteName: 'メモの左上の「テスト工場」' }, notes: [], questions: [
        { questionId: 'sectionalizer', where: '図の最上部、電柱のすぐ下の開閉器', ask: '区分開閉器は、PAS・PGS・UGSのどれですか', why: '種類で、その下のケーブルの有無が変わるため' },
        { questionId: '', where: '図の右下の余白', ask: '「要確認」と書いてあります。何を確認しますか', why: 'どの機器のことか分からないため' },
      ] } } });
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
      const count = await page.locator('.sketch-count').last().innerText();
      const fieldsInOpen = await page.locator('details.sketch-group[open] .field, details.sketch-group[open] .fields > *').count();
      // AIからの質問：1つ1つ枠に分かれ、4つの部分が出て、対応する項目は、入力欄で答えられる。答えると、件数が増える
      const aiCards = await page.locator('section.sketch-ai').first().locator('li.ai-q').count();
      const confirmCards = await page.locator('section.sketch-ai').nth(1).locator('li.ai-q').count();
      const firstText = await page.locator('li.ai-q').first().innerText();
      const parts = ['どの部分', '分からないこと', 'なぜ聞くか', '答え'].filter((w) => !firstText.includes(w));
      const noItemBtn = await page.locator('li.ai-q').nth(1).locator('button', { hasText: '入力画面を開く' }).count();
      if (aiCards !== 2 || confirmCards !== 1 || parts.length > 0 || noItemBtn !== 1) {
        failed++;
        problems.push(`読み取りの検査：AIからの質問が、枠に分かれて出ていません（質問 ${aiCards}枠・確認 ${confirmCards}枠・足りない見出し ${parts.join('、') || 'なし'}・対応しない質問の案内 ${noItemBtn}）`);
      } else {
        const card = page.locator('li.ai-q').first();
        const sel = card.locator('select');
        if ((await sel.count()) > 0) await sel.selectOption({ index: 3 });
        else await card.locator('.fields button').nth(1).click({ timeout: 2000 });
        await sleep(300);
        const doneCards = await page.locator('section.sketch-ai').first().locator('li.ai-q.done').count();
        const cnt = await page.locator('section.sketch-ai').first().locator('.sketch-count').innerText();
        if (doneCards !== 1 || !/全2問中\s*1問/.test(cnt)) {
          failed++;
          problems.push(`読み取りの検査：AIの質問に答えても、回答済みになりません（回答済み ${doneCards}枠・「${cnt.replace(/\s+/g, ' ')}」）`);
        }
      }
      // スマホの大きさでも、横にはみ出さず、文字が切れない（押す部品の大きさは、指で操作する端末の検査で見る）
      await page.setViewportSize({ width: 390, height: 844 });
      await sleep(300);
      const mm = await measure(page, false);
      const bits = [mm.docOverflow ? '画面が横にはみ出す' : '', mm.over.length ? `はみ出す部品 ${mm.over.join('、')}` : '', mm.small.length ? `44px未満 ${mm.small.join('、')}` : '', mm.clipped.length ? `文字が切れる ${mm.clipped.join('、')}` : ''].filter(Boolean);
      if (bits.length > 0) {
        failed++;
        problems.push(`読み取りの検査（スマホ）：${bits.join('／')}`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
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
  // 音声入力から作成：貼り付けた文章と、読み取った結果は、別のタブに移っても消えない。「入力した内容を削除」で、一撃で消せる（第21弾 項目4）
  {
    freeLocks();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('zumen.helpSeen', '1');
        localStorage.setItem('zumen.display', JSON.stringify({ lang: 'ja', theme: 'light', textScale: 1, uiScale: 1, bold: false }));
      } catch {}
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
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
      const tabBtn = (i: number) => page.locator('.tabbar > button, .tabbar .tab-wrap > button').nth(i);
      await tabBtn(1).click({ force: true, timeout: 1500 });
      await sleep(400);
      const pasted = '```json\n' + JSON.stringify({ format: VOICE_FORMAT, version: VOICE_VERSION, answers: { sourceType: 'pole', sectionalizer: 'pas', transformerCount: '2' }, uncertain: ['sectionalizer'], evidence: { sectionalizer: '電柱の上のPAS' }, notes: [] }) + '\n```';
      await page.fill('textarea.voice-paste >> nth=0', pasted);
      await page.locator('.voice-row button.primary').click();
      await page.waitForSelector('button.primary:has-text("設備入力に反映")', { timeout: 6000 });
      // 別のタブに移って、戻る
      await tabBtn(2).click({ force: true, timeout: 1500 });
      await sleep(500);
      await tabBtn(1).click({ force: true, timeout: 1500 });
      await sleep(500);
      const kept = await page.locator('textarea.voice-paste').first().inputValue();
      const stillResult = await page.locator('button.primary:has-text("設備入力に反映")').count();
      if (kept !== pasted || stillResult !== 1) {
        failed++;
        problems.push(`音声入力の検査：別のタブに移って戻ると、貼り付けた文章か読み取った結果が消えています（文章 ${kept === pasted ? '残っている' : '消えた'}・結果 ${stillResult ? '残っている' : '消えた'}）`);
      }
      // 「入力した内容を削除」：1回で消える（確認の窓は出ない）。右端に置いてある
      const del = page.locator('.voice-row button.danger');
      const pos = await page.evaluate(() => {
        const row = document.querySelector('.voice-row') as HTMLElement | null;
        const a = row?.querySelector('button.primary')?.getBoundingClientRect();
        const b = row?.querySelector('button.danger')?.getBoundingClientRect();
        return a && b ? { readX: a.left, delX: b.left, rowRight: row!.getBoundingClientRect().right, delRight: b.right } : null;
      });
      await del.click({ timeout: 2000 });
      await sleep(300);
      const after = await page.locator('textarea.voice-paste').first().inputValue();
      const modal = await page.locator('.modal').count();
      const resultAfter = await page.locator('button.primary:has-text("設備入力に反映")').count();
      if (after !== '' || modal !== 0 || resultAfter !== 0 || !pos || pos.delX <= pos.readX || pos.rowRight - pos.delRight > 4) {
        failed++;
        problems.push(`音声入力の検査：「入力した内容を削除」が、1回で消せない・窓が出る・右端にありません（文章 ${after === '' ? '消えた' : '残っている'}・窓 ${modal}個・結果 ${resultAfter ? '残っている' : '消えた'}）`);
      }
    } catch (e) {
      failed++;
      problems.push(`音声入力の検査：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 100)}）`);
    }
    await ctx.close();
  }
  // 編集ロック：同じアカウントでも、別の場所（別のタブ・端末）が編集中なら、閲覧のみ。帯に出て、「編集を引き継ぐ」で引き継げる（第21弾 項目6）
  {
    freeLocks();
    const mk = async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('zumen.helpSeen', '1');
          localStorage.setItem('zumen.display', JSON.stringify({ lang: 'ja', theme: 'light', textScale: 1, uiScale: 1, bold: false }));
        } catch {}
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(8000);
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
      return { ctx, page };
    };
    screens++;
    try {
      const one = await mk();
      const noBar = await one.page.locator('.bar-lock').count();
      const two = await mk();
      const bar = await two.page.locator('.bar-lock').first().innerText({ timeout: 3000 }).catch(() => '');
      if (noBar !== 0 || !/別の場所/.test(bar) || !/閲覧のみ/.test(bar)) {
        failed++;
        problems.push(`編集ロックの検査：同じアカウントの別の場所が編集中なのに、閲覧のみの帯が出ていません（先の窓の帯 ${noBar}個・あとの窓の帯「${bar.replace(/\s+/g, ' ').slice(0, 60)}」）`);
      } else {
        await two.page.locator('.bar-lock button', { hasText: '編集を引き継ぐ' }).click({ timeout: 2000 });
        await two.page.locator('.modal button', { hasText: '編集を引き継ぐ' }).click({ timeout: 3000 });
        await sleep(900);
        const after = await two.page.locator('.bar-lock').count();
        if (after !== 0) {
          failed++;
          problems.push('編集ロックの検査：「編集を引き継ぐ」を押しても、閲覧のみのままです');
        }
      }
      await one.ctx.close();
      await two.ctx.close();
    } catch (e) {
      failed++;
      problems.push(`編集ロックの検査：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 100)}）`);
    }
  }
  // スマホの「記号・設定」の枠（下から出る枠）：上端のつまみで高さを変えられる。下へ大きく引き下げると閉じる。覚える。倍率があっても、同じ割合（第21弾 項目15）
  for (const scale of [1, 1.3]) {
    freeLocks();
    screens++;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false });
    let stage = '準備';
    try {
      await ctx.addInitScript((s: number) => {
        try {
          localStorage.setItem('zumen.helpSeen', '1');
          localStorage.setItem('zumen.phoneBarOpen', 'off');
          localStorage.setItem('zumen.display', JSON.stringify({ lang: 'ja', theme: 'light', textScale: 1, uiScale: s, bold: false }));
        } catch {}
      }, scale);
      const page = await ctx.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(base);
      await sleep(400);
      await page.fill('#login-id', USER);
      await page.fill('#login-pw', PASS);
      await page.click('button[type=submit]');
      await sleep(1100);
      await page.locator('button', { hasText: /閉じる|Close/ }).first().click({ timeout: 400 }).catch(() => {});
      await page.locator('tr', { hasText: '画面検査の案件' }).first().locator('button.job-open').click({ timeout: 2000, force: true });
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      await page.locator('.tabbar > button, .tabbar .tab-wrap > button').nth(3).click({ force: true, timeout: 1500 });
      await sleep(1200);
      await page.locator('.edit-toggle').evaluate((e: HTMLElement) => e.click());
      await sleep(500);
      const openSheet = async () => {
        await page.locator('button.tools-toggle').filter({ hasText: /記号|設定/ }).last().evaluate((e: HTMLElement) => e.click());
        await sleep(400);
      };
      const state = () =>
        page.evaluate(() => {
          const s = document.querySelector('aside.side.open') as HTMLElement | null;
          if (!s) return null;
          const r = s.getBoundingClientRect();
          return { pct: (r.height / innerHeight) * 100, over: document.documentElement.scrollWidth > innerWidth + 1, closeBottom: Math.round(r.bottom - (s.querySelector('.side-close') as HTMLElement).getBoundingClientRect().bottom) };
        });
      // steps回に分けて、stepMsずつ待ちながらドラッグする（ふつうのドラッグは、ゆっくり。払う動きは、短い時間で）
      const drag = async (dy: number, steps = 20, stepMs = 25) => {
        const b = (await page.locator('.sheet-handle').boundingBox())!;
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 1; i <= steps; i++) {
          await page.mouse.move(x, y + (dy * i) / steps);
          await sleep(stepMs);
        }
        await page.mouse.up();
        await sleep(350);
      };
      const bad: string[] = [];
      stage = '開く';
      await openSheet();
      const s0 = await state();
      if (!s0 || Math.abs(s0.pct - 55) > 1.5) bad.push(`開いたときの高さが画面の55%ではありません（${s0 ? s0.pct.toFixed(1) : '開かない'}%）`);
      if (s0 && s0.closeBottom > 1) bad.push(`「閉じる」が、枠の下端に固定されていません（下端から ${s0.closeBottom}px）`);
      stage = '上へドラッグ';
      await drag(-150);
      const s1 = await state();
      if (!s1 || s1.pct < (s0?.pct ?? 0) + 10) bad.push(`つまみを上へドラッグしても、枠が高くなりません（${s0?.pct.toFixed(1)}% → ${s1?.pct.toFixed(1)}%）`);
      stage = '下へドラッグ';
      await drag(300);
      const s2 = await state();
      if (!s2 || s2.pct > (s1?.pct ?? 100) - 20) bad.push(`つまみを下へドラッグしても、枠が低くなりません（${s1?.pct.toFixed(1)}% → ${s2?.pct.toFixed(1)}%）`);
      const remembered = s2?.pct ?? 0;
      stage = '大きく下へ';
      await drag(600);
      if ((await state()) !== null) bad.push('つまみを下へ大きく引き下げても、枠が閉じません');
      await openSheet();
      const s3 = await state();
      if (!s3 || Math.abs(s3.pct - remembered) > 1.5) bad.push(`閉じたあとに開き直したとき、引き下げる前の高さ（${remembered.toFixed(1)}%）で開きません（${s3 ? s3.pct.toFixed(1) : '開かない'}%）`);
      stage = '下へ払う';
      await drag(150, 3, 0);
      if ((await state()) !== null) bad.push('つまみを下へ素早く払っても、枠が閉じません');
      if ((await state()) === null) await openSheet();
      stage = 'ダブルクリック';
      {
        const hb = (await page.locator('.sheet-handle').boundingBox())!;
        await page.mouse.dblclick(hb.x + hb.width / 2, hb.y + hb.height / 2);
      }
      await sleep(300);
      const s4 = await state();
      if (!s4 || Math.abs(s4.pct - 55) > 1.5) bad.push(`ダブルクリックで、元の高さ（55%）に戻りません（${s4 ? s4.pct.toFixed(1) : '開かない'}%）`);
      if ((s0?.over || s1?.over || s2?.over) === true) bad.push('枠の高さを変えたとき、画面が横にはみ出しました');
      if (bad.length > 0) {
        failed++;
        problems.push(`記号の枠の高さの検査（画面の倍率 ${Math.round(scale * 100)}%）：${bad.join('／')}`);
      }
    } catch (e) {
      failed++;
      problems.push(`記号の枠の高さの検査（画面の倍率 ${Math.round(scale * 100)}%）：途中で止まりました（${stage}：${String((e as Error)?.message ?? e).slice(0, 100)}）`);
    }
    await ctx.close();
  }
  // タブの説明の吹き出し：三角が、説明しているタブの真ん中を指す。吹き出しが画面の外に出ない。画面全体の倍率（60%〜160%）・言語を変えても（第21弾 項目16）
  for (const [w, h, lang, scale] of [[390, 844, 'ja', 0.8], [820, 1180, 'ja', 1.3], [1366, 800, 'ja', 0.6], [390, 844, 'fr', 1.6]] as const) {
    freeLocks();
    screens++;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1000, isMobile: false });
    try {
      await ctx.addInitScript(([l, s]: [string, number]) => {
        try {
          localStorage.setItem('zumen.helpSeen', '1');
          localStorage.setItem('zumen.phoneBarOpen', 'off');
          localStorage.setItem('zumen.display', JSON.stringify({ lang: l, theme: 'light', textScale: 1, uiScale: s, bold: false }));
        } catch {}
      }, [lang, scale]);
      const page = await ctx.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(base);
      await sleep(400);
      await page.fill('#login-id', USER);
      await page.fill('#login-pw', PASS);
      await page.click('button[type=submit]');
      await sleep(1100);
      await page.locator('button', { hasText: /閉じる|Close|Fermer/ }).first().click({ timeout: 400 }).catch(() => {});
      await page.locator('tr', { hasText: '画面検査の案件' }).first().locator('button.job-open').click({ timeout: 2000, force: true });
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      const bad: string[] = [];
      for (let i = 0; i < 4; i++) {
        const tab = page.locator('.tabbar > button, .tabbar .tab-wrap > button').nth(i);
        const b = (await tab.boundingBox())!;
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await sleep(1500);
        const m = await page.evaluate(() => {
          const t = document.querySelector('.tip') as HTMLElement | null;
          if (!t) return null;
          const r = t.getBoundingClientRect();
          const ratio = t.offsetWidth > 0 ? r.width / t.offsetWidth : 1;
          return { arrow: r.left + parseFloat(t.style.getPropertyValue('--arrow-x')) * ratio, over: r.right > innerWidth + 1 || r.left < -1 };
        });
        const b2 = (await tab.boundingBox())!;
        if (!m) bad.push(`${i + 1}つ目のタブ：説明が出ません`);
        else if (Math.abs(m.arrow - (b2.x + b2.width / 2)) > 4) bad.push(`${i + 1}つ目のタブ：三角が、タブの真ん中から ${Math.round(m.arrow - (b2.x + b2.width / 2))}px ずれています`);
        else if (m.over) bad.push(`${i + 1}つ目のタブ：説明が、画面の外にはみ出しています`);
        await page.mouse.move(5, h - 5);
        await sleep(150);
      }
      if (bad.length > 0) {
        failed++;
        problems.push(`タブの説明の三角の検査（幅 ${w}px・${lang}・倍率 ${Math.round(scale * 100)}%）：${bad.join('／')}`);
      }
    } catch (e) {
      failed++;
      problems.push(`タブの説明の三角の検査（幅 ${w}px・${lang}・倍率 ${Math.round(scale * 100)}%）：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 100)}）`);
    }
    await ctx.close();
  }
  // スマホの上の帯：英語・フランス語でも、右の行のボタンの名前が1行で、単語の途中で割れない。タブの名前は2行まで（第21弾 項目18の9）。幅320pxでも、「ログアウト」だけが下の段に回らない（項目18の7）
  for (const [w, lang, scale] of [[360, 'en', 0.8], [390, 'en', 1], [360, 'fr', 0.8], [390, 'fr', 1], [430, 'fr', 1], [320, 'ja', 1], [320, 'ja', 0.8], [320, 'en', 1], [360, 'ja', 1]] as const) {
    freeLocks();
    screens++;
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, hasTouch: true, isMobile: false });
    try {
      await ctx.addInitScript(([l, sc]: [string, number]) => {
        try {
          localStorage.setItem('zumen.helpSeen', '1');
          localStorage.setItem('zumen.phoneBarOpen', 'on');
          localStorage.setItem('zumen.display', JSON.stringify({ lang: l, theme: 'light', textScale: 1, uiScale: sc, bold: false }));
        } catch {}
      }, [lang, scale]);
      const page = await ctx.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(base);
      await sleep(400);
      await page.fill('#login-id', USER);
      await page.fill('#login-pw', PASS);
      await page.click('button[type=submit]');
      await sleep(1100);
      await page.locator('button', { hasText: /閉じる|Close|Fermer/ }).first().click({ timeout: 400 }).catch(() => {});
      await page.locator('tr', { hasText: '画面検査の案件' }).first().locator('button.job-open').click({ timeout: 2000, force: true });
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        const lines = (e: Element) => {
          const r = document.createRange();
          r.selectNodeContents(e);
          return new Set(Array.from(r.getClientRects()).filter((q) => q.width > 0).map((q) => Math.round(q.top / 4))).size;
        };
        for (const b of Array.from(document.querySelectorAll('.tabbar-right > button'))) {
          const label = b.querySelector('span') ?? b;
          if (lines(label) > 1) out.push(`「${(label.textContent ?? '').trim()}」が2行に割れています`);
        }
        // 4つのタブが、1段に並ぶ（1つだけ下の段に回らない）。名前の途中で割れない（第21弾 項目18の8の続き：幅360pxで「設備を入力して作成」が3行に割れた）
        const tabs = Array.from(document.querySelectorAll('.tabbar > button:not(.tabbar-toggle), .tabbar .tab-wrap > button')).map((t) => t.getBoundingClientRect());
        if (new Set(tabs.map((r) => Math.round(r.top / 8))).size > 1) out.push('タブが、2段に分かれています');
        // 右の行の最後のボタン（ログアウト）が、先頭のボタンと同じ段にある（1つだけ下の段に回らない。第21弾 項目18の7）
        const rb = Array.from(document.querySelectorAll('.tabbar-right > button'));
        const first = rb[0]?.getBoundingClientRect();
        const last = rb[rb.length - 1]?.getBoundingClientRect();
        if (first && last && Math.abs(first.top + first.height / 2 - (last.top + last.height / 2)) > 8) out.push('最後のボタンだけが、下の段に回っています');
        for (const t of Array.from(document.querySelectorAll('.tabbar > button:not(.tabbar-toggle), .tabbar .tab-wrap > button'))) {
          if (lines(t) > 2) out.push(`タブ「${(t.textContent ?? '').trim()}」が3行以上に割れています`);
        }
        return out;
      });
      if (bad.length > 0) {
        failed++;
        problems.push(`スマホの上の帯の検査（幅 ${w}px・${lang}・倍率 ${Math.round(scale * 100)}%）：${bad.join('／')}`);
      }
    } catch (e) {
      failed++;
      problems.push(`スマホの上の帯の検査（幅 ${w}px・${lang}）：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 100)}）`);
    }
    await ctx.close();
  }
  // スマホで図面を編集中のボタンが、2行に収まる（幅360px・画面全体100%、幅320px・80%、幅390px・100%。第21弾 項目18の8）
  for (const [w, sc] of [[360, 1], [320, 0.8], [390, 1]] as const) {
    freeLocks();
    screens++;
    const ctx = await browser.newContext({ viewport: { width: w, height: 740 }, hasTouch: true, isMobile: false });
    try {
      await ctx.addInitScript((u: number) => {
        try {
          localStorage.setItem('zumen.helpSeen', '1');
          localStorage.setItem('zumen.phoneBarOpen', 'off');
          localStorage.setItem('zumen.display', JSON.stringify({ lang: 'ja', theme: 'light', textScale: 1, uiScale: u, bold: false }));
        } catch {}
      }, sc);
      const page = await ctx.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(base);
      await sleep(400);
      await page.fill('#login-id', USER);
      await page.fill('#login-pw', PASS);
      await page.click('button[type=submit]');
      await sleep(1100);
      await page.locator('button', { hasText: /閉じる|Close|Fermer/ }).first().click({ timeout: 400 }).catch(() => {});
      await page.locator('tr', { hasText: '画面検査の案件' }).first().locator('button.job-open').click({ timeout: 2000, force: true });
      await sleep(900);
      await page.locator('.modal button').first().click({ timeout: 300 }).catch(() => {});
      await page.locator('.tabbar > button, .tabbar .tab-wrap > button').nth(3).click();
      await sleep(1200);
      await page.locator('.edit-toggle').click({ timeout: 2000 });
      await sleep(600);
      const rows = await page.evaluate(() => {
        const vis = Array.from(document.querySelectorAll('.editor-bar .tools button')).filter((b) => b.getBoundingClientRect().width > 0);
        return new Set(vis.map((b) => Math.round(b.getBoundingClientRect().top / 6))).size;
      });
      if (rows > 2) {
        failed++;
        problems.push(`スマホの編集中のボタンの検査（幅 ${w}px・倍率 ${Math.round(sc * 100)}%）：ボタンが ${rows} 行に分かれています（2行まで）`);
      }
    } catch (e) {
      failed++;
      problems.push(`スマホの編集中のボタンの検査（幅 ${w}px・倍率 ${Math.round(sc * 100)}%）：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 100)}）`);
    }
    await ctx.close();
  }
  // 初めて使うときの、端末に合ったおすすめの大きさ（第21弾 項目17）。スマホ・iPad：文字100%・画面全体80%。パソコン：どちらも100%。保存済みのブラウザは、上書きしない。「おすすめの設定に戻す」で、おすすめに戻る
  {
    const readSaved = (page: any) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('zumen.display') ?? 'null'); } catch { return null; } });
    const kinds: [string, Record<string, unknown>, number][] = [
      ['スマホ（縦）', { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 0.8],
      ['スマホ（横）', { viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, isMobile: true, hasTouch: true }, 0.8],
      ['iPad（縦）', { viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }, 0.8],
      ['iPad mini（縦）', { viewport: { width: 744, height: 1133 }, screen: { width: 744, height: 1133 }, isMobile: true, hasTouch: true }, 0.8],
      ['iPad（パソコン用サイトの表示）', { viewport: { width: 980, height: 1180 }, screen: { width: 820, height: 1180 }, isMobile: false, hasTouch: true }, 0.8],
      ['パソコン', { viewport: { width: 1366, height: 800 }, screen: { width: 1366, height: 800 } }, 1],
      ['大きなモニター', { viewport: { width: 2560, height: 1300 }, screen: { width: 2560, height: 1440 } }, 1],
    ];
    for (const [name, opt, ui] of kinds) {
      screens++;
      const ctx = await browser.newContext(opt);
      try {
        const page = await ctx.newPage();
        await page.goto(base);
        await sleep(600);
        const s = await readSaved(page);
        if (!s || s.textScale !== 1 || s.uiScale !== ui) {
          failed++;
          problems.push(`おすすめの大きさの検査（${name}）：初めて開いたとき、文字100%・画面全体${Math.round(ui * 100)}%になっていません（保存された値：文字 ${s?.textScale}・画面全体 ${s?.uiScale}）`);
        }
      } finally {
        await ctx.close();
      }
    }
    // 保存済みのブラウザは、上書きしない。「おすすめの設定に戻す」を押すと、おすすめに戻る
    {
      freeLocks();
      screens++;
      const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 }, isMobile: true, hasTouch: true });
      try {
        await ctx.addInitScript(() => {
          try {
            if (localStorage.getItem('zumen.display') === null) localStorage.setItem('zumen.display', JSON.stringify({ lang: 'ja', theme: 'light', textScale: 1.2, uiScale: 1.3, bold: false, hideHelp: false, scrollbar: 'normal' }));
            localStorage.setItem('zumen.helpSeen', '1');
            localStorage.setItem('zumen.phoneBarOpen', 'on');
          } catch {}
        });
        const page = await ctx.newPage();
        page.setDefaultTimeout(8000);
        await page.goto(base);
        await sleep(500);
        const kept = await readSaved(page);
        if (!kept || kept.textScale !== 1.2 || kept.uiScale !== 1.3) {
          failed++;
          problems.push(`おすすめの大きさの検査：すでに保存してある設定が、上書きされました（文字 ${kept?.textScale}・画面全体 ${kept?.uiScale}。1.2・1.3のはず）`);
        }
        await page.fill('#login-id', USER);
        await page.fill('#login-pw', PASS);
        await page.click('button[type=submit]');
        await sleep(1100);
        await page.locator('button', { hasText: /閉じる|Close/ }).first().click({ timeout: 400 }).catch(() => {});
        await page.locator('.tabbar-right .icon-btn').nth(1).evaluate((e: HTMLElement) => e.click());
        await sleep(500);
        await page.locator('button', { hasText: 'おすすめの設定に戻す' }).first().evaluate((e: HTMLElement) => e.click());
        await sleep(400);
        const after = await readSaved(page);
        if (!after || after.textScale !== 1 || after.uiScale !== 0.8) {
          failed++;
          problems.push(`おすすめの大きさの検査：「おすすめの設定に戻す」を押しても、この端末のおすすめ（文字100%・画面全体80%）に戻りません（文字 ${after?.textScale}・画面全体 ${after?.uiScale}）`);
        }
      } catch (e) {
        failed++;
        problems.push(`おすすめの大きさの検査：途中で止まりました（${String((e as Error)?.message ?? e).slice(0, 100)}）`);
      } finally {
        await ctx.close();
      }
    }
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
