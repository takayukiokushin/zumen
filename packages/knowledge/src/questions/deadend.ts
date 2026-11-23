import type { Question } from './types.ts';
import type { Condition } from '../condition.ts';
import { DEAD_END, YES_NO } from './common.ts';

/**
 * 行き止まりの分岐（図面にない設備へつながる分岐）の、ケーブルのあとの開閉器の箱（第20弾・図面再現の診断から）。
 * 2か所目以降のエリアの「形態」で、「行き止まりの分岐（図面にない設備へ）」を選んだときだけ、聞く。
 * 図面には、ケーブル → ケーブルの端末 → 開閉器の箱（AS・PAS・PGS・GS。中身は、区分開閉器と同じ選び方）→ 行き先の名前、だけを描く。
 * エリアの枠・変圧器・VT・CTなどは、描かない。
 */
const group = 'deadend';
const showIf = DEAD_END;
const SOG: Condition = { all: [DEAD_END, { key: 'deControl', in: ['gr', 'dgr'] }] };

export const DEADEND_QUESTIONS: Question[] = [
  {
    id: 'deKind',
    group,
    label: '開閉器の種類は？',
    type: 'select',
    options: [
      { value: 'as', label: 'AS（気中開閉器）' },
      { value: 'pas', label: 'PAS' },
      { value: 'pgs', label: 'PGS' },
      { value: 'gs', label: 'GS（ガス開閉器）' },
    ],
    defaultValue: 'as',
    dropdown: true,
    showIf,
    ask: 'ai-uncertain',
    help: 'ケーブルのあとの開閉器。内蔵のVT・LA・GR・DGRがあるときは、区分開閉器と同じ「箱」で描き、名前だけ変わる',
  },
  {
    id: 'deControl',
    group,
    label: 'GR・DGR（制御装置）は？',
    type: 'select',
    options: [
      { value: 'none', label: 'なし' },
      { value: 'gr', label: 'GR（無方向性）' },
      { value: 'dgr', label: 'DGR（方向性）' },
    ],
    defaultValue: 'dgr',
    showIf,
    ask: 'ai-uncertain',
  },
  {
    id: 'deBuiltinVt',
    group,
    label: 'VTは内蔵されていますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'yes',
    showIf: SOG,
    ask: 'ai-uncertain',
    help: '制御装置（GR・DGR）があるときだけ。図面には「VT内蔵型」と書く',
  },
  {
    id: 'deBuiltinLa',
    group,
    label: 'LAは内蔵されていますか？',
    type: 'select',
    options: YES_NO,
    defaultValue: 'no',
    showIf,
    ask: 'ai-uncertain',
    help: '制御装置（GR・DGR）が無くても、内蔵されていることがある',
  },
  {
    id: 'deRatedVoltage',
    group,
    label: '定格電圧は？',
    type: 'select',
    dropdown: true,
    options: [3300, 6600, 7200, 22000, 23000, 33000, 34500].map((v) => ({ value: String(v), label: `${v}V` })),
    showIf,
    ask: 'ai-uncertain',
  },
  {
    id: 'deRatedCurrent',
    group,
    label: '定格電流は？',
    type: 'select',
    dropdown: true,
    options: [100, 200, 300, 400].map((v) => ({ value: String(v), label: `${v}A` })),
    allowFreeInput: true,
    showIf,
    ask: 'always',
  },
  {
    id: 'deDestination',
    group,
    label: '行き先の名前（任意）',
    type: 'text',
    placeholder: '消火栓設備へ',
    size: 'l',
    showIf,
    ask: 'always',
    help: '開閉器の箱の下に、1行で書く（例：「消火栓設備へ」「他社設備へ」）。空欄なら、書かない',
  },
];
