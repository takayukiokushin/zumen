/**
 * 「保存は届いたのに、返事だけが、途中で失われた」ときの見分け。
 *
 * 電波が途切れて、「保存できたか」の返事が戻らないと、画面は「失敗」と思い、もう一度「保存」を押してもらう。
 * ところが、1回目はサーバーに届いて、保存できている。2回目は、「画面が読み込んだ時点」と、サーバーの更新時刻が
 * 食い違うので、「ほかの端末で更新されました」と断られてしまう（実際は、自分の保存）。
 * そこで、断られたときは、サーバーの内容を読んで、いま保存しようとしている内容と同じなら、「保存できている」と扱う。
 */

interface Patch {
  name?: string;
  answers?: unknown;
  drawing?: unknown;
}
interface Stored {
  name: string;
  answers: unknown;
  drawing: unknown;
}

/** 保存しようとした内容が、サーバーにある内容と、同じか（案件名・回答・図面） */
export function sameContent(patch: Patch, stored: Stored): boolean {
  const j = (v: unknown) => JSON.stringify(v ?? null);
  if (patch.name !== undefined && patch.name.trim() !== stored.name) return false;
  if (patch.answers !== undefined && j(patch.answers) !== j(stored.answers)) return false;
  if (patch.drawing !== undefined && j(patch.drawing) !== j(stored.drawing)) return false;
  return true;
}
