import type { SymbolDef } from './types.ts';
import { validateSymbol } from './types.ts';
import { hline, rect, shapesToSvg, vline } from './shape.ts';
import { incomingSymbols } from './defs/incoming.ts';
import { switchgearSymbols } from './defs/switchgear.ts';
import { instrumentSymbols } from './defs/instrument.ts';
import { protectionSymbols } from './defs/protection.ts';
import { transformerSymbols } from './defs/transformer.ts';
import { DASH_DOT, miscSymbols } from './defs/misc.ts';

export * from './shape.ts';
export * from './types.ts';
export { BOUNDARY_SAFETY_LEFT } from './defs/incoming.ts';

/**
 * 記号マスタ。新しい機器はここに定義を1件足すだけで、
 * パレット・カタログ・プロパティ入力欄・PDF出力のすべてに反映される。
 */
export const SYMBOLS: readonly SymbolDef[] = [
  ...incomingSymbols,
  ...switchgearSymbols,
  ...instrumentSymbols,
  ...protectionSymbols,
  ...transformerSymbols,
  ...miscSymbols,
];

const byId = new Map(SYMBOLS.map((s) => [s.id, s]));

export function getSymbol(id: string): SymbolDef {
  const def = byId.get(id);
  if (!def) throw new Error(`未登録の記号ID: ${id}`);
  return def;
}

export function findSymbol(id: string): SymbolDef | undefined {
  return byId.get(id);
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
    `  <g transform="translate(${pad} ${pad})" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    shapesToSvg(def.shapes),
    ports,
    `  </g>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join('\n');
}
