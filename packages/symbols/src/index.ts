import type { SymbolDef } from './types.ts';
import { validateSymbol } from './types.ts';
import { circle, earth, hline, line, rect, shapesToSvg, text, vline } from './shape.ts';
import { incomingSymbols } from './defs/incoming.ts';
import { PAS_SCALE, switchgearSymbols } from './defs/switchgear.ts';
import { scaleSymbol } from './scale.ts';
import { ON_WIRE_ORIGIN, onWireDefs } from './defs/onwire.ts';
import { instrumentSymbols } from './defs/instrument.ts';
import { protectionSymbols } from './defs/protection.ts';
import { transformerSymbols } from './defs/transformer.ts';
import { DASH_DOT, miscSymbols } from './defs/misc.ts';

export * from './shape.ts';
export * from './types.ts';
export { scaleSymbol } from './scale.ts';
export { PAS_SCALE } from './defs/switchgear.ts';
export { ON_WIRE_ORIGIN } from './defs/onwire.ts';
export { BOUNDARY_SAFETY_LEFT } from './defs/incoming.ts';

/**
 * 記号マスタ。新しい機器はここに定義を1件足すだけで、
 * パレット・カタログ・プロパティ入力欄・PDF出力のすべてに反映される。
 */
const BASE_SYMBOLS: readonly SymbolDef[] = [
  ...incomingSymbols,
  ...switchgearSymbols,
  ...instrumentSymbols,
  ...protectionSymbols,
  ...transformerSymbols,
  ...miscSymbols,
];

/**
 * PAS・PGS・UGS の中に入る機器は、枠と同じ比率（PAS_SCALE）に縮めた専用の記号にする（第20弾 項目7）。
 *  - ZPD（zpd-pas・zpd-pas-boxed）は、PAS専用なので、そのまま縮める
 *  - ZCT・VT・LA は、ほかの場所でも使う（縮めない）ので、縮めたものを別の記号（zct-pas・vt-pas・la-pas）として足す。
 *    ZCTは、枠の上辺・開閉部の横棒との隙間を詰めるため、上下の余白を削った形で作る
 */
const baseOf = (id: string): SymbolDef => {
  const d = BASE_SYMBOLS.find((s) => s.id === id);
  if (!d) throw new Error(`記号が無い: ${id}`);
  return d;
};
const ZCT_PAS_BASE: SymbolDef = {
  ...baseOf('zct'),
  // 円（ZCT）の上下の余白を、13 → 7 に詰める（円の半径 11・斜線・「3」は、そのまま）
  box: { w: 52, h: 36 },
  shapes: [
    vline(20, 0, 36),
    circle(20, 18, 11),
    line(20 - 10 / Math.SQRT2, 18 + 10 / Math.SQRT2, 20 + 10 / Math.SQRT2, 18 - 10 / Math.SQRT2),
    text(24.75, 21, '3', { size: 9 }),
    hline(18, 31, 52),
  ],
  ports: [
    { id: 'in', x: 20, y: 0, dir: 'up', role: 'line' },
    { id: 'out', x: 20, y: 36, dir: 'down', role: 'line' },
    { id: 'sec', x: 52, y: 18, dir: 'right', role: 'control', label: 'GR/DGRへ' },
  ],
};
const insideOf = (src: SymbolDef, id: string, nameJa: string): SymbolDef =>
  scaleSymbol(src, PAS_SCALE, {
    id,
    nameJa,
    altOf: baseOf(src.id).id,
    optional: true,
    tags: [...(src.tags ?? []), 'PAS', 'PGS', '内蔵'],
    note: 'PAS・PGS・UGSの枠の中に入れる、縮めた記号。形は元の記号と同じ',
  });

/**
 * 線の上に乗せる記号（VCT・CT・ZCT・PAS内蔵のZCT）の、以前の形（縦線・入口・出口の接続点あり。第20弾 項目2より前）。
 * 自動作図が、主回路に並べる位置を決めるのに使う（決めたあと、新しい形に直す。packages/layout/src/onwire.ts）。画面・図面には出さない。
 */
