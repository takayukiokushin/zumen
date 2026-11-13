import type { Condition, Value } from '../condition.ts';

export type QuestionType = 'text' | 'number' | 'select' | 'boolean' | 'date';

export interface Choice {
  value: string;
  label: string;
  /** 現場での出現割合（ユーザーに目安として見せる） */
  share?: string;
  /**
   * 訳すときの、使い分けの印（同じ日本語でも、場面で訳が変わるとき）。
   * 例：「あり／なし」の2択（「〜はありますか？」への答え）の「なし」は、英語では「No」。
   * 複数の選択肢の中の1つとしての「なし」は、「None」。2択のほうに、`yesno` を付ける。
   * 訳の表（data-xx.ts）に「なし@yesno」の訳があれば、それを使い、無ければ「なし」の訳を使う
   */
  i18nContext?: string;
  /**
   * この選択肢を出す条件。満たさないときは、一覧に出さない。
   * 例：用途が「電灯」のときは、三相の結線方式を出さない。
   * 条件の見方は、質問の showIf と同じ（繰り返しの2件目以降は、その件の答えで見る）
   */
  showIf?: Condition;
}

/** いつ聞くか */
export type AskWhen =
  /** 必ず聞く */
  | 'always'
  /** スケッチ画像から判別できる場合はAIに任せ、判別できないときだけ聞く */
  | 'ai-uncertain';

export interface Question {
  id: string;
  group: string;
  label: string;
  type: QuestionType;
  options?: Choice[];
  /** selectのとき、一覧にない値の手入力を許すか */
  allowFreeInput?: boolean;
  /**
   * selectのとき、選択肢が少なくても、ボタンではなくドロップダウン（一覧から選ぶ形）で出す。
   * 指定が無ければ、選択肢が3つ以下で短いものはボタン、それ以外はドロップダウン。
   */
  dropdown?: boolean;
  /**
   * 入力画面での欄の幅の目安（xs＝電圧・電流のような短い値／s＝短い／m＝ふつう／l＝長い）。
   * 指定が無ければ、種類・選択肢の長さ・名前の長さから、画面側で決める（Field.tsx）。
   * 1行にたくさん並べて、縦に伸びすぎないようにするための指定
   */
  size?: 'xs' | 's' | 'm' | 'l';
  unit?: string;
  defaultValue?: Value;
  /** 画面に出す説明文 */
  help?: string;
  /**
   * 読み取り・音声入力のAIに渡す補足。画面には出さない。
   * 画面の説明文（help）を消したり変えたりしても、AIへの手がかりは変えたくないときに使う。
   * 無いときは、help をそのまま渡す
   */
  aiHint?: string;
  placeholder?: string;
  /**
   * 文字を入れる欄のとき、数字だけが入力されたら、欄を離れたときに、この文字を後ろに足す。
   * 例：CTの変流比で「100」と入れると「100/5A」になる（2次側は必ず5A）
   */
  appendOnBlur?: string;
  /**
   * 同じまとまりの中を、見出しつきの小さな区切り（行）に分けるための名前。
   * 同じ名前の質問が続くと、1つの区切りにまとまる（画面では、区切りごとに行を分けて見出しを付ける）。
   */
  section?: string;
  /**
   * まだ答えていないときの、状況に応じた初期値（上から見て、最初に条件を満たしたものを使う）。
   * 例：用途を選ぶと結線方式が決まる。利用者が自分で入れた（選んだ）値は、いつもそちらが優先される。
   * 繰り返しグループでは、その件の答えで見る。
   */
  autoValue?: { when?: Condition; value: string }[];
  /**
   * 文字を入れる欄を空にしたとき、「答えていない」ではなく「空にした」と覚える。
   * autoValue のある欄で、自動で入った文字を消せるようにするため
   */
  keepEmpty?: boolean;
  /** この条件を満たすときだけ表示する */
  showIf?: Condition;
  /**
   * アプリの中で、人が手で入力する項目（お客様名称・事業場名称など）。
   * 情報漏えいを避けるため、音声やAIには渡さない。AIの指示文には載せず、
   * AIが作った文章に入っていても、取り込まない。
   */
  manualOnly?: boolean;
  /**
   * AI（スケッチの読み取り・音声入力）には、項目として渡さない。
   * 「1台目」「2台目」…のように、番号ぶんだけ並べる項目の、後ろのほうなど、数が多くて、指示文が長くなりすぎるもの。
   * 画面では、ふつうの項目と同じように出る（人が入力する）
   */
  noAi?: boolean;
  /**
   * 「過去の案件の傾向」の対象にしない（第13弾 項目51）。
   * ふつう、選択肢から選ぶ質問（お客様の名前などの手入力・AIに渡さない項目を除く）は、傾向の対象になる。
   * 「何台目の変圧器か」のように、案件ごとに意味が変わる番号を答えるものなど、集計しても意味が無いものに付ける
   */
  noTrend?: boolean;
  /**
   * 図面を複製して新しい案件を作るとき、空にする（その現場だけの名前・番号・注記）。
   * 設備の内容は、そのまま残す
   */
  clearOnDuplicate?: boolean;
  ask: AskWhen;
  required?: boolean;
  /**
   * 繰り返しグループの中でも、1回だけ聞く質問。
   * 例：「高圧コンデンサ設備はありますか？」は台数ぶん聞く必要がない。
   */
  shared?: boolean;
}

export interface QuestionGroup {
  id: string;
  label: string;
  description?: string;
  /** 繰り返し入力するグループのとき、件数を持つ質問のID（例: 受電設備エリア） */
  repeatCountKey?: string;
  /** 繰り返しの数え方（「1台目」「1回線目」のように見出しに使う） */
  repeatUnit?: string;
  /**
   * 受電設備エリアごとに入力するグループ（受電設備の構成・変圧器など）。
   * エリアが2か所以上のとき、1か所目は今までのキー、2か所目以降は「a2:」「a3:」を前に付けたキーで答えを持つ。
   */
  perArea?: boolean;
  showIf?: Condition;
}
