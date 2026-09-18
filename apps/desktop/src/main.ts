import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, normalizeServerUrl, saveSettings } from './settings.js';

/**
 * デスクトップ版の外側。
 *
 * 画面そのものはサーバーが配るものをそのまま表示する。
 * こうしておくと、画面を直してもインストールし直さなくてよい。
 */

let win: BrowserWindow | null = null;

/** 初回起動時に接続先を聞く */
async function askServerUrl(parent?: BrowserWindow): Promise<string | null> {
  const { response } = await dialog.showMessageBox(parent ?? ({} as BrowserWindow), {
    type: 'info',
    title: '接続先の設定',
    message: '接続先のサーバーが設定されていません。',
    detail: '社内のサーバーの住所（例: http://192.168.1.10:8787）を設定してください。',
    buttons: ['設定する', '終了する'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return null;

  // 入力欄はEUIに無いため、簡易な入力ページを一時的に開く
  const input = new BrowserWindow({
    width: 460,
    height: 260,
    resizable: false,
    title: '接続先の設定',
    parent,
    modal: Boolean(parent),
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
  });
  await input.loadFile(join(__dirname, '../static/setup.html'));

  return new Promise<string | null>((resolve) => {
    const { ipcMain } = require('electron') as typeof import('electron');
    const handler = (_e: unknown, value: string) => {
      const url = normalizeServerUrl(value);
      if (!url) {
        void dialog.showMessageBox(input, {
          type: 'warning',
          message: '住所の形式が正しくありません。',
          detail: '例: http://192.168.1.10:8787',
        });
        return;
      }
      ipcMain.removeListener('setup:submit', handler);
      saveSettings({ serverUrl: url });
      input.close();
      resolve(url);
    };
    ipcMain.on('setup:submit', handler);
    input.on('closed', () => {
      ipcMain.removeListener('setup:submit', handler);
      resolve(loadSettings().serverUrl ?? null);
    });
  });
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{ role: 'appMenu' }] as MenuItemConstructorOptions[])
      : ([] as MenuItemConstructorOptions[])),
    {
      label: 'ファイル',
      submenu: [
        {
          label: '印刷 / PDFとして保存',
          accelerator: 'CmdOrCtrl+P',
          click: () => win?.webContents.print({}),
        },
        {
          label: 'PDFとして保存…',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => void savePdf(),
        },
        { type: 'separator' },
        {
          label: '接続先を変える…',
          click: () => void changeServer(),
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '閉じる' } : { role: 'quit', label: '終了' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { role: 'undo', label: '元に戻す' },
        { role: 'redo', label: 'やり直す' },
        { type: 'separator' },
        { role: 'cut', label: '切り取り' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: '貼り付け' },
        { role: 'selectAll', label: 'すべて選択' },
      ],
    },
    {
      label: '表示',
      submenu: [
        { role: 'reload', label: '再読み込み' },
        { type: 'separator' },
        { role: 'resetZoom', label: '拡大率を戻す' },
        { role: 'zoomIn', label: '拡大' },
        { role: 'zoomOut', label: '縮小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全画面表示' },
        { role: 'toggleDevTools', label: '開発者ツール' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** 図面をPDFにして保存する（印刷ダイアログを通さない一発保存） */
async function savePdf(): Promise<void> {
  if (!win) return;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'PDFとして保存',
    defaultPath: '単線結線図.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return;
  try {
    const data = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, landscape: false });
    writeFileSync(filePath, data);
  } catch (e) {
    await dialog.showMessageBox(win, {
      type: 'error',
      message: 'PDFを保存できませんでした。',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

async function changeServer(): Promise<void> {
  const url = await askServerUrl(win ?? undefined);
  if (url && win) await win.loadURL(url);
}

function createWindow(url: string): void {
  const saved = loadSettings().window;
  win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 940,
    x: saved?.x,
    y: saved?.y,
    minWidth: 900,
    minHeight: 600,
    title: '単線結線図作成',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  if (saved?.maximized) win.maximize();

  void win.loadURL(url);

  // 外部のリンクは既定のブラウザで開く
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  // PNG/SVGの保存は、保存先を聞いてから書き出す
  win.webContents.session.on('will-download', (_event, item) => {
    void dialog
      .showSaveDialog(win!, { title: '保存', defaultPath: item.getFilename() })
      .then(({ canceled, filePath }) => {
        if (canceled || !filePath) item.cancel();
        else item.setSavePath(filePath);
      });
  });

  win.webContents.on('did-fail-load', (_e, _code, description) => {
    void dialog.showMessageBox(win!, {
      type: 'error',
      title: '接続できません',
      message: 'サーバーに接続できませんでした。',
      detail: `${description}\n\n接続先: ${url}\n「ファイル」→「接続先を変える…」から設定を見直してください。`,
    });
  });

  const remember = () => {
    if (!win) return;
    const b = win.getBounds();
    saveSettings({ window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() } });
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(async () => {
  buildMenu();
  const url = loadSettings().serverUrl ?? process.env.ZUMEN_SERVER_URL ?? (await askServerUrl());
  if (!url) {
    app.quit();
    return;
  }
  createWindow(url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