export const CHAIN_SYMBOLS: Readonly<Record<string, SymbolDef>> = {
  vct: baseOf('vct'),
  ct: baseOf('ct'),
  zct: baseOf('zct'),
  'zct-pas': insideOf(ZCT_PAS_BASE, 'zct-pas', '零相変流器（PAS・PGS内蔵用）'),
};
const NEW_ON_WIRE = onWireDefs({ vct: baseOf('vct'), ct: baseOf('ct'), zct: baseOf('zct') });

export const SYMBOLS: readonly SymbolDef[] = [
  ...BASE_SYMBOLS.map((s) =>
    s.id === 'zpd-pas' || s.id === 'zpd-pas-boxed'
      ? scaleSymbol(s, PAS_SCALE)
      : s.id === 'vct' || s.id === 'ct' || s.id === 'zct'
        ? NEW_ON_WIRE[s.id]
        : s,
  ),
  scaleSymbol(NEW_ON_WIRE.zct, PAS_SCALE, {
    id: 'zct-pas',
    nameJa: '零相変流器（PAS・PGS内蔵用）',
    altOf: 'zct',
    optional: true,
    tags: [...(NEW_ON_WIRE.zct.tags ?? []), 'PAS', 'PGS', '内蔵'],
    note: 'PAS・PGS・UGSの枠の中に入れる、縮めた記号。形は元の記号と同じ',
  }),
  insideOf(baseOf('vt'), 'vt-pas', '計器用変圧器（PAS・PGS内蔵用）'),
  insideOf(baseOf('la'), 'la-pas', '避雷器（PAS・PGS内蔵用）'),
];

/** 自動作図が使う記号（以前の形があるものは、以前の形） */
// （'constructor'・'toString' のような名前を、記号と取り違えないよう、自分で持っているものだけを見る）
const chainOf = (id: string): SymbolDef | undefined => (Object.hasOwn(CHAIN_SYMBOLS, id) ? CHAIN_SYMBOLS[id] : undefined);
export const chainSymbol = (id: string): SymbolDef => chainOf(id) ?? getSymbol(id);
export const chainFind = (id: string): SymbolDef | undefined => chainOf(id) ?? findSymbol(id);
/** 線の上に乗せる記号（VCT・CT・ZCT・PAS内蔵のZCT）の記号IDか */
export const isOnWireId = (id: string): boolean => Object.hasOwn(ON_WIRE_ORIGIN, id);

const byId = new Map(SYMBOLS.map((s) => [s.id, s]));

/**
 * 廃止した記号。以前の版で保存した図面・案件に、まだ残っているものを、開けるようにするための読み替え。
 * 記号の一覧（パレット・カタログ）には出さない。読み込むと、右の記号として描かれる。
 *   relay-ocgr（地絡過電流継電器）→ relay-gr（地絡継電器）：OCGRは、GRで足りるので、記号をやめた
 */
export const RETIRED_SYMBOLS: Readonly<Record<string, string>> = { 'relay-ocgr': 'relay-gr' };

export function getSymbol(id: string): SymbolDef {
  const def = byId.get(id) ?? byId.get(RETIRED_SYMBOLS[id] ?? '');
  if (!def) throw new Error(`未登録の記号ID: ${id}`);
  return def;
}

export function findSymbol(id: string): SymbolDef | undefined {
  return byId.get(id) ?? byId.get(RETIRED_SYMBOLS[id] ?? '');
}

/** 図面の上で決めた大きさ。省いた向きは、記号定義の大きさのまま */
export interface SymbolSize {
  w?: number;
  h?: number;
}

