import { QUESTIONS, areaCountOf, areaView, missingRequired, normalizeAnswers } from '@zumen/knowledge';
import type { Answers } from '@zumen/knowledge';
import type { AnalysisResult } from './schema.ts';

/**
 * AIの読み取り結果を、人が確認するための一覧にする。
 *
 * 構成ルールと突き合わせて矛盾を見つけるので、AIが読み違えても
 * そのまま図面に入らないようにする。
 */

export type ReviewLevel =
  /** 矛盾している。直さないと図面が成立しない */
  | 'error'
  /** 読み取れたが確認してほしい */
  | 'confirm'
  /** 読み取れなかったので聞きたい */
  | 'ask';

export interface ReviewItem {
  level: ReviewLevel;
  questionId?: string;
  label: string;
  /** AIが読み取った値（表示用） */
  value?: string;
  /** メモのどこから読み取ったか */
  evidence?: string;
  message: string;
}

const labelOf = (id: string): string => QUESTIONS.find((q) => q.id === id)?.label ?? id;

const displayValue = (id: string, v: unknown): string => {
  const q = QUESTIONS.find((x) => x.id === id);
  const opt = q?.options?.find((o) => o.value === String(v));
  return opt ? opt.label : String(v);
};

/** 読み取り結果と、いまの回答を突き合わせて確認事項を作る */
export function buildReview(result: AnalysisResult, current: Answers): ReviewItem[] {
  const merged: Answers = { ...current, ...(result.answers as Answers) };
  const items: ReviewItem[] = [];

  // 1. 自信が無いと申告された項目
  for (const id of result.uncertain) {
    if (!(id in result.answers)) continue;
    items.push({
      level: 'confirm',
      questionId: id,
      label: labelOf(id),
      value: displayValue(id, result.answers[id]),
      evidence: result.evidence[id],
      message: 'メモから読み取りましたが、確信が持てません。合っているかご確認ください。',
    });
  }

  // 2. AIからの追加質問
  for (const q of result.questions) {
    items.push({
      level: 'ask',
      questionId: q.questionId || undefined,
      label: q.questionId ? labelOf(q.questionId) : '確認',
      message: `${q.ask}（${q.why}）`,
    });
  }

  // 3. 構成ルールとの矛盾
  items.push(...checkConsistency(merged));

  // 4. 未回答の必須項目
  for (const q of missingRequired(merged)) {
    items.push({
      level: 'ask',
      questionId: q.id,
      label: q.label,
      message: 'メモから読み取れませんでした。入力してください。',
    });
  }

  return dedupe(items);
}

