/**
 * 自己診断（selftest）の、3つの部分が共有する道具：「○」「✗」の記録、空き番号探し、TypeScript の実行など。
 * 本編は scripts/selftest.ts。
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 自己診断。
 *
 *   pnpm selftest
 *
 * サーバーを一時的に立ち上げ、実際に通信して「ちゃんと動くか」を順に確かめる。
 * Windows・macOS・Linux のどれでも同じように動く。
 * 本物の案件には触らず、一時フォルダの中だけで試して、終わったら片付ける。
 */

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const WEB_DIST = resolve(ROOT, 'apps/web/dist');

/** 数えるもの（本編 scripts/selftest.ts が、最後に見て報告する） */
export const st = {
  passed: 0,
  failed: 0,
  problems: [] as string[],
  server: null as ChildProcess | null,
  serverLog: '',
};

/** 画面に出しつつ、記録用にも控えておく（あとで人に渡せるように） */
export const transcript: string[] = [];
export function say(line = ''): void {
  console.log(line);
  transcript.push(line);
}

export function ok(name: string, detail = ''): void {
  st.passed++;
  say(`  ○ ${name}${detail ? `　${detail}` : ''}`);
}
export function ng(name: string, detail: string): void {
  st.failed++;
  st.problems.push(`${name}：${detail}`);
  say(`  ✗ ${name}　${detail}`);
}
export function check(name: string, condition: boolean, detail = ''): void {
  if (condition) ok(name, detail);
  else ng(name, detail || '想定と違います');
}

/** 空いている番号を1つ借りる */
export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => done(port));
    });
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** このNodeで、リポジトリの中のTypeScriptをそのまま動かす */
export function runNode(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    const p = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += String(d)));
    p.stderr.on('data', (d) => (out += String(d)));
    p.on('close', (code) => done({ code: code ?? 1, out }));
  });
}

/* ------------------------------------------------------------------ */

/** 試験用の一時フォルダ（データ置き場・控えの置き場）。終わったら、本編が消す */
export const dataDir = mkdtempSync(join(tmpdir(), 'zumen-test-'));
export const backupDir = mkdtempSync(join(tmpdir(), 'zumen-backup-'));
