import { contextBridge, ipcRenderer } from 'electron';

/** 接続先の設定ページからだけ使う、最小限の受け渡し */
contextBridge.exposeInMainWorld('zumenSetup', {
  submit: (url: string) => ipcRenderer.send('setup:submit', url),
});
