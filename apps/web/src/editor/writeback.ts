import { areaCountOf, areaKey, areaView, buildComposition, CHAIN_BY_FORM, referencedKeys, DOWNSTREAM, EXTRAS, indexedKey, linkFromOf, linkStageCountOf, linkStagePrefix, maxCountOf, parseTransformerLabel, PER_AREA_QUESTION_IDS, PER_UNIT_QUESTION_IDS, QUESTION_GROUPS, QUESTIONS, SENDOUT, TRANSFORMER, UPSTREAM, countOf } from '@zumen/knowledge';
import type { Answers, Condition, Placement, Value } from '@zumen/knowledge';
import { layout } from '@zumen/layout';
import { getSymbol } from '@zumen/symbols';
import { digest, fromLayout, sameName } from './doc.ts';
import type { Doc, DocSymbol, Overrides } from './doc.ts';
import { carryOver } from './layers.ts';
import { collectOverrides, hasOverrides, rebuildWithOverrides } from './overrides.ts';

/**
 * 図面で直した内容を、「設備を入力して作成」の答えに書き戻す（第13弾 項目1）。
 *
 * 基本のルール：**手で直した図面を、いつも優先する。**
 *   - 入力の項目と1対1で対応する変更だけを、答えに書き戻す
 *       ・変圧器の記号を別の種類に差し替えた → 結線方式
 *       ・変圧器の文字（用途・容量・電圧など）を書き換えた → 用途・容量・電圧
 *       ・「あり／なし」で決まる記号（LA・ZPDなど）を足した・消した → あり／なし
 *       ・変圧器・コンデンサなどを、最後の台として足した・消した → 台数
 *   - 書き戻せない変更（位置・向き・足した文字や線など）は、図面にだけ残す（入力は変えない）
 *   - 書き戻す前に、答えを変えた図面を作って確かめる。「ほかの記号も変わってしまう」ときは、書き戻さない
 *
 * 画面と同じ手順（回答 → 構成 → 配置 → 図面）で、仮の図面を作って確かめるので、ここでの判断は、
 * 画面に出る図面と食い違わない。
 */

/** 書き戻した内容（画面の帯に出す。文字は、すべて、質問の定義にある日本語のまま） */
export interface AppliedChange {
  /** 質問の見出し（例：結線方式） */
  question: string;
  /** 何台目か（0＝台ごとの質問ではない。1以上＝その台） */
  unit: number;
  /** 何か所目のエリアか（0＝1か所目、またはエリアごとの質問ではない。1以上＝2か所目以降） */
  area: number;
  from: string;
  to: string;
}

/** 書き戻さなかった変更（ほかの記号も変わってしまうなど） */
export interface RejectedChange {
  kind: 'replaced' | 'relabel' | 'removed' | 'added';
  /** 記号の名前（日本語） */
  symbol: string;
}

/** 入力には出ない（図面にだけ残す）変更の件数 */
export interface Leftover {
  kind: 'moved' | 'relabel' | 'replaced' | 'removed' | 'wireRemoved' | 'addedSymbol' | 'addedText' | 'addedWire' | 'frames';
  n: number;
  /** 記号の名前（日本語。消した・差し替えた・足した・文字を直した記号。同じ名前は、まとめる） */
  names?: string[];
}

export interface WritebackResult {
  /** 書き戻したあとの答え（書き戻すものが無ければ、渡した答えのまま） */
  answers: Answers;
  /** 書き戻したあとの図面（書き戻すものが無ければ、渡した図面のまま） */
  doc: Doc;
  applied: AppliedChange[];
  rejected: RejectedChange[];
  leftovers: Leftover[];
}

/** 画面と同じ手順で、答えから、自動の図面を作る */
export function buildGenerated(effective: Answers): Doc {
  const composition = buildComposition(effective);
  const basis = digest(JSON.stringify(composition.map((i) => [i.role, i.symbolId, i.label, i.unit ?? 0])));
  return fromLayout(layout(composition, effective), basis);
}

/* ------------------------------------------------------------------ */
/* 記号と入力項目の対応（構成ルールから、自動で読み取る）                       */
/* ------------------------------------------------------------------ */

/** 条件が「この質問が 'yes'（あり）のとき」を求めているときの質問ID */
function yesKeys(c: Condition | undefined): string[] {
  if (!c) return [];
  if ('key' in c && 'eq' in c && c.eq === 'yes') return [c.key];
  if ('all' in c) return c.all.flatMap(yesKeys);
  return [];
}

interface RoleInfo {
  role: string;
  /** 決まった記号（{...}を使うものは含めない） */
  symbolIds: Set<string>;
  /** その機器が出る・出ないを決める「あり／なし」の質問 */
  presenceKey?: string;
  /** 台数の質問（繰り返す機器） */
  countKey?: string;
  /** 台数のある機器を出す・出さないを決める「あり／なし」の質問（コンデンサの「あり」など。最後の1台を消したとき「なし」にする） */
  groupKey?: string;
  /** 台ごとの「あり／なし」の質問（変圧器のPC・LBS・ケーブルなど。その部品を消したとき、その台だけ「なし」にする） */
  unitKey?: string;
}

let rolesCache: Map<string, RoleInfo> | null = null;
function roleTable(): Map<string, RoleInfo> {
  if (rolesCache) return rolesCache;
  const all: Placement[] = [...UPSTREAM, ...DOWNSTREAM, ...SENDOUT, ...TRANSFORMER, ...EXTRAS, ...Object.values(CHAIN_BY_FORM).flat()];
  const by = new Map<string, Placement[]>();
  for (const p of all) by.set(p.role, [...(by.get(p.role) ?? []), p]);
  const table = new Map<string, RoleInfo>();
  for (const [role, ps] of by) {
    const symbolIds = new Set(ps.map((p) => p.symbolId).filter((s) => !s.includes('{')));
    const keySets = ps.map((p) => new Set(yesKeys(p.when)));
    // 入力の質問そのものだけを、書き戻し先にする。構成の条件には、答えから自動で決まる目印（hasPas・intakeDs など）も使われているが、
    // それは入力の質問ではなく、書いても、次に読み直したときに上書きされて、効かない（図面で区分開閉器を消しても、入力のPASが変わらなかった）
    const common = [...(keySets[0] ?? [])].filter((k) => keySets.every((s) => s.has(k)));
    const countKeys = new Set(ps.map((p) => p.repeatCountKey).filter((k): k is string => Boolean(k)));
    table.set(role, {
      role,
      symbolIds,
      ...(common.length === 1 && countKeys.size === 0 && QUESTION_IDS.has(common[0]!) ? { presenceKey: common[0]! } : {}),
      ...(countKeys.size === 1 ? { countKey: [...countKeys][0]! } : {}),
      ...(common.length === 1 && countKeys.size === 1 && QUESTION_IDS.has(common[0]!) && !PER_UNIT_QUESTION_IDS.has(common[0]!) ? { groupKey: common[0]! } : {}),
      ...(countKeys.size === 1 && common.filter((k) => PER_UNIT_QUESTION_IDS.has(k)).length === 1 ? { unitKey: common.filter((k) => PER_UNIT_QUESTION_IDS.has(k))[0]! } : {}),
    });
  }
  rolesCache = table;
  return table;
}

