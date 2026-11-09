import { randomUUID } from 'node:crypto';
import type { AnalyzeResponse } from './analyze.ts';
import { AnalyzeTimeoutError } from './analyze.ts';
import { describeAnalyzeFailure } from './analyze-errors.ts';

/**
 * 手書きメモの読み取りを、「頼む」と「結果を受け取る」に分けるための、作業の記録（サーバーの記憶の中だけ）。
 *
 * 読み取りは、数十秒から数分かかる。外から入る設定（Cloudflare）には、1回の通信を約100秒で切る決まりがあるので、
 * 「頼んで、終わるまで通信をつなぎっぱなしにする」作りでは、100秒を超えると、画面に「失敗」と出る
 * （裏では、読み取りが続いて、料金だけかかる）。そこで、
 *   1. 頼む（すぐ「受け付けました」と返る）
 *   2. 画面が、2〜3秒おきに「終わったか」を聞きに行く（1回ずつの通信は短い）
 * の形にした。通信が途中で切れても、読み取りは続いていて、つながり直せば、結果を受け取れる。
 *
 * 記録は、サーバーを止めると消える（案件のデータとは別。ディスクには書かない）。
 */

export interface Job {
  id: string;
  userId: string;
  state: 'running' | 'done' | 'error';
  startedAt: number;
  finishedAt: number | null;
  result: AnalyzeResponse | null;
  /** 失敗したときの、利用者への案内 */
  error: string | null;
  /** 失敗の種類（時間切れは 504、それ以外は 502） */
  code: number | null;
  /** AI への問い合わせを、途中でやめるためのもの */
  ctl: AbortController;
}

/** 終わった記録を残しておく時間（画面が受け取り損ねても、あとで受け取れるように） */
export const JOB_RETAIN_MS = 30 * 60_000;
/** 1人の、終わった記録は、この件数まで */
export const JOBS_PER_USER = 5;

const jobs = new Map<string, Job>();

/** その人が、いま読み取っている最中の記録 */
export function runningJobOf(userId: string): Job | null {
  for (const j of jobs.values()) if (j.userId === userId && j.state === 'running') return j;
  return null;
}

/** 古い記録と、多すぎる記録を片づける。消した件数を返す */
export function purgeAnalyzeJobs(now = Date.now()): number {
  let n = 0;
  const perUser = new Map<string, Job[]>();
  for (const j of jobs.values()) {
    if (j.state === 'running') continue;
    if (now - (j.finishedAt ?? j.startedAt) > JOB_RETAIN_MS) {
      jobs.delete(j.id);
      n++;
      continue;
    }
    const list = perUser.get(j.userId) ?? [];
    list.push(j);
    perUser.set(j.userId, list);
  }
  for (const list of perUser.values()) {
    list.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    for (const old of list.slice(JOBS_PER_USER)) {
      jobs.delete(old.id);
      n++;
    }
  }
  return n;
}

/** 読み取りを始める。裏で動かして、すぐ記録を返す */
export function startJob(userId: string, run: (signal: AbortSignal) => Promise<AnalyzeResponse>): Job {
  purgeAnalyzeJobs();
  const job: Job = {
    id: randomUUID(),
    userId,
    state: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    result: null,
    error: null,
    code: null,
    ctl: new AbortController(),
  };
  jobs.set(job.id, job);
  run(job.ctl.signal).then(
    (result) => {
      job.state = 'done';
      job.result = result;
      job.finishedAt = Date.now();
    },
    (e: unknown) => {
      // 「やめる」で止めたものは、記録ごと消してあるので、何もしない
      if (!jobs.has(job.id)) return;
      console.error('解析に失敗しました', e);
      job.state = 'error';
      job.error = describeAnalyzeFailure(e);
      job.code = e instanceof AnalyzeTimeoutError ? 504 : 502;
      job.finishedAt = Date.now();
    },
  );
  return job;
}

/** その人の記録を探す（ほかの人の記録は見えない） */
export function getJob(userId: string, id: string): Job | null {
  const j = jobs.get(id);
  return j && j.userId === userId ? j : null;
}

/** 読み取りをやめて、記録を消す（終わっているものは、記録だけ消す）。消したら true */
export function cancelJob(userId: string, id: string): boolean {
  const j = getJob(userId, id);
  if (!j) return false;
  jobs.delete(id);
  if (j.state === 'running') j.ctl.abort();
  return true;
}

/** 試験用：記録を全部忘れる */
export function resetAnalyzeJobs(): void {
  for (const j of jobs.values()) if (j.state === 'running') j.ctl.abort();
  jobs.clear();
}
