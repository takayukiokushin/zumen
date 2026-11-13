import type { QuestionGroup } from './types.ts';
import { CT_SHOWN, VT_SHOWN } from '../composition.ts';

export const QUESTION_GROUPS: QuestionGroup[] = [
  { id: 'customer', label: 'お客様・現場', description: '表題欄と図面の基本情報' },
  { id: 'source', label: '引込元', description: '電力会社所有の電柱' },
  { id: 'boundary', label: '責任分界点' },
  { id: 'pas', label: '区分開閉器' },
  {
    // 区分開閉器も地上キャビネットも無いときだけ出す
    id: 'precable',
    label: '引込点〜責任分界点のケーブル',
    description: '区分開閉器・地上キャビネットが、どちらも無いとき',
    showIf: { all: [{ key: 'sectionalizer', eq: 'none' }, { key: 'groundCabinet', eq: 'no' }] },
  },
  { id: 'vct', label: 'VCT（計器用変成器）' },
  { id: 'cable', label: '引込ケーブル' },
  { id: 'area', label: '受電設備エリア', repeatCountKey: 'areaCount', repeatUnit: 'か所' },
  // ここから下の perArea のグループは、エリアが2か所以上のとき、エリアごとに入力する
  { id: 'link', label: 'エリア間の接続（送り出し）', description: 'このエリアから、後ろのエリアへ送り出す線ごとに、分岐する位置・ケーブル・開閉器を入力する', perArea: true },
  { id: 'receiving', label: '受電設備の構成', perArea: true },
  {
    id: 'vtset',
    label: 'VT（計器用変圧器）',
    description: 'VTは「組」で数える。位置が違うVTがあるときは、組を増やす',
    repeatCountKey: 'vtSetCount',
    repeatUnit: '組',
    perArea: true,
    showIf: VT_SHOWN,
  },
  {
    id: 'ctset',
    label: 'CT（変流器）',
    description: 'CTも「組」で数える。位置が違うCTがあるときは、組を増やす',
    repeatCountKey: 'ctSetCount',
    repeatUnit: '組',
    perArea: true,
    showIf: CT_SHOWN,
  },
  {
    id: 'relay',
    label: '保護継電器（OCR・UVR・OVRなど）',
    description: '設置されている継電器を、1個ずつ答える。どこについているか・試験端子の有無も、ここで決める',
    repeatCountKey: 'relayCount',
    repeatUnit: '個',
    perArea: true,
    // PFS形（LBS）は、CT・VTが無くても、保護継電器があるかどうかを聞く（CT・VTの有無が決まっていないときは、置き場所を聞き返す）
    showIf: { any: [VT_SHOWN, CT_SHOWN, { key: 'intakeLbs', eq: 'yes' }] },
  },
  { id: 'transformer', label: '変圧器', repeatCountKey: 'transformerCount', repeatUnit: '台', perArea: true },
  {
    id: 'compensation',
    label: '高圧進相設備',
    description: '高圧側に入るコンデンサとリアクトルだけを入力する。低圧側だけにある場合は入力しない',
    repeatCountKey: 'capacitorCount',
    repeatUnit: '台',
    perArea: true,
  },
  { id: 'special', label: '特殊設備', perArea: true },
  {
    id: 'auxtr',
    label: '補助変圧器',
    description: '系統用蓄電所のとき、補助変圧器盤（MCCB→補助変圧器）を、低圧側に描く',
    repeatCountKey: 'auxTrCount',
    repeatUnit: '台',
    showIf: { key: 'hasBattery', eq: 'yes' },
    perArea: true,
  },
  { id: 'generator', label: '発電機', repeatCountKey: 'generatorCount', repeatUnit: '台', showIf: { key: 'hasGenerator', eq: 'yes' }, perArea: true },
  { id: 'motor', label: '電動機', repeatCountKey: 'motorCount', repeatUnit: '台', showIf: { key: 'hasMotor', eq: 'yes' }, perArea: true },
  { id: 'pv', label: '太陽光発電設備（PCS）', repeatCountKey: 'pvGroupCount', repeatUnit: '種類', showIf: { key: 'hasPv', eq: 'yes' }, perArea: true },
  { id: 'title', label: '表題欄' },
];