/** 区分開閉器（PAS・PGS・UGS）の有無で出る・出ない、または形の変わる部品の役割（区分開閉器を消したとき、いっしょに消える・入れ替わる） */
let sectionalRolesCache: Set<string> | null = null;
function sectionalRoles(): Set<string> {
  if (sectionalRolesCache) return sectionalRolesCache;
  const all: Placement[] = [...UPSTREAM, ...DOWNSTREAM, ...SENDOUT, ...TRANSFORMER, ...EXTRAS, ...Object.values(CHAIN_BY_FORM).flat()];
  const out = new Set<string>();
  for (const p of all) {
    const keys = referencedKeys(p.when);
    if (keys.has('hasPas') || keys.has('sectionalizer')) out.add(p.role);
  }
  sectionalRolesCache = out;
  return out;
}

const Q = new Map(QUESTIONS.map((q) => [q.id, q]));
const QUESTION_IDS: ReadonlySet<string> = new Set(Q.keys());
const questionLabel = (id: string): string => Q.get(id)?.label ?? id;
/** 選択肢の名前（無ければ、値そのまま） */
function valueText(id: string, v: Value): string {
  if (v === undefined || v === null || v === '') return '—';
  const o = Q.get(id)?.options?.find((x) => x.value === String(v));
  return o ? o.label : String(v);
}

/** 結線方式の選択肢の値のうち、図記号の名前と同じもの（単相変圧器×3のΔ-Δ結線は、三相 Δ-Δ結線の記号と同じなので除く） */
const CONN_SYMBOLS: ReadonlySet<string> = new Set(
  (Q.get('trConnection')?.options ?? []).map((o) => o.value).filter((v) => v !== 'tr-3p-dd-1p3'),
);

/** 変圧器の機器名（transformer・transformer-2…）から、何台目か（0始まり）。変圧器でなければ -1 */
function transformerUnit(name: string): number {
  if (name === 'transformer') return 0;
  const m = /^transformer-(\d+)$/.exec(name);
  return m ? Number(m[1]) - 1 : -1;
}

/** 図面の名前（a2:transformer-2 など）から、何か所目のエリアか（0始まり）と、エリアの接頭辞を除いた名前に分ける */
function splitArea(name: string): { area: number; rest: string } {
  const m = /^a(\d+):(.*)$/.exec(name);
  return m ? { area: Number(m[1]) - 1, rest: m[2]! } : { area: 0, rest: name };
}

/** 入力の質問のキーを、そのエリアの答えのキーにする（エリアごとに答える質問だけ。1か所目と、エリアごとでない質問は、そのまま） */
function qKey(key: string, area: number): string {
  return area > 0 && PER_AREA_QUESTION_IDS.has(key.split('__')[0]!) ? areaKey(key, area) : key;
}

/** 機器名から、繰り返す機器の「役割」と何台目か（1始まり）を読み取る */
function repeatOf(name: string, table: Map<string, RoleInfo>): { info: RoleInfo; no: number } | null {
  const direct = table.get(name);
  if (direct?.countKey) return { info: direct, no: 1 };
  const m = /^(.+)-(\d+)$/.exec(name);
  const info = m ? table.get(m[1]!) : undefined;
  return m && info?.countKey ? { info, no: Number(m[2]) } : null;
}

/* ------------------------------------------------------------------ */
/* 本体                                                                   */
/* ------------------------------------------------------------------ */

interface Candidate {
  kind: RejectedChange['kind'];
  symbol: string;
  /** 変える答え（undefined＝消す） */
  set?: Answers;
  /** 台数を変えるとき：remove＝消した台の番号（1始まり。最後の台のときだけ）／ 無ければ1台増やす（conn＝足した台の結線方式） */
  count?: { key: string; area: number; remove?: number; conn?: string };
  /** 最後の1台を消したとき、「なし」にする質問（コンデンサの「あり」など） */
  lastGroupKey?: string;
  /** 台の本体を消したとき：その台のまわりの部品も、いっしょに消えたものとして扱う（どの台か） */
  carry?: { area: number; countKey: string; no: number };
  /** いっしょに消えたものとして扱う記号の名前（ケーブルの反対側の端末） */
  carryNames?: string[];
  /** 区分開閉器を消したとき：答えを変えると、図面に描いていない部品（地上キャビネット・DS・分界点の安全装置）が自動で増える。それは図面に出さず、消したままにする */
  suppressNew?: boolean;
  /** エリア間の接続のケーブル：どの送り先か決められないとき、候補を並べる（同じ名前の組のうち、最初に当てはまったものだけを使う） */
  alt?: string;
  /** この記号が、答えを変えたあとの図面から、無くなっていること（候補の確かめ） */
  mustVanish?: string;
  /** エリア間のケーブルの端末（送り出し側・受け側）が、いっしょに消えるものとして扱う */
  heads?: boolean;
  /** 区分開閉器まわりの部品（いっしょに消える・入れ替わる）を、いっしょに消えたものとして扱う（どのエリアか） */
  carrySectional?: { area: number };
  /** 変えたあとの、この機器の文字（確かめる） */
  label?: { name: string; lines: string[] };
}

const nameJaOf = (symbolId: string): string => {
  try {
    return getSymbol(symbolId).nameJa;
  } catch {
    return symbolId;
  }
};

const withKeys = (a: Answers, set: Answers): Answers => {
  const out = { ...a };
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
};

/**
 * 図面を手で直した内容のうち、入力に書き戻せるものを書き戻す。
 * 手で直した内容が何も無いとき（自動で作ったままの図面のとき）は null。
 *
 * @param raw 保存してある答え（画面の「回答」）
 * @param doc いまの図面
 * @param toEffective 画面が図面を作るときに使う、既定値などを足した答えにする関数
 */
