import { buildComposition, CHAIN_BY_FORM, DOWNSTREAM, EXTRAS, indexedKey, maxCountOf, parseTransformerLabel, QUESTIONS, SENDOUT, TRANSFORMER, UPSTREAM, countOf } from '@zumen/knowledge';
import type { Answers, Condition, Placement, Value } from '@zumen/knowledge';
import { layout } from '@zumen/layout';
import { getSymbol } from '@zumen/symbols';
import { digest, fromLayout, sameName } from './doc.ts';
import type { Doc, Overrides } from './doc.ts';
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
    const common = [...(keySets[0] ?? [])].filter((k) => keySets.every((s) => s.has(k)));
    const countKeys = new Set(ps.map((p) => p.repeatCountKey).filter((k): k is string => Boolean(k)));
    table.set(role, {
      role,
      symbolIds,
      ...(common.length === 1 && countKeys.size === 0 ? { presenceKey: common[0]! } : {}),
      ...(countKeys.size === 1 ? { countKey: [...countKeys][0]! } : {}),
    });
  }
  rolesCache = table;
  return table;
}

const Q = new Map(QUESTIONS.map((q) => [q.id, q]));
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
  count?: { key: string; remove?: number; conn?: string };
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
export function writeBack(raw: Answers, doc: Doc, toEffective: (a: Answers) => Answers): WritebackResult | null {
  if (!doc.base || doc.edited !== true) return null;
  const ov = collectOverrides(doc);
  if (!hasOverrides(ov)) return null;

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
    const unit = transformerUnit(name);
    if (unit < 0) continue;
    if (e.symbolId && (CONN_SYMBOLS.has(e.symbolId) || e.symbolId === 'tr-blank')) {
      cands.push({
        kind: 'replaced',
        symbol: nameJaOf(e.symbolId),
        set: { [indexedKey('trConnection', unit)]: e.symbolId === 'tr-blank' ? undefined : e.symbolId },
      });
    }
    if (e.label) cands.push({ kind: 'relabel', symbol: nameJaOf(e.symbolId ?? baseNames.get(name) ?? 'transformer'), set: {}, label: { name, lines: e.label } });
  }

  // 消した記号：「あり／なし」を「なし」に。最後の台なら、台数を1つ減らす（後ろの台から）
  const removed = [...ov.removed].sort((a, b) => (repeatOf(b, table)?.no ?? 0) - (repeatOf(a, table)?.no ?? 0));
  for (const name of removed) {
    const sym = baseNames.get(name) ?? name;
    const rep = repeatOf(name, table);
    if (rep) cands.push({ kind: 'removed', symbol: nameJaOf(sym), count: { key: rep.info.countKey!, remove: rep.no } });
    else if (table.get(name)?.presenceKey) cands.push({ kind: 'removed', symbol: nameJaOf(sym), set: { [table.get(name)!.presenceKey!]: 'no' } });
  }

  // 足した記号：「あり／なし」を「あり」に。台数を1つ増やす
  for (const a of added) {
    const S = a.item.symbolId;
    const presence = [...table.values()].filter((r) => r.presenceKey && r.symbolIds.has(S) && !baseNames.has(r.role) && eff0[r.presenceKey] !== 'yes');
    const keys = new Set(presence.map((r) => r.presenceKey!));
    const counts = new Set(
      [...table.values()].filter((r) => r.countKey && (r.symbolIds.has(S) || (r.role === 'transformer' && (CONN_SYMBOLS.has(S) || S === 'tr-blank')))).map((r) => r.countKey!),
    );
    if (keys.size === 1 && counts.size === 0) cands.push({ kind: 'added', symbol: nameJaOf(S), set: { [[...keys][0]!]: 'yes' } });
    else if (counts.size === 1 && keys.size === 0) {
      const ck = [...counts][0]!;
      cands.push({ kind: 'added', symbol: nameJaOf(S), count: { key: ck, ...(ck === 'transformerCount' && S !== 'tr-blank' ? { conn: S } : {}) } });
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
      return false;
    }
    return true;
  };

  let lastGen: Doc | null = null;
  for (const c of cands) {
    const set: Answers = { ...(c.set ?? {}) };
    // 台数：いまの台数から決める（最後の台を消したときだけ、1つ減らす）
    if (c.count) {
      const n = countOf(toEffective(acc)[c.count.key], 1, maxCountOf(c.count.key));
      if (c.count.remove !== undefined) {
        if (c.count.remove !== n || n <= 1) continue;
        set[c.count.key] = n - 1;
      } else {
        if (n + 1 > maxCountOf(c.count.key)) continue;
        set[c.count.key] = n + 1;
        if (c.count.conn) set[indexedKey('trConnection', n)] = c.count.conn;
      }
    }

    // 文字の書き換えは、そのときの結線方式で読み取る
    if (c.label) {
      const unit = transformerUnit(c.label.name);
      const conn = String(toEffective(acc)[indexedKey('trConnection', unit)] ?? '');
      const parsed = parseTransformerLabel(c.label.lines, conn, unit);
      if (!parsed) continue;
      Object.assign(set, parsed);
    }
    if (Object.keys(set).length === 0) continue;

    const trial = withKeys(acc, set);
    const gen = buildGenerated(toEffective(trial));
    const pairs = new Map<string, string>();
    for (const it of gen.items) if (it.kind === 'symbol') pairs.set(sameName(it.id), it.symbolId);
    let ok = explained(pairs);
    if (ok && c.label) {
      const g = gen.items.find((it) => it.kind === 'symbol' && sameName(it.id) === c.label!.name);
      ok = g?.kind === 'symbol' && JSON.stringify(g.label) === JSON.stringify(c.label.lines);
    }
    if (ok) {
      acc = trial;
      accepted.push({ ...c, set });
      lastGen = gen;
    } else if (c.kind !== 'relabel') {
      rejected.push({ kind: c.kind, symbol: c.symbol });
    }
  }

  /* ---- 結果 ---- */
  const applied: AppliedChange[] = [];
  for (const c of accepted) {
    for (const k of Object.keys(c.set ?? {})) {
      const unitM = /^(.*?)(?:__(\d+))?$/.exec(k)!;
      const id = unitM[1]!;
      const from = valueText(id, eff0[k]);
      const to = valueText(id, toEffective(acc)[k]);
      if (from === to) continue;
      applied.push({ question: questionLabel(id), unit: unitM[2] ? Number(unitM[2]) : 0, from, to });
    }
  }

  if (accepted.length === 0 || !lastGen) {
    return { answers: raw, doc, applied: [], rejected, leftovers: leftoversOf(ov) };
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
      removed: o.removed.filter((n) => !vanished.has(n)),
      wiresRemoved: o.wiresRemoved.filter((k) => !keyNames(k).some((n) => vanished.has(n))),
      added: addedKept,
    };
  });
  const rebuilt = carryOver(next.doc, doc);
  return { answers: acc, doc: rebuilt, applied, rejected, leftovers: leftoversOf(rebuilt.overrides) };
}

/** 入力には出ない、手で直した内容の件数 */
export function leftoversOf(ov: Overrides | undefined): Leftover[] {
  if (!ov) return [];
  const out: Leftover[] = [];
  const push = (kind: Leftover['kind'], n: number) => {
    if (n > 0) out.push({ kind, n });
  };
  const moved = Object.values(ov.moved);
  push('moved', moved.filter((e) => e.dx !== 0 || e.dy !== 0 || e.rotate !== undefined || e.dLabelDx !== undefined || e.dLabelDy !== undefined).length);
  push('replaced', moved.filter((e) => e.symbolId !== undefined).length);
  push('relabel', moved.filter((e) => e.label !== undefined || e.values !== undefined).length);
  push('removed', ov.removed.length);
  push('wireRemoved', ov.wiresRemoved.length);
  push('addedSymbol', ov.added.filter((a) => a.kind === 'symbol').length);
  push('addedText', ov.added.filter((a) => a.kind === 'text').length);
  push('addedWire', ov.added.filter((a) => a.kind === 'wire').length);
  push('frames', Object.keys(ov.frames ?? {}).length);
  return out;
}
