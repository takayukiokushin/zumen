import type { Question } from './types.ts';
import { breakerRatings } from './common.ts';

/** 質問の定義：PC・LBS の定格電流とヒューズ（変圧器の手前／コンデンサの手前） */
export const BREAKER_QUESTIONS: Question[] = [
  // PC・LBSの定格電流とヒューズ（変圧器の手前／コンデンサの手前）
  ...breakerRatings('tr', 'transformer', { key: 'transformerCount', gt: 0 }, 'T'),
  ...breakerRatings('cap', 'compensation', { key: 'hasCapacitor', eq: 'yes' }, 'C'),
];