function writeBackCore(raw: Answers, doc: Doc, toEffective: (a: Answers) => Answers, force = false): WritebackResult | null {
  if (!doc.base || doc.edited !== true) return null;
  const ov = collectOverrides(doc);
  if (!hasOverrides(ov) && !force) return null;

  const table = roleTable();
  const base = doc.base;
  const eff0 = toEffective(raw);
  const baseNames = new Map(Object.entries(base.symbols).map(([n, b]) => [n, b.symbolId]));
  const curByName = new Map<string, string>();
  for (const it of doc.items) if (it.kind === 'symbol') curByName.set(sameName(it.id), it.symbolId);
  const added = ov.added.filter((a) => a.kind === 'symbol' && !a.item.parent) as Extract<Overrides['added'][number], { kind: 'symbol' }>[];

  /* ---- 書き戻しの候補を集める ---- */
  const cands: Candidate[] = [];
  let acc: Answers = { ...raw };

  // 変圧器：記号の差し替え、文字の書き換え
  for (const [name, e] of Object.entries(ov.moved)) {
    const { area, rest } = splitArea(name);
    const unit = transformerUnit(rest);
    if (unit < 0) continue;
    if (e.symbolId && (CONN_SYMBOLS.has(e.symbolId) || e.symbolId === 'tr-blank')) {
      cands.push({
        kind: 'replaced',
        symbol: nameJaOf(e.symbolId),
        set: { [qKey(indexedKey('trConnection', unit), area)]: e.symbolId === 'tr-blank' ? undefined : e.symbolId },
      });
    }
    if (e.label) cands.push({ kind: 'relabel', symbol: nameJaOf(e.symbolId ?? baseNames.get(name) ?? 'transformer'), set: {}, label: { name, lines: e.label } });
  }

  // 消した記号：「あり／なし」を「なし」に。最後の台なら、台数を1つ減らす（後ろの台から）
  const removed = [...ov.removed].sort((a, b) => (repeatOf(splitArea(b).rest, table)?.no ?? 0) - (repeatOf(splitArea(a).rest, table)?.no ?? 0));
  /** 台の本体を消したとき、いっしょに消えたものとして扱う、その台のまわりの部品の名前 */
  const carried = new Set<string>();
  /** いま確かめている答えの変更で、自動で増える部品のうち、図面に出さないもの */
  let suppressNow = false;
  let headsNow = false;
  const suppressed = new Set<string>();
  for (const name of removed) {
    // いまの入力で、図面に出ていない部品（入力を変えて、機器ごと無くなったときの、前の「消した」記録）は、書き戻さない
    if (!baseNames.has(name)) continue;
    const { area, rest } = splitArea(name);
    const sym = baseNames.get(name) ?? name;
    const rep = repeatOf(rest, table);
    if (rep && UNIT_MAIN.has(rep.info.role)) {
      cands.push({ kind: 'removed', symbol: nameJaOf(sym), count: { key: rep.info.countKey!, area, remove: rep.no }, ...(rep.info.groupKey ? { lastGroupKey: qKey(rep.info.groupKey, area) } : {}), carry: { area, countKey: rep.info.countKey!, no: rep.no } });
    } else if (rep) {
      // 台のまわりの部品：ケーブルの端末 → その台の「ケーブル：なし」／開閉器（1〜3つ目）→ その欄を「なし」（最後の欄のとき）／PC・LBS・VCSなど → その台の「なし」
      const uk = (key: string) => qKey(indexedKey(key, rep.no - 1), area);
      const slot = /^(tr|cap|gen|motor)-cable-(up|dn)([123])$/.exec(rep.info.role);
      const head = /^(tr|cap|gen|motor)-cable-(source|site)$/.exec(rep.info.role);
      const slotKey = (k: number) => `${slot![1]}Cable${slot![2] === 'up' ? 'Up' : 'Dn'}${k}`;
      const msw = String(toEffective(raw)[uk('motorSwitch')] ?? 'none');
      const motorTo: Record<string, Record<string, string>> = {
        'motor-ds': { ds: 'none', 'ds-vcb': 'vcb' },
        'motor-vcb': { vcb: 'none', 'ds-vcb': 'ds' },
        'motor-lbs': { lbs: 'none' },
        'motor-lbs-plain': { 'lbs-plain': 'none' },
        'motor-mccb': { mccb: 'none' },
      };
      if (motorTo[rep.info.role]) {
        const to = motorTo[rep.info.role]![msw];
        if (to) cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [uk('motorSwitch')]: to } });
      } else if (rep.info.role === 'motor-vcs') cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [uk('motorSwitch2')]: 'none' } });
      else if (rep.info.role === 'relay-tt') cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [uk('relayTest')]: 'no' } });
      else if (slot) {
        const k = Number(slot[3]);
        const next = String(toEffective(raw)[uk(slotKey(k + 1))] ?? 'none');
        if (k === 3 || next === 'none') cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [uk(slotKey(k))]: 'none' } });
      } else if (head) {
        // ケーブルの端末を1つ消した → そのケーブルを消した。反対側の端末も、いっしょに消えたものとして扱う（開閉器・PCなどは、別に消す）
        const nm = (role: string) => `${area > 0 ? `a${area + 1}:` : ''}${role}${rep.no > 1 ? `-${rep.no}` : ''}`;
        cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [uk(head[1] === 'motor' ? 'motorCable' : `${head[1]}HasCable`)]: 'no' }, carryNames: [nm(`${head[1]}-cable-source`), nm(`${head[1]}-cable-site`)] });
      }
      else if (rep.info.unitKey) cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [uk(rep.info.unitKey)]: 'no' } });
    } else if (sectionalRoles().has(rest) && rest === 'pas') {
      // 区分開閉器を消した → 「区分開閉器：なし」。まわりの部品（分界点の線・構内柱・内蔵の機器）は、いっしょに消える。
      // 「なし」にすると自動で増える部品は、図面に出さない（消したままにする。必要なら、手で足す）
      cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [qKey('sectionalizer', area)]: 'none' }, suppressNew: true, carrySectional: { area } });
    } else if (/^sendout-(ds|vcb|lbs|vcs|as)(-\d+)?$/.test(rest) ) {
      // エリア間の接続の、送り出しの開閉器（k段目）：その開閉器を、組み合わせから外す（「DS＋VCB」からDSを消すと「VCB」）
      const m = /^sendout-(ds|vcb|lbs|vcs|as)(?:-(\d+))?$/.exec(rest)!;
      const k = m[2] ? Number(m[2]) : 1;
      const key = qKey(`${linkStagePrefix(k)}Switch`, area);
      const cur = String(toEffective(raw)[key] ?? 'none');
      const left = (cur === 'none' ? [] : cur.split('-')).filter((x) => x !== m[1]);
      const next = left.length === 0 ? 'none' : left.join('-');
      if (cur !== 'none' && left.length < cur.split('-').length && (Q.get('linkSwitch')?.options ?? []).some((o) => String(o.value) === next)) {
        cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [key]: next } });
      }
    } else if (/^cable-head-(send|site)(?:-(\d+))?(?:-s(\d+))?$/.test(rest) && (area > 0 || /cable-head-send|-s\d+$/.test(rest))) {
      // エリア間の接続のケーブルの端末：その段のケーブルを「なし」にする。どの送り先の線か決められないときは、候補を順に確かめる
      const m = /^cable-head-(send|site)(?:-(\d+))?(?:-s(\d+))?$/.exec(rest)!;
      const isRecvLast = m[1] === 'site' && !m[3] && area > 0;
      const dests = isRecvLast ? [area] : m[2] ? [Number(m[2]) - 1] : Array.from({ length: Math.max(0, areaCountOf(toEffective(raw)) - 1) }, (_, i) => i + 1);
      for (const d of dests) {
        if (d < 1) continue;
        const last = linkStageCountOf(areaView(toEffective(raw), d));
        // 段の指定がある端末は、その段。ないもの（最後の段の端末・受け側の端末）は、最後の段から1段目へ、順に確かめる
        // （受け側の端末は、1段目のケーブルの有無で出る・出ないが決まる作りのため）
        const stages = m[3] ? [Number(m[3])] : Array.from({ length: last }, (_, i) => last - i);
        for (const stage of stages) {
          cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [qKey(`${linkStagePrefix(stage)}Cable`, d)]: 'no' }, alt: name, mustVanish: name, heads: true });
        }
      }
    } else if (rest === 'cable-head-source' || rest === 'cable-head-site') {
      // 引込ケーブルの端末：「引込ケーブル：なし」。反対側の端末も、いっしょに消えたものとして扱う
      const nm = (role: string) => `${area > 0 ? `a${area + 1}:` : ''}${role}`;
      cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [qKey('cableInstallation', area)]: 'none' }, carryNames: [nm('cable-head-source'), nm('cable-head-site')] });
    } else if (table.get(rest)?.presenceKey) cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [qKey(table.get(rest)!.presenceKey!, area)]: 'no' } });
  }

  /** 台の本体（変圧器・コンデンサ・電動機など）の、図面の上の位置と、何か所目の何台目か（件数の質問ごと） */
  const mainsOf = (countKey: string): { area: number; no: number; x: number; y: number }[] => {
    const out: { area: number; no: number; x: number; y: number }[] = [];
    for (const it of doc.items) {
      if (it.kind !== 'symbol') continue;
      const sp = splitArea(sameName(it.id));
      const rep = repeatOf(sp.rest, table);
      if (!rep || rep.info.countKey !== countKey || !UNIT_MAIN.has(rep.info.role)) continue;
      out.push({ area: sp.area, no: rep.no, x: it.x, y: it.y });
    }
    return out;
  };

  // 足した記号：「あり／なし」を「あり」に。台数を1つ増やす
  for (const a of added) {
    const S = a.item.symbolId;
    const presence = [...table.values()].filter((r) => r.presenceKey && r.symbolIds.has(S) && !baseNames.has(r.role) && eff0[r.presenceKey] !== 'yes');
    const keys = new Set(presence.map((r) => r.presenceKey!));
    // 台の本体（変圧器・コンデンサ・電動機など）を足したとき：台数を1つ増やす。台のまわりの部品（PC・LBSなど）は、台数の対象ではない
    const counts = new Set(
      [...table.values()].filter((r) => r.countKey && UNIT_MAIN.has(r.role) && (r.symbolIds.has(S) || (r.role === 'transformer' && (CONN_SYMBOLS.has(S) || S === 'tr-blank')))).map((r) => r.countKey!),
    );
    if (keys.size === 1 && counts.size === 0) cands.push({ kind: 'added', symbol: nameJaOf(S), set: { [[...keys][0]!]: 'yes' } });
    else if (counts.size === 1 && keys.size === 0) {
      const ck = [...counts][0]!;
      cands.push({ kind: 'added', symbol: nameJaOf(S), count: { key: ck, area: 0, ...(ck === 'transformerCount' && S !== 'tr-blank' ? { conn: S } : {}) } });
    } else if (counts.size === 0) {
      // 台のまわりの部品（PC・LBS・VCS・リアクトルなど）：足した位置にいちばん近い台の「あり」にする
      const partRoles = [...table.values()].filter((r) => r.unitKey && r.countKey && r.symbolIds.has(S));
      let best: { d: number; set: Answers } | null = null;
      for (const r of partRoles) {
        for (const m of mainsOf(r.countKey!)) {
          const name = `${m.area > 0 ? `a${m.area + 1}:` : ''}${r.role}${m.no > 1 ? `-${m.no}` : ''}`;
          const key = qKey(indexedKey(r.unitKey!, m.no - 1), m.area);
          if (baseNames.has(name) || String(eff0[key] ?? '') === 'yes') continue;
          const d = (Math.abs(m.x - a.item.x) * 3) ** 2 + (m.y - a.item.y) ** 2;
          if (!best || d < best.d) best = { d, set: { [key]: 'yes' } };
        }
      }
      if (best) cands.push({ kind: 'added', symbol: nameJaOf(S), set: best.set });
    }
  }

  /* ---- 1つずつ、答えを変えた図面を作って確かめる ---- */
  const accepted: Candidate[] = [];
  const rejected: RejectedChange[] = [];
  const addedCount = new Map<string, number>();
  for (const a of added) addedCount.set(a.item.symbolId, (addedCount.get(a.item.symbolId) ?? 0) + 1);

  /** 答えを変えたとき、変わる記号が、すべて、手で直した内容で説明できるか */
  const explained = (genPairs: Map<string, string>): boolean => {
    const pool = new Map(addedCount);
    for (const [n, s] of baseNames) {
      if (genPairs.get(n) === s) continue;
      if (carried.has(n)) continue; // 消した台のまわりの部品は、台といっしょに消える
      if (headsNow && /(^|:)cable-head-(send|site)/.test(n)) continue; // エリア間のケーブルを「なし」にすると、両端の端末が消える
      const cur = curByName.get(n);
      if (cur === s) return false; // 手で直していないのに、消える・変わる
    }
    for (const [n, s] of genPairs) {
      if (baseNames.get(n) === s) continue;
      if (curByName.get(n) === s) continue; // 手で差し替えたとおりになった
      if (!baseNames.has(n) && (pool.get(s) ?? 0) > 0) {
        pool.set(s, pool.get(s)! - 1); // 手で足した記号が、自動の図面に出るようになった
        continue;
      }
      if (suppressNow && !baseNames.has(n)) {
        suppressed.add(n); // 自動で増える部品：図面には出さない
        continue;
      }
      return false;
    }
    return true;
  };

  let lastGen: Doc | null = null;
  const suppressedAll = new Set<string>();
  const altDone = new Set<string>();
  const rejectedAlt = new Map<string, RejectedChange>();
  for (const c of cands) {
    carried.clear();
    suppressed.clear();
    suppressNow = c.suppressNew === true;
    headsNow = c.heads === true;
    for (const n of c.carryNames ?? []) carried.add(n);
    if (c.carrySectional) {
      const roles = sectionalRoles();
      for (const n of baseNames.keys()) {
        const sp = splitArea(n);
        if (sp.area === c.carrySectional.area && roles.has(sp.rest.replace(/-\d+$/, '')) ) carried.add(n);
      }
    }
    if (c.carry) {
      for (const n of baseNames.keys()) {
        const sp = splitArea(n);
        const r = repeatOf(sp.rest, table);
        if (r && sp.area === c.carry.area && r.info.countKey === c.carry.countKey && r.no === c.carry.no) carried.add(n);
      }
    }
    const set: Answers = { ...(c.set ?? {}) };
    // 台数：いまの台数から決める（最後の台を消したときだけ、1つ減らす）
    if (c.count) {
      const ck = qKey(c.count.key, c.count.area);
      const n = countOf(toEffective(acc)[ck], 1, maxCountOf(c.count.key));
      if (c.count.remove !== undefined) {
        if (c.count.remove !== n) continue;
        if (n <= 1) {
          // 最後の1台：機器そのものを「なし」にする（コンデンサなど）。VT・CTの組数は、「0（なし）」を選べる
          if (c.lastGroupKey) set[c.lastGroupKey] = 'no';
          else if ((Q.get(c.count.key)?.options ?? []).some((o) => String(o.value) === '0')) set[ck] = '0';
          else continue;
        } else set[ck] = n - 1;
      } else {
        if (n + 1 > maxCountOf(c.count.key)) continue;
        set[ck] = n + 1;
        if (c.count.conn) set[qKey(indexedKey('trConnection', n), c.count.area)] = c.count.conn;
      }
    }

    // 文字の書き換えは、そのときの結線方式で読み取る
    if (c.label) {
      const { area, rest } = splitArea(c.label.name);
      const unit = transformerUnit(rest);
      const conn = String(toEffective(acc)[qKey(indexedKey('trConnection', unit), area)] ?? '');
      const parsed = parseTransformerLabel(c.label.lines, conn, unit);
      if (!parsed) continue;
      for (const [k, v] of Object.entries(parsed)) set[qKey(k, area)] = v;
    }
    if (Object.keys(set).length === 0) continue;

    if (c.alt && altDone.has(c.alt)) continue;
    const trial = withKeys(acc, set);
    const gen = buildGenerated(toEffective(trial));
    const pairs = new Map<string, string>();
    for (const it of gen.items) if (it.kind === 'symbol') pairs.set(sameName(it.id), it.symbolId);
    let ok = explained(pairs);
    if (ok && c.mustVanish && pairs.has(sameName(c.mustVanish))) ok = false;
    if (ok && c.label) {
      const g = gen.items.find((it) => it.kind === 'symbol' && sameName(it.id) === c.label!.name);
      ok = g?.kind === 'symbol' && JSON.stringify(g.label) === JSON.stringify(c.label.lines);
    }
    if (ok) {
      acc = trial;
      accepted.push({ ...c, set });
      if (c.alt) altDone.add(c.alt);
      for (const n of suppressed) suppressedAll.add(n);
      lastGen = gen;
    } else if (c.kind !== 'relabel') {
      // 候補を並べているもの（送り先が決められない端末）は、どれも当てはまらなかったときだけ、1つ断る
      if (!c.alt) rejected.push({ kind: c.kind, symbol: c.symbol });
      else if (!rejectedAlt.has(c.alt)) rejectedAlt.set(c.alt, { kind: c.kind, symbol: c.symbol });
    }
  }

  for (const [k, r] of rejectedAlt) if (!altDone.has(k)) rejected.push(r);

  /* ---- 結果 ---- */
  const applied: AppliedChange[] = [];
  for (const c of accepted) {
    for (const k of Object.keys(c.set ?? {})) {
      const areaM = /^a(\d+):(.*)$/.exec(k);
      const unitM = /^(.*?)(?:__(\d+))?$/.exec(areaM ? areaM[2]! : k)!;
      const id = unitM[1]!;
      const from = valueText(id, eff0[k]);
      const to = valueText(id, toEffective(acc)[k]);
      if (from === to) continue;
      applied.push({ question: questionLabel(id), unit: unitM[2] ? Number(unitM[2]) : 0, area: areaM ? Number(areaM[1]) - 1 : 0, from, to });
    }
  }

  if (!force && (accepted.length === 0 || !lastGen)) {
    return { answers: raw, doc, applied: [], rejected, leftovers: leftoversOf(ov, doc.base) };
  }

  const gen = buildGenerated(toEffective(acc));
  const genNames = new Set(gen.items.filter((it) => it.kind === 'symbol').map((it) => sameName(it.id)));
  const genPairs = new Map(gen.items.filter((it) => it.kind === 'symbol').map((it) => [sameName((it as { id: string }).id), (it as { symbolId: string }).symbolId] as const));
  const vanished = new Set([...baseNames.keys()].filter((n) => !genNames.has(n)));
  const keyNames = (k: string) => k.split('>').map((e) => e.slice(0, e.lastIndexOf('.')));

  const next = rebuildWithOverrides(gen, doc, (o) => {
    const moved = { ...o.moved };
    for (const [name, e] of Object.entries(moved)) {
      if (vanished.has(name)) {
        delete moved[name];
        continue;
      }
      const ne = { ...e };
      // 書き戻した、記号の種類・文字の違いは、もう手で直した内容ではない
      if (ne.symbolId && ne.symbolId === genPairs.get(name)) delete ne.symbolId;
      if (accepted.some((c) => c.label?.name === name)) {
        delete ne.label;
        delete ne.values;
      }
      const plain = ne.dx === 0 && ne.dy === 0 && Object.keys(ne).length === 2;
      if (plain) delete moved[name];
      else moved[name] = ne;
    }
    // 手で足した記号のうち、自動の図面に出るようになったものは、手で足したものから外す
    const pool = new Map<string, number>();
    for (const [n, s] of genPairs) if (!baseNames.has(n) && curByName.get(n) !== s) pool.set(s, (pool.get(s) ?? 0) + 1);
    const addedKept = o.added.filter((a) => {
      if (a.kind !== 'symbol' || a.item.parent) return true;
      const left = pool.get(a.item.symbolId) ?? 0;
      if (left > 0) {
        pool.set(a.item.symbolId, left - 1);
        return false;
      }
      return true;
    });
    return {
      ...o,
      moved,
      removed: [...o.removed.filter((n) => !vanished.has(n)), ...[...suppressedAll].filter((n) => genNames.has(n))],
      wiresRemoved: o.wiresRemoved.filter((k) => !keyNames(k).some((n) => vanished.has(n))),
      added: addedKept,
    };
  });
  const rebuilt = carryOver(next.doc, doc);
  return { answers: acc, doc: rebuilt, applied, rejected, leftovers: leftoversOf(rebuilt.overrides, rebuilt.base) };
}


