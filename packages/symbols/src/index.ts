import type { SymbolDef } from './types.ts';
import { validateSymbol } from './types.ts';
import { shapesToSvg } from './shape.ts';
import { incomingSymbols } from './defs/incoming.ts';
import { switchgearSymbols } from './defs/switchgear.ts';
import { instrumentSymbols } from './defs/instrument.ts';
import { protectionSymbols } from './defs/protection.ts';
import { transformerSymbols } from './defs/transformer.ts';
import { miscSymbols } from './defs/misc.ts';

export * from './shape.ts';
export * from './types.ts';

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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" role="img" aria-label="${def.nameJa}">`,
    `  <g transform="translate(${pad} ${pad})" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    shapesToSvg(def.shapes),
    ports,
    `  </g>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join('\n');
}
