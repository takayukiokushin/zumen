import { dropHiddenChoices } from '../packages/knowledge/src/index.ts';
import type { Answers } from '../packages/knowledge/src/index.ts';

type Rnd = () => number;

export /** ケーブル・開閉器・PC・LBS などをたくさん付けた案件にする（ふつうの乱数では、ほとんど出ないため） */
function enrich(a: Answers, rnd: Rnd, area: number): Answers {
  const out: Record<string, unknown> = { ...a };
  const pick = <T,>(l: T[]): T => l[Math.floor(rnd() * l.length)]!;
  const SW = ['none', 'ds', 'vcb', 'lbs', 'vcs', 'as'];
  const slots = (p: string, side: 'Up' | 'Dn', k: string) => {
    const used: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const c = SW.filter((x) => x === 'none' || !used.includes(x));
      const v = i === 1 ? pick(SW.slice(1)) : pick(c);
      out[k + `${p}Cable${side}${i}`] = v;
      if (v === 'none') break;
      used.push(v);
    }
  };
  for (let ar = 0; ar < area; ar++) {
    const k = ar === 0 ? '' : `a${ar + 1}:`;
    const n = 1 + Math.floor(rnd() * 3);
    out[`${k}transformerCount`] = String(n);
    for (let u = 0; u < n; u++) {
      const uk = (id: string) => `${k}${id}${u === 0 ? '' : `__${u + 1}`}`;
      out[uk('trHasCable')] = rnd() < 0.7 ? 'yes' : 'no';
      out[uk('trHasPc')] = rnd() < 0.4 ? 'yes' : 'no';
      out[uk('trHasLbs')] = rnd() < 0.4 ? 'yes' : 'no';
      for (const side of ['Up', 'Dn'] as const) {
        const used: string[] = [];
        for (let i = 1; i <= 3; i++) {
          const c = SW.filter((x) => x === 'none' || !used.includes(x));
          const v = i === 1 ? pick(SW.slice(1)) : pick(c);
          out[uk(`trCable${side}${i}`)] = v;
          if (v === 'none') break;
          used.push(v);
        }
      }
      out[uk('trCableInstallation')] = 'buried';
      out[uk('trCableStructure')] = 'CVT';
    }
    if (rnd() < 0.7) {
      out[`${k}hasCapacitor`] = 'yes';
      out[`${k}capacitorCount`] = String(1 + Math.floor(rnd() * 2));
      for (let u = 0; u < Number(out[`${k}capacitorCount`]); u++) {
        const uk = (id: string) => `${k}${id}${u === 0 ? '' : `__${u + 1}`}`;
        out[uk('capHasCable')] = rnd() < 0.6 ? 'yes' : 'no';
        out[uk('capHasPc')] = rnd() < 0.5 ? 'yes' : 'no';
        out[uk('capHasLbs')] = rnd() < 0.5 ? 'yes' : 'no';
        out[uk('capHasVcs')] = rnd() < 0.4 ? 'yes' : 'no';
        out[uk('capCableUp1')] = pick(SW.slice(1));
        out[uk('capCableDn1')] = pick(SW);
        out[uk('capCableInstallation')] = 'buried';
        out[uk('capCableStructure')] = 'CVT';
      }
    }
  }
  // エリア間の接続（2か所目以降）：段・ケーブル・開閉器
  for (let ar = 1; ar < area; ar++) {
    const k = `a${ar + 1}:`;
    out[`${k}linkTap`] = pick(['ds-source', 'ds-vcb', 'vcb-load', 'bus']);
    const st = 1 + Math.floor(rnd() * 3);
    out[`${k}linkStageCount`] = String(st);
    for (let i = 1; i <= st; i++) {
      const pre = i === 1 ? 'link' : `link${i}`;
      out[`${k}${pre}Switch`] = pick(['none', 'ds', 'vcb', 'lbs', 'ds-vcb', 'vcb-vcs', 'as']);
      out[`${k}${pre}Cable`] = rnd() < 0.75 ? 'yes' : 'no';
    }
    out[`${k}linkCableInstallation`] = 'buried';
    out[`${k}linkCableStructure`] = 'CVT';
  }
  // 電動機（高圧母線から）
  out.hasMotor = 'yes';
  out.motorCount = String(1 + Math.floor(rnd() * 2));
  out.motorSource = 'bus';
  for (let u = 0; u < Number(out.motorCount); u++) {
    const uk = (id: string) => `${id}${u === 0 ? '' : `__${u + 1}`}`;
    out[uk('motorSource')] = 'bus';
    out[uk('motorSwitch')] = pick(['none', 'ds', 'vcb', 'ds-vcb', 'lbs', 'lbs-plain']);
    out[uk('motorSwitch2')] = pick(['none', 'vcs']);
    out[uk('motorCable')] = rnd() < 0.6 ? 'yes' : 'no';
    out[uk('motorCableDn1')] = pick(['none', 'lbs', 'vcb']);
    out[uk('motorCableInstallation')] = 'buried';
    out[uk('motorCableStructure')] = 'CVT';
  }
  void slots;
  return dropHiddenChoices(out as Answers);
}