/* ------------------------------------------------------------------ */
/* 途中の台を消したとき：後ろの台を、前へつめる                                  */
/* ------------------------------------------------------------------ */

/** 台の番号の入れ替え：消した台（j）を、いちばん後ろ（n）へ回し、後ろの台を1つずつ前へつめる（1始まり） */
const unitMap = (no: number, j: number, n: number): number => (no === j ? n : no > j ? no - 1 : no);

/** 繰り返す機器の、本体の記号（これを消すと、その台を消したことになる） */
const UNIT_MAIN: ReadonlySet<string> = new Set(['transformer', 'capacitor', 'generator', 'motor', 'aux-tr', 'ct', 'relay', 'vct-pole', 'vct-indoor', 'ds-vt', 'ds-vt-pf', 'site-vt', 'site-vt-pf']);

/** 件数の質問（countKey）で繰り返すグループの、台ごとの質問のID */
function unitQuestionIds(countKey: string): string[] {
  const g = QUESTION_GROUPS.find((x) => x.repeatCountKey === countKey);
  if (!g) return [];
  return QUESTIONS.filter((q) => q.group === g.id && q.id !== countKey && !q.shared).map((q) => q.id);
}

/** 「役割:何台目（0始まり）」の形の値（接続元など）か */
const REF = /^([a-z0-9-]+):(\d+)$/;