/** 大きさを、変えられる範囲に収める（変えられない記号・向きは、記号定義のまま） */
export function clampSize(def: SymbolDef, size: SymbolSize = {}): { w: number; h: number } {
  const r = def.resizable;
  const fit = (v: number | undefined, base: number, range?: { min: number; max: number }) =>
    range && typeof v === 'number' && Number.isFinite(v) ? Math.max(range.min, Math.min(range.max, v)) : base;
  return { w: fit(size.w, def.box.w, r?.w), h: fit(size.h, def.box.h, r?.h) };
}

/**
 * 図面の上で幅・高さを変えた記号の、box と shapes を作り直して返す。
 * 大きさを変えられない記号、または大きさが定義のままのときは、定義をそのまま返す
 * （同じ記号は、何度呼んでも同じオブジェクト）。
 */
export function sizedSymbol(def: SymbolDef, size?: SymbolSize): SymbolDef {
  if (!def.resizable || !size) return def;
  const { w, h } = clampSize(def, size);
  if (w === def.box.w && h === def.box.h) return def;
  // 接地の記号：幅だけで決める（縦横の比は、定義のまま）。縦の線・3本の横線の長さは、同じ比で伸び縮みし、線の太さは変えない
  if (def.resizable.style === 'earth') {
    const k = w / def.box.w;
    const hh = Math.round(def.box.h * k * 10) / 10;
    return {
      ...def,
      box: { w, h: hh },
      shapes: [vline(w / 2, 0, 8 * k), ...earth(w / 2, 8 * k, k)],
      ports: def.ports.map((p) => ({ ...p, x: w / 2 })),
    };
  }
  const shapes =
    def.resizable.style === 'bracket'
      ? [hline(6, 0, w), vline(0, 6, h), vline(w, 6, h)]
      : [rect(0, 0, w, h, { dash: DASH_DOT })];
  return { ...def, box: { w, h }, shapes };
}

/** 記号マスタ全体の整合性チェック（IDの重複・ポートの位置など） */
export function validateAll(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const def of SYMBOLS) {
    if (seen.has(def.id)) errors.push(`記号ID重複: ${def.id}`);
    seen.add(def.id);
    if (def.altOf && !byId.has(def.altOf)) errors.push(`${def.id}: altOf "${def.altOf}" が存在しない`);
    for (const slot of def.slots ?? []) {
      for (const acc of slot.accepts) {
        if (!byId.has(acc)) errors.push(`${def.id}: slot "${slot.id}" のaccepts "${acc}" が存在しない`);
      }
    }
    errors.push(...validateSymbol(def));
  }
  return errors;
}

export interface SvgOptions {
  /** 記号の周囲の余白 */
  padding?: number;
  /** 表示倍率（viewBoxは変えずwidth/heightのみ拡大） */
  scale?: number;
  /** ポートを可視化する（カタログ・デバッグ用） */
  showPorts?: boolean;
  /** 読み上げ用の名前（無ければ、記号の日本語の名前）。画面で選んでいる言葉に訳した名前を渡す */
  label?: string;
}

/** 記号1つを単体のSVG文字列にする */
export function symbolToSvg(def: SymbolDef, opts: SvgOptions = {}): string {
  const pad = opts.padding ?? 6;
  const scale = opts.scale ?? 1;
  const w = def.box.w + pad * 2;
  const h = def.box.h + pad * 2;
  const ports = opts.showPorts
    ? [
        '    <g class="ports">',
        ...def.ports.map(
          (p) =>
            `      <circle cx="${p.x}" cy="${p.y}" r="2.2" fill="currentColor" stroke="none" class="port" />`,
        ),
        '    </g>',
      ].join('\n')
    : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" role="img" aria-label="${(opts.label ?? def.nameJa).replace(/"/g, '&quot;')}">`,
    `  <g transform="translate(${pad} ${pad})" stroke="${def.color ?? 'currentColor'}"${def.color ? ` color="${def.color}"` : ''} fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    shapesToSvg(def.shapes),
    ports,
    `  </g>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join('\n');
}
