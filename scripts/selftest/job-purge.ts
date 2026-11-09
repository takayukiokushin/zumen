/**
 * 自己診断の道具。読み取りの記録（apps/server/src/analyze-jobs.ts）の、片づけ・上限・やめる、を確かめる。
 *
 *   node ... job-purge.ts      （結果を JSON で1行出す）
 */
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-fake-for-test';
const { startJob, getJob, cancelJob, runningJobOf, purgeAnalyzeJobs, JOB_RETAIN_MS, JOBS_PER_USER } = await import('../../apps/server/src/analyze-jobs.ts');
const ok = { result: { answers: {}, evidence: {}, uncertain: [], notes: [], questions: [] } } as never;
const tick = () => new Promise((r) => setTimeout(r, 20));
const out: Record<string, unknown> = {};

// 終わった記録は、1人に JOBS_PER_USER 件まで（古いものから消える）
const ids: string[] = [];
for (let i = 0; i < JOBS_PER_USER + 3; i++) {
  ids.push(startJob('u1', async () => ok).id);
  await tick();
}
purgeAnalyzeJobs();
const kept = ids.filter((id) => getJob('u1', id) !== null);
out.perUserCap = kept.length === JOBS_PER_USER && kept[0] === ids[3] && kept.at(-1) === ids.at(-1);
// 別の人の記録は、巻き込まれない
const other = startJob('u2', async () => ok);
await tick();
out.otherUserSeen = getJob('u1', other.id) === null && getJob('u2', other.id) !== null;

// 期限が過ぎた記録は消える。途中のものは、消えない
let release: () => void = () => undefined;
const running = startJob('u3', () => new Promise((resolve) => (release = () => resolve(ok))));
out.runningFound = runningJobOf('u3')?.id === running.id;
const removedLater = purgeAnalyzeJobs(Date.now() + JOB_RETAIN_MS + 60_000);
out.expiredRemoved = removedLater >= 1;
out.runningKept = getJob('u3', running.id) !== null;

// やめると、AI への問い合わせを止める合図が出て、記録が消える
let aborted = false;
const j = startJob('u4', (signal) => new Promise((_r, rej) => signal.addEventListener('abort', () => { aborted = true; rej(new Error('abort')); })));
out.cancelOk = cancelJob('u4', j.id) && aborted && getJob('u4', j.id) === null && runningJobOf('u4') === null;
out.cancelOther = cancelJob('u3', j.id) === false;
release();
await tick();
out.doneAfterRelease = getJob('u3', running.id)?.state === 'done';
console.log(JSON.stringify(out));
process.exit(0);
export {};
