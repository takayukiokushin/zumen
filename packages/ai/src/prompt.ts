import { QUESTIONS, QUESTION_GROUPS } from '@zumen/knowledge';
import { SYMBOLS } from '@zumen/symbols';

/**
 * 設備の読み取りで、気をつけること（手書きメモの読み取りと、音声入力の指示文で共通）。
 * 「メモ」「図」は、読み取り元（手書きメモ・スケッチ・話された内容）のことを指す。
 */
export const DOMAIN_RULES = `- **定格電圧は 7200V と 6600V を現場で使い分けます。** メモに書いてある値をそのまま読み取り、
  書いていなければ空欄にして questions で確認してください。どちらかに決め打ちしないでください。
- **PFS形はVT・CTが入る現場と入らない現場があります。** メモの図から判断できないときは確認してください。
  CB形は構成上、DSの次にVT、VCBの下にCTが必ず入ります。
- **受電設備エリアが2か所以上（areaCount が2以上）のときは、「受電設備の構成」以降の答え（主遮断装置の形式・変圧器・コンデンサなど）は、1か所目のぶんだけ読み取ってください。**
  2か所目以降は、読み取らず、questions に「2か所目の受電設備は…ですか」のように入れて確認してください（エリアごとの入力は、人が画面で行います）。
- 主遮断装置の形式は、高圧変圧器の合計容量（エリアが複数あるときは、すべてのエリアの合計）が300kVA以下ならPFS形（LBS）、301kVA以上ならCB形（VCB）です。
  メモに形式の記載が無くても、容量から推定できる場合は推定し、uncertain に入れてください。
- 図に「励突抑制開閉器」（VCBと並列に入る、ヒューズ付のLBS）があれば、hasInrush を yes にし、その定格（inrushRatedVoltage・inrushRatedCurrent・
  inrushFuseCount・inrushFuseSpec）も読み取ってください。系統用蓄電所の図面でよく見られます。
- **VT・CT・保護継電器は、「組」「個」で数えます。** VTは位置（主遮断装置の一次側＝DSの次／二次側）ごと、CTは位置（主遮断装置の一次側／二次側／VTのあと）ごとに「1組」とし、
  組数は vtSetCount・ctSetCount、2組目以降は vtCount__2 のように「__2」を付けて答えます。V結線のVTは、vtConnection を v にします。
  OCR・UVR・OVRなどの継電器は、relayCount（個数）と、1個ずつ relayType（種類）・relayAt（どこについているか：ct-1＝CT1組目、vt-1＝VT1組目、none＝置き場所が決まっていない）・
  relayTest（手前の試験端子：yes／no）で答えます。**試験端子は、最初は「あり」です。** 図に無いと分かるときだけ no にしてください。
  OCRがあるVCBには、トリップコイル（OCRの出力で動く）が付きます。これは答えなくても自動で描かれます。
- **補助変圧器（MCCB→補助変圧器）は系統用蓄電所（hasBattery が yes）だけ**です。auxTrCount（台数）・auxTrUsage（用途）・auxTrConnection・auxTrCapacity・
  auxTrVoltage（例：550V/220V）・auxTrMccb（MCCBの定格。数字だけ）・auxTrFrom（どの変圧器の低圧側か）を読み取ってください。
- **分界点の文言は「財産・責任分界点」に統一します。** 手書きの図に「財産保安責任分界点」「責任分界点」「財産分界点」などの書き方があっても、
  3点一致のときの横線の文言は「財産・責任分界点」です（3点不一致のときだけ、「財産分界点」と「責任分界点」を別々の線で書きます）。
- 3点一致（引込点・財産分界点・保安上の責任分界点が同じ地点）が全体の約99%です。
  区分開閉器（PAS・PGS）があれば3点一致の可能性が高いですが、確証が無ければ uncertain に入れてください。
- **区分開閉器は sectionalizer で答えます。** PAS（電柱上に設置）／PGS（電柱上に設置）／UGS（キャビネット内に設置）／none（設置なし）のどれかです。
  図に「PGS」とあればPGS、「UGS」とあればUGS、「PAS」とあればPAS、どれも無ければnoneです。
  引込元（sourceType）が cabinet のときは、PAS・PGS は無く、UGS（またはnone）です。
  UGS のときは、UGS が入っているキャビネットの名称（ugsCabinetName）も、先頭の「キャビネット番号：」を含めた文字そのままで読み取ります。
  - noneのときは、電力会社の地上キャビネットで受電する場合がほとんどです。groundCabinet（yes／no）と、
    あるときの種類 groundCabinetType（mold-discon＝モールドディスコン／t-shelter＝T型シェルター／three-pole＝三極連動）を、
    メモの記載から読み取ってください。読み取れないときは、questions で確認してください。
  - 引込元（sourceType）は、pole（電力会社の電柱）か cabinet（地上の電力会社キャビネット）のどちらかです。
    図の一番上が円の左半分を塗った記号なら pole、枠付きの断路器の記号なら cabinet です。
    pole のときは電柱名称（poleName）とASの有無（hasAs）、cabinet のときはキャビネット名称（cabinetName）を読み取ります（cabinet に AS はありません）。
    poleName・cabinetName は、先頭の「中電柱：」「キャビネット番号：」も含めた文字そのままで答えます（例：「中電柱：猪子山（分）81」）。
  - PASとPGSは、SOG・内蔵機器などの質問がまったく同じです。
- **PASの内蔵機器はSOGの有無で決まります。**
  - SOG（GRまたはDGR）がある → ZCTが必ず内蔵されます。VTは入る場合と入らない場合があります。
  - SOGが無い → **VTとZCTは入りません。** ただしLAは入ることがあります。
  - つまりPASは「VTもLAもなし」「VTのみ」「LAのみ」「VTとLAの両方」の4通りで、
    このうちVTを含む2通りはSOGがある場合にかぎられます。
  - メモにSOG・GR・DGRの記載があるか、ZCTやVTが描かれているかを手がかりにしてください。
- 保護継電器の種類（OCR/GR/DGR/OVGR/UVR など）は、メモに書かれた記号をそのまま読み取ってください。
  見慣れない記号があれば、誤字の可能性と新しい継電器の可能性の両方を questions で確認してください。
- **CT・VTの台数**（ctCount・vtCount）は、図に「CT×2」「VT×2」のようにあれば、その数を答えてください。
  書いていなければ、1台（空欄）で構いません。
- **CTの変流比（ctRatio）は、1次側の電流の数字だけ**を答えてください（例：100:5 なら 100）。2次側は必ず5Aで、
  図面には自動で「100/5A」と書かれます。VTの変圧比（vtRatio）は 6600/110V に決まっています（ほかの値は無い）。
- ケーブルは「埋ケ（埋設）」「架ケ（架空）」の2種類、構造は CV か CVT のほぼ2択です。
  ただし、**引込ケーブルが無い現場**があります（電柱の上に受電設備を構成する場合など。区分開閉器の後が、
  ケーブルを介さずふつうの電線でつながる）。図にケーブルの記載が無く、電線でつながっているときは、
  cableInstallation を none にしてください。定格電圧は 3300・6600 のどちらかです。
- 長さが読み取れない場合は cableLength を空欄にしてください（図面には「- m」と記載されます）。`;

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

- 添付されるものは、手書きメモ（写真・スキャン）、過去に使っていた既存の図面（PDF）、メーカーの設備の仕様書（PDF）のどれかです。
  - 手書きメモ・既存の図面は、書いてある内容（機器の構成・定格・名称）を読み取ってください。
  - メーカーの仕様書は、そこに書いてある機器の定格・形式・型番に関する項目だけを答えてください。構成の全体（どの機器がどこに付くか）は、
    仕様書だけでは決まらないので、書いていない項目は、空欄のままにしてください。
- **メモに書いてあることだけを読み取ってください。** 書いていないことを推測で埋めないでください。
- 読み取れなかった項目は answers に入れないでください。空欄のまま人が答えます。
- 読み取ったが自信がない項目は、answers に入れたうえで uncertain にもIDを入れてください。
- この出力は「たたき台」です。最終的な正しさは有資格者が確認します。断定しすぎないでください。

# 特に注意する点

${DOMAIN_RULES}

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

  return `添付の手書きメモ・スケッチ・写真・既存の図面（PDF）・メーカーの仕様書（PDF）を読み取ってください。

${knownText}

読み取れた項目だけを answers に入れ、読み取れなかったものは空欄のままにしてください。`;
}