/** 図面の記録（レイヤーの印など）の中の、機器の名前を付け替える（near・target・item・key の名前だけ） */
function renameDeep<T>(v: T, ren: (name: string) => string, renKey: (k: string) => string): T {
  if (Array.isArray(v)) return v.map((x) => renameDeep(x, ren, renKey)) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if ((k === 'near' || k === 'target' || k === 'item') && typeof x === 'string') out[k] = ren(x);
      else if (k === 'key' && typeof x === 'string' && x.includes('>')) out[k] = renKey(x);
      else out[k] = renameDeep(x, ren, renKey);
    }
    return out as T;
  }
  return v;
}

/** 図面の記号の名前（id・親・線のつなぎ先・控え・レイヤーの印）を、ren で付け替える */
function renameDoc(doc: Doc, ren: (id: string) => string): Doc {
  const renName = (id: string): string => sameName(ren(id));
  const renKey = (k: string): string =>
    k
      .split('>')
      .map((e) => {
        const at = e.lastIndexOf('.');
        return `${renName(e.slice(0, at))}${e.slice(at)}`;
      })
      .sort()
      .join('>');
  const items = doc.items.map((it) => {
    if (it.kind === 'symbol') return { ...it, id: ren(it.id), ...(it.parent ? { parent: ren(it.parent) } : {}) };
    if (it.kind === 'wire') {
      return {
        ...it,
        ...(it.at1 ? { at1: { ...it.at1, item: ren(it.at1.item) } } : {}),
        ...(it.at2 ? { at2: { ...it.at2, item: ren(it.at2.item) } } : {}),
        ...(it.fan?.item ? { fan: { ...it.fan, item: ren(it.fan.item) } } : {}),
      };
    }
    return it;
  });
  const base = doc.base && {
    ...doc.base,
    symbols: Object.fromEntries(Object.entries(doc.base.symbols).map(([name, b]) => [renName(name), b])),
    wires: doc.base.wires.map(renKey),
  };
  const layers = doc.layers ? renameDeep(doc.layers, renName, renKey) : doc.layers;
  return { ...doc, items, ...(base ? { base } : {}), ...(layers ? { layers } : {}) };
}

