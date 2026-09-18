/**
 * ヒアリングの回答だけから単線結線図を自動生成する（検証用）。
 *
 * 実案件（カニエ竹原太陽光発電所）の回答を入れて、
 * 構成ルール → 自動レイアウト → SVG の流れが正しく動くかを確認する。
 *
 *   node --experimental-strip-types scripts/build-sample-drawing.ts
 *   → docs/sample-drawing.svg
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildComposition } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';
import { layout, renderSvg } from '../packages/layout/src/index.ts';

/** 実案件の回答（手書きメモから読み取った想定） */
export const SAMPLE_ANSWERS: Answers = {
  customerName: 'カニエ竹原太陽光発電所',
  siteName: 'カニエ竹原太陽光発電所',
  receivingType: 'high',
  receivingVoltage: 6600,

  sourceType: 'pole',
  polePrefix: '中電柱:',
  poleName: '大井(分)7T1H1',
  hasAs: 'no',

  boundaryPattern: 'coincident',

  hasPas: 'yes',
  pasControl: 'dgr',
  pasBuiltinVt: 'yes',
  pasBuiltinLa: 'yes',
  pasRatedVoltage: '7200',
  pasRatedCurrent: '200',

  vctLocation: 'indoor',
  vctCount: 2,

  cableInstallation: 'buried',
  cableStructure: 'CVT',
  cableVoltage: 6600,
  cableCrossSection: 38,
  cableLength: 14,

  areaCount: 1,
  areaForm: 'cubicle',
  areaPlacement: 'outdoor',

  mainBreakerForm: 'pfs',
  lbsRatedVoltage: '7200',
  lbsRatedCurrent: 200,
  lbsFuseCount: 3,
  lbsFuseSpec: '7200V 50A 40kA',
  hasSiteVt: 'yes',
  hasSiteCt: 'yes',
  ctRatio: '40A/5A',
  vtRatio: '6600/110V',
  hasZpd: 'yes',

  transformerCount: 1,
  trUsage: '動力',
  trConnection: 'tr-3p-dy',
  trCapacity: 300,
  trVoltage: '6600V/440-254V',

  feederCount: 2,
  feederName: 'PCSNo1〜No5',
  feederBreaker: 'MCCB225A',
  feederDevice: 'pcs',
  feederDeviceCapacity: '50kW×2',
  feederSource: 'pv',
};

const composition = buildComposition(SAMPLE_ANSWERS);
const drawing = layout(composition, SAMPLE_ANSWERS);
const svg = renderSvg(drawing, {
  title: 'カニエ竹原太陽光発電所　キュービクル式高圧受電設備単線結線図',
  footer: '株式会社フジエレックス',
  draftNotice: '※ ヒアリング回答から自動生成したたたき台です',
});

const out = resolve(import.meta.dirname, '../docs/sample-drawing.svg');
writeFileSync(out, svg, 'utf8');
console.log(
  `生成: ${out}（機器 ${composition.length}件 → 記号 ${drawing.symbols.length}個 / 線 ${drawing.wires.length}本）`,
);