/** ナレッジベースの決まりごとに反しないかを見る */
export function checkConsistency(raw: Answers): ReviewItem[] {
  const a = normalizeAnswers(raw);
  const items: ReviewItem[] = [];
  // 区分開閉器（PAS・PGS）があるか。まだ答えていないときは、これまでどおりPASありとして見る
  const hasPas = (a.sectionalizer ?? 'pas') !== 'none';
  const noPas = a.sectionalizer === 'none';
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));

  // 設備容量と主遮断装置の形式
  // 電灯および動力のV結線は、電灯の容量と動力の容量の合計（ふつうは、1台目の容量）
  // 受電設備エリアが2か所以上のときは、すべてのエリアの変圧器の合計で見る
  const areaKva = (v: Record<string, unknown>) => {
    const mixed = v.trConnection === 'tr-vv' && v.trUsage === '電灯・動力';
    const unit = mixed ? num(v.trCapacityLight) + num(v.trCapacityPower) : num(v.trCapacity);
    return unit * Math.max(1, num(v.transformerCount) || 1);
  };
  const parts = [areaKva(a)];
  for (let n = 1; n < areaCountOf(a); n++) parts.push(areaKva(normalizeAnswers(areaView(a, n))));
  // 2か所目以降で、容量がまだ入っていないものは、0として数える（合計は「少なくともこれだけ」になる）
  const allKnown = parts.every((p) => Number.isFinite(p));
  const total = parts.reduce((sum, p, i) => sum + (Number.isFinite(p) ? p : i === 0 ? NaN : 0), 0);

  // 用途と結線方式の組み合わせ（電灯は単相系とV結線、動力は三相とV結線）
  const conn = String(a.trConnection ?? '');
  if (a.trUsage === '電灯' && conn.startsWith('tr-3p')) {
    items.push({
      level: 'confirm',
      questionId: 'trConnection',
      label: '変圧器の結線方式',
      value: '三相',
      message: '用途が電灯なのに、三相の結線方式になっています。電灯は、ふつう単相（またはV結線）です。確認してください。',
    });
  }
  if (a.trUsage === '動力' && (conn === 'tr-1p' || conn === 'tr-1p-2w' || conn === 'tr-1p-parallel')) {
    items.push({
      level: 'confirm',
      questionId: 'trConnection',
      label: '変圧器の結線方式',
      value: '単相',
      message: '用途が動力なのに、単相の結線方式になっています。動力は、ふつう三相（またはV結線）です。確認してください。',
    });
  }
  if (Number.isFinite(total) && total > 0 && a.mainBreakerForm) {
    if (total > 300 && a.mainBreakerForm === 'pfs') {
      items.push({
        level: 'error',
        questionId: 'mainBreakerForm',
        label: '主遮断装置の形式',
        value: 'PFS形',
        message: `高圧変圧器の合計容量が${total}kVA（301kVA以上）なので、CB形でなければなりません。`,
      });
    }
    if (allKnown && total <= 300 && a.mainBreakerForm === 'cb') {
      items.push({
        level: 'confirm',
        questionId: 'mainBreakerForm',
        label: '主遮断装置の形式',
        value: 'CB形',
        message: `合計容量が${total}kVA（300kVA以下）なのでPFS形も選べます。CB形で合っていますか。`,
      });
    }
  }

  // DGRは零相電圧が必要（内蔵VTかZPDのどちらか）
  if (hasPas && a.pasControl === 'dgr' && a.pasBuiltinVt !== 'yes' && a.hasZpd !== 'yes') {
    items.push({
      level: 'error',
      questionId: 'pasBuiltinVt',
      label: 'DGRの零相電圧源',
      message: 'DGR（方向性）には零相電圧が必要です。PASのVT内蔵か、ZPDのどちらかを指定してください。',
    });
  }

  // GR・DGRはZCTが要る（記号は構成ルールが自動で入れるため、SOGなしとの取り違えを見る）
  if (hasPas && a.pasControl === 'none' && a.hasZpd === 'yes') {
    items.push({
      level: 'confirm',
      questionId: 'pasControl',
      label: 'PASのSOG',
      value: 'なし',
      message: 'ZPDがあるのにSOGが「なし」になっています。GRかDGRではありませんか。',
    });
  }

  // SOGが無いPASにVTは入らない
  if (hasPas && a.pasControl === 'none' && a.pasBuiltinVt === 'yes') {
    items.push({
      level: 'error',
      questionId: 'pasControl',
      label: 'PASの内蔵VT',
      value: 'SOGなし・VT内蔵あり',
      message:
        'SOGが無いPASにVTは内蔵されません。SOG（GRまたはDGR）があるか、' +
        'VTは内蔵されていないかのどちらかです。',
    });
  }

  // 3点不一致のときは、どの機器の上に責任分界点があるか要る。
  // ただし主遮断装置の形式が決まっていれば、そこから決まる（CB形ならVCB、PFS形ならLBS）ので聞かない
  const mainKnown = a.mainBreakerForm === 'cb' || a.mainBreakerForm === 'pfs';
  if (a.boundaryPattern === 'split' && !mainKnown && !a.boundarySafetyDevice) {
    items.push({
      level: 'ask',
      questionId: 'boundarySafetyDevice',
      label: '責任分界点の位置',
      message: '3点不一致です。責任分界点がLBSとVCBのどちらの上にあるか教えてください。',
    });
  }

  // 3点一致なのに、区分開閉器も地上キャビネットも無い
  // （区分開閉器が無くても、電力会社の地上キャビネットで受電する場合は、3点一致でよい）
  if (a.boundaryPattern === 'coincident' && noPas && a.groundCabinet === 'no') {
    items.push({
      level: 'confirm',
      questionId: 'boundaryPattern',
      label: '責任分界点',
      value: '3点一致',
      message: '区分開閉器も地上キャビネットも無い場合、3点一致ではない可能性が高いです（ナレッジベース3-1）。確認してください。',
    });
  }

  // 定格電圧は現場で使い分けるため、決め打ちさせない
  for (const [id, label] of [
    ['pasRatedVoltage', 'PASの定格電圧'],
    ['lbsRatedVoltage', 'LBSの定格電圧'],
  ] as const) {
    if (a[id] === undefined || a[id] === '') {
      const relevant = id === 'pasRatedVoltage' ? hasPas : a.mainBreakerForm === 'pfs';
      if (relevant) {
        items.push({
          level: 'ask',
          questionId: id,
          label,
          message: 'メモに記載がありませんでした。7200Vと6600Vは現場で使い分けるため、確認が必要です。',
        });
      }
    }
  }

  // 受電設備が2箇所以上なら、エリアごとの形態・設置場所が要る
  if (num(a.areaCount) >= 2) {
    items.push({
      level: 'ask',
      label: '受電設備エリア',
      message: `受電設備が${num(a.areaCount)}箇所あります。各エリアの形態と設置場所を入力してください（2箇所以上のときは各エリアを一点鎖線で囲います）。`,
    });
  }

  return items;
}

function dedupe(items: ReviewItem[]): ReviewItem[] {
  const seen = new Set<string>();
  const order: Record<ReviewLevel, number> = { error: 0, confirm: 1, ask: 2 };
  return items
    .filter((i) => {
      const key = `${i.level}:${i.questionId ?? ''}:${i.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => order[a.level] - order[b.level]);
}