/**
 * 途中の台を消したとき、消した台を「いちばん後ろの台」と入れ替えた形にする（答えの台ごとのキー・接続元の参照・図面の記号の名前）。
 * こうすると、「最後の台を消した」のと同じになり、あとの処理（台数を1つ減らす）が、そのまま使える。
 * 後ろの台は、1つずつ前の番号になる（答え・図面の手直しの記録も、一緒に付け替える）。
 */
function shiftUnit(raw: Answers, doc: Doc, area: number, countKey: string, j: number, n: number, table: Map<string, RoleInfo>): { raw: Answers; doc: Doc } {
  const out: Answers = { ...raw };
  for (const id of unitQuestionIds(countKey)) {
    const vals = Array.from({ length: n }, (_, u) => raw[qKey(indexedKey(id, u), area)]);
    for (let u = 1; u <= n; u++) {
      const key = qKey(indexedKey(id, unitMap(u, j, n) - 1), area);
      if (vals[u - 1] === undefined) delete out[key];
      else out[key] = vals[u - 1]!;
    }
  }
  // 接続元など、「役割:何台目」で台を指している答え
  const areaOfKey = (key: string): number => {
    const m = /^a(\d+):/.exec(key);
    const own = m ? Number(m[1]) - 1 : 0;
    // エリア間の接続の「分岐元の開閉器」は、送り出す側のエリアの機器を指す
    return /(^|:)linkDevice$/.test(key) || /(^|:)linkSourceTr$/.test(key) ? linkFromOf(areaView(raw, own), own) : own;
  };
  for (const [key, value] of Object.entries(out)) {
    // 継電器の「どこについているか」（CT n組目・VT n組目）は、CT・VTの組が前へつまると、つめた番号についていく
    if ((countKey === 'ctSetCount' || countKey === 'vtSetCount') && typeof value === 'string' && areaOfKey(key) === area && /^(a\d+:)?relayAt(__\d+)?$/.test(key)) {
      const pre = countKey === 'ctSetCount' ? 'ct' : 'vt';
      const rm = new RegExp(`^${pre}-(\\d+)$`).exec(value);
      if (rm) out[key] = `${pre}-${unitMap(Number(rm[1]), j, n)}`;
      continue;
    }
    if (/(^|:)linkSourceTr$/.test(key) && countKey === 'transformerCount' && areaOfKey(key) === area) {
      const v = Math.round(Number(value));
      if (Number.isFinite(v) && v >= 1 && v <= n) out[key] = unitMap(v, j, n);
      continue;
    }
    if (typeof value !== 'string') continue;
    const m = REF.exec(value);
    if (!m || areaOfKey(key) !== area) continue;
    const info = table.get(m[1]!);
    if (info?.countKey !== countKey) continue;
    out[key] = `${m[1]}:${unitMap(Number(m[2]) + 1, j, n) - 1}`;
  }

  // 図面の記号の名前（id・親・線のつなぎ先・控え・レイヤーの印）
  const ren = (id: string): string => {
    const am = /^(a\d+:)?(.*)$/.exec(id)!;
    if ((am[1] ? Number(am[1].slice(1, -1)) - 1 : 0) !== area) return id;
    const rep = repeatOf(am[2]!, table);
    if (!rep || rep.info.countKey !== countKey) return id;
    const no = unitMap(rep.no, j, n);
    const had = am[2] !== rep.info.role;
    return `${am[1] ?? ''}${rep.info.role}${had || no > 1 ? `-${no}` : ''}`;
  };
  return { raw: out, doc: renameDoc(doc, ren) };
}


/**
 * ケーブルの前後の開閉器（1〜3つ目）の、途中の欄を消したとき、消した欄を「いちばん後ろの欄」と入れ替えた形にする
 * （後ろの欄は、1つずつ前へつまる）。あとは、「最後の欄を消した」のと同じ。
 */
function shiftSlot(raw: Answers, doc: Doc, area: number, unit: number, p: string, side: 'Up' | 'Dn', k: number, last: number, table: Map<string, RoleInfo>): { raw: Answers; doc: Doc } {
  const out: Answers = { ...raw };
  const key = (m: number) => qKey(indexedKey(`${p}Cable${side}${m}`, unit), area);
  const vals = Array.from({ length: last }, (_, i) => raw[key(i + 1)]);
  for (let m = 1; m <= last; m++) {
    const from = m < k ? m : m < last ? m + 1 : k; // k より前はそのまま。k 以降は1つ前へ。いちばん後ろには、消した欄の値
    const v = vals[from - 1];
    if (v === undefined) delete out[key(m)];
    else out[key(m)] = v;
  }
  const role = `${p}-cable-${side.toLowerCase()}`;
  const ren = (id: string): string => {
    const am = /^(a\d+:)?(.*)$/.exec(id)!;
    if ((am[1] ? Number(am[1].slice(1, -1)) - 1 : 0) !== area) return id;
    const rep = repeatOf(am[2]!, table);
    const m = rep ? new RegExp(`^${role}([123])$`).exec(rep.info.role) : null;
    if (!rep || !m || rep.no !== unit + 1) return id;
    const old = Number(m[1]);
    const no = old === k ? last : old > k && old <= last ? old - 1 : old;
    if (no === old) return id;
    const had = am[2] !== rep.info.role;
    return `${am[1] ?? ''}${role}${no}${had ? `-${rep.no}` : ''}`;
  };
  return { raw: out, doc: renameDoc(doc, ren) };
}


