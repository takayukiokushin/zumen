import type { Answers } from '@zumen/knowledge';
import type { Doc } from '../editor/doc.ts';
import { describeFailure, isGateway } from './messages.ts';

/** サーバーとのやり取り。認証はCookieなので、どの呼び出しも credentials: 'include' で行う */

export type Role = 'admin' | 'member' | 'sandbox';

export const ROLE_LABEL: Record<Role, string> = {
  admin: '管理用',
  member: '標準',
  sandbox: '練習用',
};

export interface User {
  id: string;
  name: string;
  role: Role;
}

/** 誰かが編集中であることの印 */
export interface Lock {
  userId: string;
  userName: string;
  since: string;
}

/** ログインに失敗したときのエラー。あと何回で止まるか、止まっていればあと何秒かを持つ */
export class LoginError extends Error {
  constructor(
    message: string,
    readonly remaining?: number,
    readonly lockMinutes?: number,
    readonly lockedSec?: number,
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

/**
 * サーバーまで届かなかったときのエラー（電波・Wi-Fi・サーバーの停止など）。
 * 入力した内容は画面に残っているので、つながってからやり直せばよい。
 */
export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

/**
 * 保存しようとしたら、読み込んだあとに別の端末・画面で更新されていたときのエラー。
 * 上書きするか、最新を読み込み直すかを、利用者に選んでもらう
 */
export class StaleError extends Error {
  constructor(
    message: string,
    readonly updatedAt: string,
    readonly updatedByName: string | null,
  ) {
    super(message);
    this.name = 'StaleError';
  }
}

/** 編集中のため断られたときのエラー。誰が編集しているかを持つ */
export class LockedError extends Error {
  constructor(
    message: string,
    readonly lock: Lock | null,
  ) {
    super(message);
    this.name = 'LockedError';
  }
}

export interface ProjectSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  file_count: number;
  lock: Lock | null;
}

/** 練習用のアカウントがコピーできる、本番の案件 */
export interface PracticeSource {
  id: string;
  name: string;
  updatedAt: string;
  updatedBy: string | null;
  fileCount: number;
}

/** ごみ箱に入っている案件 */
export interface TrashItem {
  id: string;
  name: string;
  deletedAt: string;
  deletedBy: string | null;
  /** この日時を過ぎると、完全に消える */
  purgeAt: string;
  fileCount: number;
}

export interface ProjectDetail {
  id: string;
  name: string;
  updatedAt: string;
  answers: Answers;
  drawing: Doc | null;
  files: { id: string; file_name: string; media_type: string; size: number }[];
  lock: Lock | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'include',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      ...init,
    });
  } catch {
    // ブラウザは「Failed to fetch」のような英語の文を返すだけなので、分かる言葉に置き換える
    throw new ConnectionError(describeFailure(null));
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, lock, remaining, lockMinutes, lockedSec, stale, updatedAt, updatedByName } = json as {
      error?: string;
      lock?: Lock;
      stale?: boolean;
      updatedAt?: string;
      updatedByName?: string | null;
      remaining?: number;
      lockMinutes?: number;
      lockedSec?: number;
    };
    const message = describeFailure(res.status, error);
    if (res.status === 409 && stale && updatedAt) throw new StaleError(message, updatedAt, updatedByName ?? null);
    if (res.status === 409) throw new LockedError(message, lock ?? null);
    if (path === '/api/auth/login') throw new LoginError(message, remaining, lockMinutes, lockedSec);
    // 中継までは届いたが、先のサーバーが答えない場合も、つながらないのと同じ扱いにする
    if (!error && isGateway(res.status)) throw new ConnectionError(message);
    throw new Error(message);
  }
  return json as T;
}

export const api = {
  /** サーバーの状態。手書きメモの読み取りが使えるかどうかもここで分かる */
  health: () => call<{ ok: true; hasApiKey: boolean; userCount: number; version?: string }>('/api/health'),
  me: () => call<{ user: User | null }>('/api/auth/me'),
  /** 手書きメモの読み取り。通信の失敗も、ほかの呼び出しと同じ言葉で伝える */
  analyze: (body: { images: { mediaType: string; data: string }[]; answers: Answers }) =>
    call<{ result: unknown; review: unknown }>('/api/analyze', { method: 'POST', body: JSON.stringify(body) }),
  login: (userId: string, password: string) =>
    call<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ userId, password }) }),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  listProjects: () => call<{ projects: ProjectSummary[] }>('/api/projects'),
  /** answers：最初から入れておく回答（例：図面の名称を、事業場名称の初期値にする） */
  createProject: (name: string, answers?: Answers) =>
    call<{ id: string; updatedAt: string }>('/api/projects', { method: 'POST', body: JSON.stringify({ name, ...(answers ? { answers } : {}) }) }),
  getProject: (id: string) => call<ProjectDetail>(`/api/projects/${id}`),
  /**
   * baseUpdatedAt：この画面が読み込んだ（最後に保存した）時点の更新時刻。
   * 違っていたら StaleError で断られる。force なら確かめずに上書きする
   */
  saveProject: (
    id: string,
    patch: { name?: string; answers?: Answers; drawing?: Doc | null; baseUpdatedAt?: string; force?: boolean },
  ) =>
    call<{ ok: true; updatedAt: string }>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  /** 消す。本当には消えず、ごみ箱へ入る（30日間は戻せる） */
  deleteProject: (id: string) => call<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),
  /** 練習用のアカウントだけ：コピーできる本番の案件の一覧 */
  listPracticeSources: () => call<{ projects: PracticeSource[] }>('/api/projects/practice/sources'),
  /** 練習用のアカウントだけ：本番の案件を、練習用の案件としてコピーする（もとは変わらない） */
  copyToPractice: (sourceId: string) =>
    call<{ id: string; name: string; updatedAt: string }>('/api/projects/practice/copy', {
      method: 'POST',
      body: JSON.stringify({ sourceId }),
    }),
  /** 過去の図面を複製して、新しい案件を作る（事業場名称などは空。設備の内容と手直しはそのまま） */
  duplicateProject: (id: string) =>
    call<{ id: string; name: string; updatedAt: string }>(`/api/projects/${id}/duplicate`, { method: 'POST' }),
  listTrash: () => call<{ retainDays: number; projects: TrashItem[] }>('/api/projects/trash'),
  restoreProject: (id: string) => call<{ ok: true }>(`/api/projects/${id}/restore`, { method: 'POST' }),

  /** 編集を始める・続けていることを伝える。1分ごとに呼ぶ */
  takeLock: (id: string, force = false) =>
    call<{ lock: Lock | null }>(`/api/projects/${id}/lock`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),
  releaseLock: (id: string) => call<{ ok: true }>(`/api/projects/${id}/lock`, { method: 'DELETE' }),

  /* ---- 利用者の管理（管理用のアカウントのみ） ---- */
  listUsers: () => call<{ users: User[] }>('/api/admin/users'),
  addUser: (u: { id: string; name: string; password: string; role: Role }) =>
    call<{ ok: true }>('/api/admin/users', { method: 'POST', body: JSON.stringify(u) }),
  setUserPassword: (id: string, password: string) =>
    call<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    }),
  unlockUser: (id: string) =>
    call<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}/unlock`, { method: 'POST' }),
  removeUser: (id: string) =>
    call<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  uploadFile: (projectId: string, file: { fileName: string; mediaType: string; data: string }) =>
    call<{ id: string }>(`/api/projects/${projectId}/files`, { method: 'POST', body: JSON.stringify(file) }),
};
