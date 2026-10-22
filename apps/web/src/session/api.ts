import type { Answers } from '@zumen/knowledge';
import type { Doc } from '../editor/doc.ts';

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

export interface ProjectDetail {
  id: string;
  name: string;
  answers: Answers;
  drawing: Doc | null;
  files: { id: string; file_name: string; media_type: string; size: number }[];
  lock: Lock | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, lock, remaining, lockMinutes, lockedSec } = json as {
      error?: string;
      lock?: Lock;
      remaining?: number;
      lockMinutes?: number;
      lockedSec?: number;
    };
    const message = error ?? '通信に失敗しました。';
    if (res.status === 409) throw new LockedError(message, lock ?? null);
    if (path === '/api/auth/login') throw new LoginError(message, remaining, lockMinutes, lockedSec);
    throw new Error(message);
  }
  return json as T;
}

export const api = {
  /** サーバーの状態。手書きメモの読み取りが使えるかどうかもここで分かる */
  health: () => call<{ ok: true; hasApiKey: boolean; userCount: number }>('/api/health'),
  me: () => call<{ user: User | null }>('/api/auth/me'),
  login: (userId: string, password: string) =>
    call<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ userId, password }) }),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  listProjects: () => call<{ projects: ProjectSummary[] }>('/api/projects'),
  createProject: (name: string) =>
    call<{ id: string }>('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  getProject: (id: string) => call<ProjectDetail>(`/api/projects/${id}`),
  saveProject: (id: string, patch: { name?: string; answers?: Answers; drawing?: Doc | null }) =>
    call<{ ok: true; updatedAt: string }>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteProject: (id: string) => call<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),

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
