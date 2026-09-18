import type { Answers } from '@zumen/knowledge';
import type { Doc } from '../editor/doc.ts';

/** サーバーとのやり取り。認証はCookieなので、どの呼び出しも credentials: 'include' で行う */

export interface User {
  id: string;
  name: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  file_count: number;
}

export interface ProjectDetail {
  id: string;
  name: string;
  answers: Answers;
  drawing: Doc | null;
  files: { id: string; file_name: string; media_type: string; size: number }[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? '通信に失敗しました。');
  return json as T;
}

export const api = {
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

  uploadFile: (projectId: string, file: { fileName: string; mediaType: string; data: string }) =>
    call<{ id: string }>(`/api/projects/${projectId}/files`, { method: 'POST', body: JSON.stringify(file) }),
};