/* ------------------------------------------------------------------ */
/* ケーブルの前後に開閉器を足したとき                                          */
/* ------------------------------------------------------------------ */

/** 足した記号 → ケーブル前後の開閉器の欄の値 */
const SLOT_VALUE: Record<string, string> = { ds: 'ds', vcb: 'vcb', 'lbs-pf': 'lbs', lbs: 'lbs-plain', vcs: 'vcs', as: 'as' };
/** 台の本体 → 質問IDの先頭 */
const UNIT_P: Record<string, string> = { transformer: 'tr', capacitor: 'cap', generator: 'gen', motor: 'motor' };

/**
 * 台のケーブルの手前（上）・あと（下）に、開閉器を足したとき、その台の開閉器の欄（1〜3つ目）に入れる。
 * 手前・あとは、足した位置が、ケーブルの端末の上か下かで、何つ目かは、すでにある開閉器との上下の並びで決める。
 * 迷うとき（ケーブルの途中・同じ開閉器がすでにある・3つを超える）は、何もしない（図面にだけ残る）。
 * 欄が1つ増えると、あとの欄の記号の名前が1つずつ後ろへずれるので、図面の記号の名前も付け替え、足した記号は、その欄の記号として扱う。
 */
function insertSwitches(raw: Answers, doc: Doc, toEffective: (a: Answers) => Answers, table: Map<string, RoleInfo>): { raw: Answers; doc: Doc; applied: AppliedChange[] } | null {
  let curRaw = raw;
  let curDoc = doc;
  const applied: AppliedChange[] = [];
  for (let guard = 0; guard < 8; guard++) {
    const ov = collectOverrides(curDoc);
    const eff = toEffective(curRaw);
    const adds = ov.added.filter((a) => a.kind === 'symbol' && !a.item.parent && SLOT_VALUE[a.item.symbolId] !== undefined) as Extract<Overrides['added'][number], { kind: 'symbol' }>[];
    let did = false;
    for (const a of adds) {
      const v = SLOT_VALUE[a.item.symbolId]!;
      const find = (name: string) => curDoc.items.find((i): i is Extract<Doc['items'][number], { kind: 'symbol' }> => i.kind === 'symbol' && sameName(i.id) === name);
      let best: { d: number; p: string; area: number; no: number; side: 'Up' | 'Dn'; idx: number; vals: string[] } | null = null;
      for (const it of curDoc.items) {
        if (it.kind !== 'symbol') continue;
        const sp = splitArea(sameName(it.id));
        const rep = repeatOf(sp.rest, table);
        if (!rep || !UNIT_MAIN.has(rep.info.role) || !UNIT_P[rep.info.role] || sp.rest.replace(/-\d+$/, '') !== rep.info.role) continue;
        const p = UNIT_P[rep.info.role]!;
        const uk = (k: string) => qKey(indexedKey(k, rep.no - 1), sp.area);
        if (String(eff[uk(p === 'motor' ? 'motorCable' : `${p}HasCable`)] ?? '') !== 'yes') continue;
        const nm = (role: string) => `${sp.area > 0 ? `a${sp.area + 1}:` : ''}${role}${rep.no > 1 ? `-${rep.no}` : ''}`;
        const src = find(nm(`${p}-cable-source`));
        const site = find(nm(`${p}-cable-site`));
        if (!src || !site) continue;
        const ay = a.item.y;
        const side: 'Up' | 'Dn' | null = ay < Math.min(src.y, site.y) ? 'Up' : ay > Math.max(src.y, site.y) && ay < it.y ? 'Dn' : null;
        if (!side || (p === 'motor' && side === 'Up')) continue;
        const vals: string[] = [];
        for (let k = 1; k <= 3; k++) {
          const x = String(eff[uk(`${p}Cable${side}${k}`)] ?? 'none');
          if (x === 'none') break;
          vals.push(x);
        }
        if (vals.length >= 3 || vals.includes(v)) continue;
        const above = vals.filter((_, i) => {
          const sy = find(nm(`${p}-cable-${side.toLowerCase()}${i + 1}`));
          return sy ? sy.y < ay : false;
        }).length;
        const d = (Math.abs(a.item.x - src.x) * 3) ** 2 + (ay - (side === 'Up' ? src.y : site.y)) ** 2;
        if (!best || d < best.d) best = { d, p, area: sp.area, no: rep.no, side, idx: above, vals };
      }
      if (!best) continue;
      const { p, area, no, side, idx, vals } = best;
      const uk = (k: string) => qKey(indexedKey(k, no - 1), area);
      const next = [...vals.slice(0, idx), v, ...vals.slice(idx)];
      const out: Answers = { ...curRaw };
      for (let k = 1; k <= 3; k++) out[uk(`${p}Cable${side}${k}`)] = next[k - 1] ?? 'none';
      const roleBase = `${p}-cable-${side.toLowerCase()}`;
      const prefix = area > 0 ? `a${area + 1}:` : '';
      const newName = `${prefix}${roleBase}${idx + 1}${no > 1 ? `-${no}` : ''}`;
      const ren = (id: string): string => {
        if (id === a.item.id) return newName;
        const am = /^(a\d+:)?(.*)$/.exec(id)!;
        if ((am[1] ? Number(am[1].slice(1, -1)) - 1 : 0) !== area) return id;
        const rep = repeatOf(am[2]!, table);
        const m = rep ? new RegExp(`^${roleBase}([123])$`).exec(rep.info.role) : null;
        if (!rep || !m || rep.no !== no) return id;
        const old = Number(m[1]);
        if (old < idx + 1) return id;
        return `${am[1] ?? ''}${roleBase}${old + 1}${am[2] !== rep.info.role ? `-${rep.no}` : ''}`;
      };
      const renamed = renameDoc(curDoc, ren);
      const item = renamed.items.find((i): i is DocSymbol => i.kind === 'symbol' && i.id === newName);
      if (!item || !renamed.base) continue;
      // 足した記号は、その欄の記号として扱う（自動で作ったものとして、控えに入れる。位置は、足したままの場所）
      const baseSyms = { ...renamed.base.symbols, [sameName(newName)]: { symbolId: item.symbolId, x: item.x, y: item.y, rotate: item.rotate, label: [...item.label], labelDx: item.labelDx, labelDy: item.labelDy, ...(item.values ? { values: { ...item.values } } : {}) } };
      curDoc = { ...renamed, base: { ...renamed.base, symbols: baseSyms } };
      const qk = `${p}Cable${side}${idx + 1}`;
      applied.push({ question: questionLabel(qk), unit: no > 1 ? no : 0, area, from: valueText(qk, eff[uk(qk)] ?? 'none'), to: valueText(qk, v) });
      curRaw = out;
      did = true;
      break;
    }
    if (!did) break;
  }
  return applied.length > 0 ? { raw: curRaw, doc: curDoc, applied } : null;
}

