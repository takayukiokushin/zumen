import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 接続先のサーバーとウィンドウの大きさを、利用者ごとの領域に覚えておく */
export interface Settings {
  serverUrl?: string;
  window?: { width: number; height: number; x?: number; y?: number; maximized?: boolean };
}

const file = () => join(app.getPath('userData'), 'settings.json');

export function loadSettings(): Settings {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as Settings;
  } catch {
    return {};
  }
}

export function saveSettings(patch: Settings): void {
  const next = { ...loadSettings(), ...patch };
  try {
    writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  } catch {
    // 保存できなくても使い続けられるようにする
  }
}

/** 入力された接続先を整える。http(s) 以外は受け付けない */
export function normalizeServerUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
