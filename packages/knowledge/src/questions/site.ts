import type { Question } from './types.ts';
import { PROPERTY_AT_DS } from './common.ts';

/** 質問の定義：お客様・現場、引込元、責任分界点 */
export const SITE_QUESTIONS: Question[] = [
  /* ---------------- お客様・現場 ---------------- */
  { id: 'siteName', group: 'customer', label: '事業場名称', type: 'text', ask: 'always', required: true, manualOnly: true, clearOnDuplicate: true },
  {
    // 図面一覧で探すための番号（任意）。図面には印刷しない。お客様ごとに違うので、複製したときは空にする
    id: 'customerNo',
    group: 'customer',
    label: 'お客様番号',
    type: 'text',
    size: 'm',
    ask: 'always',
    manualOnly: true,
    clearOnDuplicate: true,
    help: '任意。図面一覧で探せます。',
  },
  {
    id: 'customerNameForTitleBlock',
    group: 'customer',
    label: '表題欄への記載名',
    type: 'text',
    manualOnly: true,
    clearOnDuplicate: true,
    ask: 'always',
    help: '事業場名称と異なる書き方（略称など）をする場合に入力する',
  },

  /* ---------------- 引込元 ---------------- */
  {
    id: 'sourceType',
    group: 'source',
    label: '引込元は何ですか？',
    type: 'select',
    options: [
      { value: 'pole', label: '電柱' },
      { value: 'cabinet', label: '地上キャビネット' },
    ],
    defaultValue: 'pole',
    ask: 'ai-uncertain',
    required: true,
    help: '図面の一番上に描く、電力会社側の引込元。電柱か、地上の電力会社キャビネットのどちらか',
  },
  // ---- 電柱のとき ----
  {
    id: 'poleName',
    group: 'source',
    label: '引込元の名称',
    type: 'text',
    clearOnDuplicate: true,
    // 「中電柱：」を最初から入れておき、その後ろに電柱の名称を入力する
    defaultValue: '中電柱：',
    showIf: { key: 'sourceType', ne: 'cabinet' },
    ask: 'always',
    help: '電柱番号を入力する。（例：猪子山（分）81）。（分）（幹）（支）（連絡）などの区分は、電柱の記載をそのまま反映する。',
  },
  {
    id: 'hasAs',
    group: 'source',
    label: 'AS（気中開閉器）はありますか？',
    type: 'select',
    options: [
      { value: 'yes', label: 'あり', i18nContext: 'yesno' },
      { value: 'no', label: 'なし', i18nContext: 'yesno' },
    ],
    defaultValue: 'no',
    showIf: { key: 'sourceType', ne: 'cabinet' },
    ask: 'ai-uncertain',
    help: '電力会社側の開閉器。引込元〜責任分界点の間に入る場合がある',
  },
  // ---- 地上キャビネットのとき（電柱も AS も無い） ----
  {
    id: 'cabinetName',
    group: 'source',
    label: 'キャビネット名称',
    type: 'text',
    clearOnDuplicate: true,
    // 「キャビネット番号：」を最初から入れておき、その後ろにキャビネットの名称を入力する
    defaultValue: 'キャビネット番号：',
    showIf: { key: 'sourceType', eq: 'cabinet' },
    ask: 'always',
    help: '「キャビネット番号：」が最初から入っている。その後ろに、キャビネットの名称を入力する',
  },

  /* ---------------- 責任分界点 ---------------- */
  {
    id: 'boundaryPattern',
    group: 'boundary',
    label: '3点一致ですか？',
    type: 'select',
    options: [
      { value: 'coincident', label: 'はい（3点一致）' },
      { value: 'split', label: 'いいえ（3点不一致）' },
    ],
    defaultValue: 'coincident',
    // 区分開閉器が「なし」で、引込ケーブルが電力会社のものなら、財産分界点がDSの一次側に移る（3点一致ではない）ので、聞かない
    showIf: { not: PROPERTY_AT_DS },
    ask: 'ai-uncertain',
    required: true,
    help: '引込点・財産分界点・責任分界点が同じ地点なら「3点一致」',
  },
  {
    id: 'boundarySafetyDevice',
    group: 'boundary',
    label: '責任分界点は、LBSですか、VCBですか？',
    type: 'select',
    options: [
      { value: 'lbs', label: 'LBS' },
      { value: 'vcb', label: 'VCB' },
    ],
    // 主遮断装置の形式が決まっていれば聞かない（CB形ならVCB、PFS形ならLBSに決まる）。
    // 未入力のときだけ聞く
    showIf: {
      all: [{ key: 'boundaryPattern', eq: 'split' }, { not: PROPERTY_AT_DS }, { not: { key: 'mainBreakerForm', in: ['cb', 'pfs'] } }],
    },
    ask: 'always',
    help: '3点不一致のときは、主遮断装置の図記号の中央に横線を引いて記載する。主遮断装置の形式を入力すれば、この質問は不要（CB形はVCB、PFS形はLBSに自動で決まる）',
  },
];