/**
 * 図面で直した内容を、「設備を入力して作成」の答えに書き戻す（本体は writeBackCore）。
 * 途中の台（変圧器・コンデンサなど）を消したときは、先に、後ろの台を前へつめてから書き戻す。
 */
/**
 * 図面で直した内容を、入力に書き戻す。
 * 部品を2つ以上消したときなど、1つ書き戻すと、ほかの書き戻しが通るようになることがあるので、反映が落ち着くまで、くり返す（最大4回）。
 */
export function writeBack(raw: Answers, doc: Doc, toEffective: (a: Answers) => Answers): WritebackResult | null {
  const first = writeBackOnce(raw, doc, toEffective);
  if (!first) return null;
  let acc = first;
  for (let i = 0; i < 4 && acc.applied.length > 0; i++) {
    const next = writeBackOnce(acc.answers, acc.doc, toEffective);
    if (!next || next.applied.length === 0) break;
    acc = { ...next, applied: [...acc.applied, ...next.applied] };
  }
  return acc;
}

function writeBackOnce(raw: Answers, doc: Doc, toEffective: (a: Answers) => Answers): WritebackResult | null {
  if (!doc.base || doc.edited !== true) return null;
  const table = roleTable();
  let curRaw = raw;
  let curDoc = doc;
  let shifted = false;
  // 消した台のうち、途中の台（後ろに台がある）を、1つずつ、いちばん後ろへ回す
  for (let guard = 0; guard < 12; guard++) {
    const ov = collectOverrides(curDoc);
    const eff = toEffective(curRaw);
    let hit: { area: number; countKey: string; j: number; n: number } | null = null;
    let slotHit: { area: number; unit: number; p: string; side: 'Up' | 'Dn'; k: number; last: number } | null = null;
    for (const name of ov.removed) {
      const { area, rest } = splitArea(name);
      const rep = repeatOf(rest, table);
      // ケーブルの前後の開閉器の、途中の欄を消したとき
      const sm = rep ? /^(tr|cap|gen|motor)-cable-(up|dn)([123])$/.exec(rep.info.role) : null;
      if (rep && sm) {
        const p = sm[1]!;
        const side = sm[2] === 'up' ? 'Up' : 'Dn';
        const k = Number(sm[3]);
        let last = 0;
        for (let m = 1; m <= 3; m++) if (String(eff[qKey(indexedKey(`${p}Cable${side}${m}`, rep.no - 1), area)] ?? 'none') !== 'none') last = m;
        if (k < last) {
          slotHit = { area, unit: rep.no - 1, p, side, k, last };
          break;
        }
        continue;
      }
      // 台の本体（機器の記号そのもの）を消したときだけ。ケーブルの端末・開閉器など、台のまわりの部品は、ここでは扱わない
      if (!rep || !UNIT_MAIN.has(rep.info.role)) continue;
      const countKey = rep.info.countKey!;
      const n = countOf(eff[qKey(countKey, area)], 1, maxCountOf(countKey));
      if (rep.no < n && n > 1) {
        hit = { area, countKey, j: rep.no, n };
        break;
      }
    }
    if (slotHit) {
      const r = shiftSlot(curRaw, curDoc, slotHit.area, slotHit.unit, slotHit.p, slotHit.side, slotHit.k, slotHit.last, table);
      curRaw = r.raw;
      curDoc = r.doc;
      shifted = true;
      continue;
    }
    if (!hit) break;
    const r = shiftUnit(curRaw, curDoc, hit.area, hit.countKey, hit.j, hit.n, table);
    curRaw = r.raw;
    curDoc = r.doc;
    shifted = true;
  }
  // ケーブルの前後に足した開閉器を、その台の開閉器の欄に入れる
  const pre = insertSwitches(curRaw, curDoc, toEffective, table);
  if (pre) {
    curRaw = pre.raw;
    curDoc = pre.doc;
  }
  const core = writeBackCore(curRaw, curDoc, toEffective, pre !== null);
  const res = core && pre ? { ...core, applied: [...pre.applied, ...core.applied] } : core;
  if (!shifted) return res;
  // 入れ替えたあと、ひとつも書き戻せなかった・断られたものがあるときは、入れ替えずに、そのまま扱う（答えも図面も、もとのまま）
  if (!res || res.applied.length === 0 || res.rejected.length > 0) return writeBackCore(raw, doc, toEffective);
  return res;
}

/** 記号の名前の一覧（同じ名前は1つにまとめる。名前が分からないものは、出さない） */
const uniqueNames = (l: (string | undefined)[]): string[] => [...new Set(l.filter((x): x is string => !!x))];

/** 入力には出ない、手で直した内容の件数（と、消した・差し替えた・足した記号の名前） */
export function leftoversOf(ov: Overrides | undefined, base?: Doc['base']): Leftover[] {
  if (!ov) return [];
  const out: Leftover[] = [];
  const push = (kind: Leftover['kind'], n: number, names?: string[]) => {
    if (n > 0) out.push({ kind, n, ...(names && names.length > 0 ? { names } : {}) });
  };
  const symName = (name: string): string | undefined => {
    const id = base?.symbols[name]?.symbolId;
    return id ? nameJaOf(id) : undefined;
  };
  const moved = Object.entries(ov.moved);
  push('moved', moved.filter(([, e]) => e.dx !== 0 || e.dy !== 0 || e.rotate !== undefined || e.dLabelDx !== undefined || e.dLabelDy !== undefined).length);
  push(
    'replaced',
    moved.filter(([, e]) => e.symbolId !== undefined).length,
    uniqueNames(moved.filter(([, e]) => e.symbolId !== undefined).map(([n, e]) => (symName(n) ? `${symName(n)}→${nameJaOf(e.symbolId!)}` : undefined))),
  );
  push('relabel', moved.filter(([, e]) => e.label !== undefined || e.values !== undefined).length, uniqueNames(moved.filter(([, e]) => e.label !== undefined || e.values !== undefined).map(([n]) => symName(n))));
  push('removed', ov.removed.length, uniqueNames(ov.removed.map(symName)));
  push('wireRemoved', ov.wiresRemoved.length);
  const addedSyms = ov.added.filter((a) => a.kind === 'symbol');
  push('addedSymbol', addedSyms.length, uniqueNames(addedSyms.map((a) => (a.kind === 'symbol' ? nameJaOf(a.item.symbolId) : undefined))));
  push('addedText', ov.added.filter((a) => a.kind === 'text').length);
  push('addedWire', ov.added.filter((a) => a.kind === 'wire').length);
  push('frames', Object.keys(ov.frames ?? {}).length);
  return out;
}
