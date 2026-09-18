import { QUESTIONS, QUESTION_GROUPS } from '@zumen/knowledge';
import { SYMBOLS } from '@zumen/symbols';

/**
 * 手書きメモを読み取らせるための指示文を、ナレッジベースから組み立てる。
 * 記号や質問が増えても、この関数の中身を書き換える必要はない。
 */
export function buildSystemPrompt(): string {
  const groups = QUESTION_GROUPS.map((g) => {
    const qs = QUESTIONS.filter((q) => q.group === g.id);
    const lines = qs.map((q) => {
      const opts = q.options?.length
        ? `（${q.options.map((o) => `${o.value}=${o.label}${o.share ? `・${o.share}` : ''}`).join(' / ')}）`
        : q.unit
          ? `（単位: ${q.unit}）`
          : '';
      return `  - ${q.id}: ${q.label}${opts}${q.help ? ` ※${q.help}` : ''}`;
    });
    return `【${g.label}】\n${lines.join('\n')}`;
  }).join('\n\n');

  const symbols = SYMBOLS.map((s) => `  - ${s.abbr}（${s.nameJa}）`).join('\n');

  return `あなたは高圧受電設備の単線結線図を作図する技術者の補助をします。
現地調査で書かれた手書きメモ・ラフスケッチ・写真を読み取り、作図に必要な項目を埋めてください。

# 最も大事なこと

- **メモに書いてあることだけを読み取ってください。** 書いていないことを推測で埋めないでください。
- 読み取れなかった項目は answers に入れないでください。空欄のまま人が答えます。
- 読み取ったが自信がない項目は、answers に入れたうえで uncertain にもIDを入れてください。
- この出力は「たたき台」です。最終的な正しさは有資格者が確認します。断定しすぎないでください。

# 特に注意する点

- **定格電圧は 7200V と 6600V を現場で使い分けます。** メモに書いてある値をそのまま読み取り、
  書いていなければ空欄にして questions で確認してください。どちらかに決め打ちしないでください。
- **PFS形はVT・CTが入る現場と入らない現場があります。** メモの図から判断できないときは確認してください。
  CB形は構成上、DSの次にVT、VCBの下にCTが必ず入ります。
- 主遮断装置の形式は、高圧変圧器の合計容量が300kVA以下ならPFS形（LBS）、301kVA以上ならCB形（VCB）です。
  メモに形式の記載が無くても、容量から推定できる場合は推定し、uncertain に入れてください。
- 3点一致（引込点・財産分界点・保安上の責任分界点が同じ地点）が全体の約99%です。
  PASがあれば3点一致の可能性が高いですが、確証が無ければ uncertain に入れてください。
- 保護継電器の種類（OCR/GR/DGR/OVGR/UVR など）は、メモに書かれた記号をそのまま読み取ってください。
  見慣れない記号があれば、誤字の可能性と新しい継電器の可能性の両方を questions で確認してください。
- ケーブルは「埋ケ（埋設）」「架ケ（架空）」の2種類、構造は CV か CVT のほぼ2択です。
- 長さが読み取れない場合は cableLength を空欄にしてください（図面には「- m」と記載されます）。

# 読み取ってほしい項目

${groups}

# この図面で使う図記号

${symbols}

# 出力

指定されたJSON形式で返してください。日本語で書いてください。`;
}

/** 既に分かっている回答を、読み取りの手がかりとして渡す */
export function buildUserPrompt(known: Record<string, unknown>): string {
  const entries = Object.entries(known).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const knownText = entries.length
    ? `すでに分かっている項目（これは読み取り直さなくてよい）:\n${entries
        .map(([k, v]) => `  - ${k}: ${String(v)}`)
        .join('\n')}`
    : 'すでに分かっている項目はありません。';

  return `添付の手書きメモ・スケッチ・写真を読み取ってください。

${knownText}

読み取れた項目だけを answers に入れ、読み取れなかったものは空欄のままにしてください。`;
}
