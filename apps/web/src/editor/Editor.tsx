import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_LABEL, SYMBOLS, getSymbol, labelFields, symbolToSvg } from '@zumen/symbols';
import type { SymbolCategory } from '@zumen/symbols';
import { COMPANY_NAME, SHEET_MARGIN, layout, layoutTitle, sheetSize } from '@zumen/layout';
import type { Orientation, PaperSize } from '@zumen/layout';
import { buildComposition, MAX_CUSTOM_LAYERS, MAX_LAYER_ITEMS_PER_KIND, MAX_TEXT_LENGTH, resolveDrawingName } from '@zumen/knowledge';
import type { Answers } from '@zumen/knowledge';
import { DrawingCanvas } from './DrawingCanvas.tsx';
import { useT, useTx } from '../i18n/useT.ts';
import { buildSheetSvg } from './exportSheet.ts';
import { UndoIcon, ZoomIcon } from '../icons.tsx';
import { chooseSheet, issueLabel } from './inspect.ts';
import type { HeavyApi } from './useHeavyJob.tsx';
import type { HeavyKind, HeavyRequest, HeavyResult } from './heavy.ts';
import type { Issue, IssueKind } from './inspect.ts';
import { Rich } from '../i18n/Rich.tsx';
import { WireKindWindow } from './WireKindWindow.tsx';
import type { Pos } from './WireKindWindow.tsx';
import type { Doc, DocSymbol } from './doc.ts';
import { rebuildWithOverrides } from './overrides.ts';
import { LayerMenu } from './LayerMenu.tsx';
import { addLayer, addLayerCross, addLayerText, canAddLayerCross, canAddLayerText, canMark, crossOn, resolveCrosses, setCrossSize, carryLayers, customCount, layerInfos, layerItemsAsDocItems, layerNameProblem, layerOf, layerTitle, moveLayerItems, removeLayer, removeLayerItems, renameLayer, setLayerItems, setLayerOrientation, updateLayerText } from './layers.ts';
import type { LayerItem } from './layers.ts';
import { CROSS_SIZE_IDS } from '@zumen/layout';
import type { CrossSize } from '@zumen/layout';
import { TextStyleControls } from './TextStyleControls.tsx';
import { useDialogs } from '../Dialogs.tsx';
import { addSymbol, addText, addWire, digest, docBounds, fromLayout, moveItem, moveItems, moveWireEnd, removeItem, removeItems, replaceSymbol, resetLabelFromFields, setLabel, resizeInfoOf, setItemRect, setLabelValue, setTextStyle, setWireKind, tidyDoc } from './doc.ts';

/** ×印の大きさの、画面の言葉 */
const CROSS_LABEL = { S: 'cross.small', M: 'cross.mid', L: 'cross.large' } as const;

/** 操作を戻す／進めるための履歴 */
interface History {
  past: Doc[];
  present: Doc;
  future: Doc[];
}

const commit = (h: History, next: Doc): History => ({ past: [...h.past, h.present], present: next, future: [] });
/** 矢印キーで1回に動かす距離（図面の座標。格子の間隔 2 の倍数） */
const ARROW_STEP = 4;
/** Shift キーを押しながら矢印キーを押したときは、この倍数だけ大きく動かす */
const ARROW_SHIFT_TIMES = 5;
/** 矢印キーを、この時間（ミリ秒）以内に続けて押したら、1回の操作にまとめる */
const ARROW_MERGE_MS = 800;
const ARROW_MOVE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
const undo = (h: History): History =>
  h.past.length === 0 ? h : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
const redo = (h: History): History =>
  h.future.length === 0 ? h : { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };

interface EditorProps {
  answers: Answers;
  /** 保存してあった図面（無ければ回答から自動生成する） */
  initialDoc?: Doc | null;
  /** 図面が変わったときに知らせる（保存のため） */
  onDocChange?: (doc: Doc) => void;
  /** 時間のかかる処理（結線を整える・縮小・拡大）を、別の流れで動かす窓口（App が持つ。ほかの画面に移っても、続く） */
  heavy: HeavyApi;
}

export function Editor({ answers, initialDoc, onDocChange, heavy }: EditorProps) {
  const t = useT();
  const tx = useTx();
  const composition = useMemo(() => buildComposition(answers), [answers]);
  /** いまのヒアリング回答の印。これが変わったら、図面の中身も変わるはず */
  const basis = useMemo(
    () => digest(JSON.stringify(composition.map((i) => [i.role, i.symbolId, i.label, i.unit ?? 0]))),
    [composition],
  );
  const generated = useMemo(() => {
    return fromLayout(layout(composition, answers), basis);
  }, [composition, answers, basis]);

  const [history, setHistory] = useState<History>(() => {
    // 手で直していない図面は、いつでも回答から作り直してよい。
    // 手で直したものは、手で直した内容を残したまま、回答が変わっていれば、作り直す（下の useEffect）
    if (!initialDoc || initialDoc.edited !== true) {
      // レイヤー（停電範囲図など）は、元の図面を作り直しても、引き継ぐ
      return { past: [], present: initialDoc ? carryLayers(generated, initialDoc) : generated, future: [] };
    }
    // 保存してあった図面も一度「整える」を通して、結線を接続点に結び直しておく。
    // 自動で作った図面の控えが無い古い図面は、いまの回答から作った図面を控えにする（回答が同じなら、ほぼ同じ図面）
    const tidy = tidyDoc(initialDoc);
    return { past: [], present: tidy.base ? tidy : { ...tidy, base: generated.base }, future: [] };
  });
  /** 選んでいる要素（複数のこともある） */
  const [selection, setSelection] = useState<string[]>([]);
  /** 1つだけ選んでいるときの、その要素のid（右の「選んだもの」の欄などは、1つのときだけ出す） */
  const selectedId = selection.length === 1 ? selection[0]! : null;
  const setSelectedId = useCallback((id: string | null) => setSelection(id ? [id] : []), []);
  const [zoom, setZoom] = useState(1);
  const [paletteCategory, setPaletteCategory] = useState<SymbolCategory>('switchgear');
  const [mode, setMode] = useState<'select' | 'wire' | 'cross'>('select');
  /** 開放の×印を付けるときの大きさ（小・中・大） */
  const [crossSize, setCrossSize_] = useState<CrossSize>('M');
  /** 線を引くときの種類（false＝実線、true＝点線）。埋設ケーブル・TCなどは点線 */
  const [wireDashed, setWireDashed] = useState(false);
  /** 「線を引く」の、実線・点線の窓の位置。動かした位置を覚えておく（次に開くときも、同じ位置） */
  const [wireWinPos, setWireWinPos] = useState<Pos | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  /** 用紙のまま（図枠つき）で見るか。印刷の見た目をそのまま確かめられる */
  const [sheetView, setSheetView] = useState(false);
  /**
   * いま見ている・編集しているレイヤー。null は単線結線図。
   * 図面を開くたびに、必ず単線結線図から始まる（誤って、別のレイヤーを編集しないように）。保存はしない
   */
  const [activeLayer, setActiveLayer] = useState<string | null>(null);
  /**
   * レイヤーごとの、「操作を戻す」の履歴（元の図面の履歴とは別。切り替えても残る。画面を閉じる・開き直すと消える）。
   * 各レイヤーに置いたものの、昔の状態を覚えておく
   */
  const [layerHist, setLayerHist] = useState<Record<string, { past: LayerItem[][]; future: LayerItem[][] }>>({});
  const { ask, input } = useDialogs();
  /** スマホ（幅の狭い画面）で、ほかの操作のボタン列・記号パレットを開いているか */
  const [moreOpen, setMoreOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  /** 「結線を整える」で直しきれなかったところ */
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [tidyNote, setTidyNote] = useState<string | null>(null);
  /** 「レイアウトを縮小」で、これ以上縮められないときの知らせ */
  const [layoutNote, setLayoutNote] = useState<string | null>(null);
  /** 入力内容が変わって、手で直した図面を作り直したときの知らせ（「操作を戻す」で元に戻せる） */
  const [rebuiltNote, setRebuiltNote] = useState<{ kept: boolean; dormant: number; overlaps: number; lost: boolean } | null>(null);
  /** 直前に矢印キーで動かした要素と時刻（続けて押したときに、操作を1つにまとめる） */
  const lastArrow = useRef<{ id: string; at: number } | null>(null);
  /** 直前の、まとめられる操作（文字の大きさのつまみを動かし続けるなど）の種類と時刻 */
  const lastEdit = useRef<{ key: string; at: number } | null>(null);

  const doc = history.present;
  const docRef = useRef(doc);
  docRef.current = doc;
  /** 選んでいるレイヤー（消されて無いときは、単線結線図） */
  const activeId = activeLayer !== null && layerTitle(doc, activeLayer) !== null ? activeLayer : null;
  /** レイヤーを選んでいるあいだは、元の図面を動かせない（そのレイヤーに置いたものだけを、変えられる） */
  const locked = activeId !== null;
  /** 元の図面を編集できない状態（印刷プレビュー中、または、レイヤーを選んでいるとき） */
  const frozen = sheetView || locked;
  /**
   * 画面と印刷に出す図面。レイヤーを選んでいるときは、元の図面に、そのレイヤーに置いた文字を重ねる
   * （元の図面と同じ描き方・同じ大きさの計算で扱うため、図面の文字の形にして渡す）。
   */
  const layerDocItems = useMemo(() => (activeId !== null ? layerItemsAsDocItems(doc, activeId) : []), [doc, activeId]);
  const viewDoc = useMemo<Doc>(() => (layerDocItems.length > 0 ? { ...doc, items: [...doc.items, ...layerDocItems] } : doc), [doc, layerDocItems]);
  /** レイヤーに付けた赤い×印（付けた開閉器が図面にあるもの） */
  const layerCrosses = useMemo(() => (activeId !== null ? resolveCrosses(doc, activeId) : []), [doc, activeId]);
  const sheetCrosses = useMemo(() => layerCrosses.map((c) => ({ x: c.x, y: c.y, size: c.size, thickness: c.thickness })), [layerCrosses]);
  /** レイヤーを選んでいるときに、触れるもの（そのレイヤーに置いたもの）の id */
  const activeIds = useMemo(() => new Set([...layerDocItems.map((i) => i.id), ...layerCrosses.map((c) => c.id)]), [layerDocItems, layerCrosses]);
  const selectedCross = locked ? (layerCrosses.find((c) => c.id === selectedId) ?? null) : null;
  const sheetTitle = {
    site: String(answers.customerNameForTitleBlock ?? answers.siteName ?? ''),
    // レイヤーを選んでいるときは、タイトルの「図面名称」の部分だけが、そのレイヤーの名前になる（事業場名などは、そのまま）
    name: activeId !== null ? (layerTitle(doc, activeId) ?? '') : resolveDrawingName(answers),
    // 右下は常に社名（作成者や図面番号は図面に入れない方針）
    footer: COMPANY_NAME,
  };
  const selected = viewDoc.items.find((i) => i.id === selectedId && (!locked || activeIds.has(i.id))) ?? null;
  /** 印刷・保存用の1枚のSVG（図枠と表題欄つき） */
  // 向きは、利用者が選んだもの（なければ、図面の形に合わせた自動の判定）。
  // 図面を描く台紙の大きさ（A4・A3）は、図面の大きさで内部的に決まる（画面には出さない。実際の用紙は、印刷の設定画面で選ぶ）
  const auto = useMemo(() => chooseSheet(viewDoc, sheetTitle), [viewDoc, sheetTitle.site, sheetTitle.name, sheetTitle.footer]);
  // 向きは、元の図面と、レイヤーごとに別々に決める
  const wantOrientation = activeId !== null ? layerOf(doc, activeId)?.orientation : doc.orientation;
  const chosen = useMemo(
    () => (wantOrientation ? chooseSheet(viewDoc, sheetTitle, wantOrientation) : auto),
    [viewDoc, auto, wantOrientation, sheetTitle.site, sheetTitle.name, sheetTitle.footer],
  );
  const paper: PaperSize = chosen.paper;
  const orientation: Orientation = chosen.orientation;
  const sheetSvg = useMemo(
    () => buildSheetSvg(viewDoc, sheetTitle, paper, orientation, sheetCrosses),
    [viewDoc, sheetCrosses, sheetTitle.site, sheetTitle.name, sheetTitle.footer, paper, orientation],
  );
  /** 図面を描く台紙の縦横の比（印刷プレビューの形）。実際の用紙の大きさは、印刷の設定画面で決まる */
  const sheetMm = sheetSize(paper, orientation);
  /** 表題まわりの高さ。事業場名称が長くて2行になると高くなり、そのぶん図面を少し縮めて収める */
  const titleH = layoutTitle(sheetTitle, sheetMm.w, SHEET_MARGIN).titleH;

  const selectedSymbol = selected?.kind === 'symbol' ? (selected as DocSymbol) : null;

  const apply = useCallback(
    (next: Doc) => {
      // 手で直した印を付ける。どの回答から作った図面かは、そのまま持ち越す
      const stamped: Doc = { ...next, edited: true, basis: doc.basis };
      setHistory((h) => commit(h, stamped));
      onDocChange?.(stamped);
    },
    [onDocChange, doc.basis],
  );

  /**
   * アプリが自分で整えた結果を入れる（「結線を整える」・用紙の設定）。
   *
   * これは利用者が手で描き変えたわけではないので、**「手で直した」印は付けない**。
   * 付けてしまうと、そのあとヒアリングの回答を変えても図面が作り直されなくなり、
   * 「ケーブルの長さに『約』を付けたのに図面が変わらない」といったことが起きる。
   */
  const applyAuto = useCallback(
    (next: Doc) => {
      const stamped: Doc = { ...next, edited: doc.edited, basis: doc.basis };
      setHistory((h) => commit(h, stamped));
      onDocChange?.(stamped);
    },
    [onDocChange, doc.edited, doc.basis],
  );

  /**
   * レイヤーを足す・名前を変える・消す・向きを決める。
   * 元の図面を手で直したわけではないので「手で直した」印は付けず、「操作を戻す」の履歴にも入れない
   * （履歴は元の図面だけのもの。戻したとき、レイヤーは、いまのものを引き継ぐ）。
   */
  const applyLayers = useCallback(
    (next: Doc) => {
      const stamped: Doc = { ...next, edited: doc.edited, basis: doc.basis };
      setHistory((h) => ({ ...h, present: stamped }));
      onDocChange?.(stamped);
    },
    [onDocChange, doc.edited, doc.basis],
  );

  /** 操作を戻す／進める（元の図面だけ。レイヤーは、いまのものを引き継ぐ） */
  const stepHistory = (kind: 'undo' | 'redo') =>
    setHistory((h) => {
      const n = kind === 'undo' ? undo(h) : redo(h);
      const present = carryLayers(n.present, h.present);
      onDocChange?.(present);
      return { ...n, present };
    });

  /** レイヤーを切り替える。選んでいた要素や、線を引くモードは、いったんやめる */
  const selectLayer = (id: string | null) => {
    setActiveLayer(id);
    setSelection([]);
    setMode('select');
    setLayerNote(null);
  };

  /** 同じ種類の操作が、短い間に続いているか（続いていれば、「操作を戻す」では1つにまとめて戻す） */
  const isMerged = (key: string | undefined): boolean => {
    if (key === undefined) {
      lastEdit.current = null;
      return false;
    }
    const now = Date.now();
    const last = lastEdit.current;
    lastEdit.current = { key, at: now };
    return !!last && last.key === key && now - last.at < ARROW_MERGE_MS;
  };
  /** 元の図面の文字の大きさのように、続けて変える操作は、まとめて1回の操作にする */
  const applyMerged = (next: Doc, key: string) => {
    if (isMerged(key)) {
      const stamped: Doc = { ...next, edited: true, basis: doc.basis };
      setHistory((h) => ({ ...h, present: stamped }));
      onDocChange?.(stamped);
    } else apply(next);
  };

  /* ---- レイヤーに置いたものの編集（レイヤーごとに、「操作を戻す」の履歴を持つ） ---- */

  /** 置いたものを入れ替える。merge が true のときは、直前の操作と1つにまとめる（矢印キーで続けて動かすとき） */
  const commitLayer = (layerId: string, items: LayerItem[], merge = false) => {
    const cur = layerOf(docRef.current, layerId)?.items ?? [];
    setLayerHist((h) => {
      const e = h[layerId] ?? { past: [], future: [] };
      return { ...h, [layerId]: { past: merge ? e.past : [...e.past, cur], future: [] } };
    });
    applyLayers(setLayerItems(docRef.current, layerId, items));
  };
  /** 動かす・文字を変える・消す、など、レイヤーの置いたものを変える操作を、履歴に残して行う */
  const editLayer = (change: (d: Doc) => Doc, mergeKey?: string) => {
    if (activeId === null) return;
    const next = change(docRef.current);
    commitLayer(activeId, layerOf(next, activeId)?.items ?? [], isMerged(mergeKey));
  };
  const stepLayer = (kind: 'undo' | 'redo') => {
    if (activeId === null) return;
    const e = layerHist[activeId];
    const cur = layerOf(doc, activeId)?.items ?? [];
    if (!e) return;
    if (kind === 'undo' && e.past.length > 0) {
      setLayerHist({ ...layerHist, [activeId]: { past: e.past.slice(0, -1), future: [cur, ...e.future] } });
      applyLayers(setLayerItems(doc, activeId, e.past[e.past.length - 1]!));
    } else if (kind === 'redo' && e.future.length > 0) {
      setLayerHist({ ...layerHist, [activeId]: { past: [...e.past, cur], future: e.future.slice(1) } });
      applyLayers(setLayerItems(doc, activeId, e.future[0]!));
    } else return;
    setSelection([]);
  };
  const layerEntry = activeId !== null ? layerHist[activeId] : undefined;
  const canUndo = locked ? (layerEntry?.past.length ?? 0) > 0 : history.past.length > 0;
  const canRedo = locked ? (layerEntry?.future.length ?? 0) > 0 : history.future.length > 0;
  /** レイヤーに文字を足す（上限を超えるときは、知らせるだけ） */
  const [layerNote, setLayerNote] = useState<string | null>(null);
  const addLayerTextHere = () => {
    if (activeId === null) return;
    if (!canAddLayerText(docRef.current, activeId)) {
      setLayerNote(t('layer.itemLimit', { n: MAX_LAYER_ITEMS_PER_KIND }));
      return;
    }
    setLayerNote(null);
    const b = docBounds(docRef.current);
    const r = addLayerText(docRef.current, activeId, (b.x0 + b.x1) / 2, b.y1 + 40, '注記');
    if (!r) return;
    commitLayer(activeId, layerOf(r.doc, activeId)?.items ?? []);
    setSelectedId(r.id);
  };

  /** 開閉器をクリックしたとき：×印を付ける。すでに付いていれば、外す */
  const toggleCross = (symbolId: string) => {
    if (activeId === null) return;
    const d0 = docRef.current;
    const sym = d0.items.find((i) => i.kind === 'symbol' && i.id === symbolId);
    if (!sym || sym.kind !== 'symbol' || !canMark(sym)) {
      setLayerNote(t('cross.notSwitch'));
      return;
    }
    setLayerNote(null);
    const existing = crossOn(d0, activeId, symbolId);
    if (existing) {
      editLayer((d) => removeLayerItems(d, activeId, [existing.id]));
      setSelection([]);
      return;
    }
    if (!canAddLayerCross(d0, activeId)) {
      setLayerNote(t('layer.itemLimit.cross', { n: MAX_LAYER_ITEMS_PER_KIND }));
      return;
    }
    const r = addLayerCross(d0, activeId, symbolId, crossSize);
    if (r) commitLayer(activeId, layerOf(r.doc, activeId)?.items ?? []);
  };

  const addLayerFlow = async () => {
    const name = await input({
      title: t('layer.add.title'),
      message: [t('layer.add.help', { n: MAX_CUSTOM_LAYERS })],
      confirmLabel: t('layer.add.ok'),
      validate: (v) => {
        const p = layerNameProblem(docRef.current, v);
        return p ? t(p) : null;
      },
    });
    if (name === null) return;
    const r = addLayer(docRef.current, name);
    if (!r) return;
    applyLayers(r.doc);
    selectLayer(r.id);
  };
  const renameLayerFlow = async (id: string) => {
    const cur = layerTitle(docRef.current, id) ?? '';
    const name = await input({
      title: t('layer.rename.title'),
      defaultValue: cur,
      validate: (v) => {
        const p = layerNameProblem(docRef.current, v, id);
        return p ? t(p) : null;
      },
    });
    if (name === null) return;
    const next = renameLayer(docRef.current, id, name);
    if (next) applyLayers(next);
  };
  const removeLayerFlow = async (id: string) => {
    const cur = layerTitle(docRef.current, id) ?? '';
    if (!(await ask({ title: t('layer.remove.title'), message: [t('layer.remove.confirm', { name: cur })], confirmLabel: t('layer.remove') }))) return;
    const next = removeLayer(docRef.current, id);
    if (!next) return;
    applyLayers(next);
    setLayerHist(({ [id]: _gone, ...rest }) => rest);
    if (activeLayer === id) selectLayer(null);
  };

  /**
   * ヒアリングの回答から作り直す。手で直した内容は、自動で作った図面の上に重ねて、残す
   * （直前の図面は履歴に残るので、「操作を戻す」で戻せる）。
   * 手で直した内容を取り出せない古い図面（自動で作った図面の控えが無いもの）は、残せない。
   */
  const regenerate = () => {
    const legacy = doc.edited === true && !doc.base;
    const { doc: fresh, report } = legacy ? { doc: generated, report: { kept: false, dormant: 0, overlaps: 0 } } : rebuildWithOverrides(generated, doc);
    // 印刷の向きとレイヤーは、作り直しても、引き継ぐ
    const withOrientation: Doc = carryLayers(doc.orientation && !fresh.orientation ? { ...fresh, orientation: doc.orientation } : fresh, doc);
    setHistory((h) => commit(h, withOrientation));
    onDocChange?.(withOrientation);
    setSelection([]);
    return { ...report, lost: legacy };
  };

  /** 時間のかかる処理（結線を整える・縮小・拡大）を、別の流れで始める。押したらすぐ、画面の中央に「しばらくお待ちください」が出る */
  const startHeavy = (kind: HeavyKind) => heavy.start({ kind, doc, paper, orientation, titleH });

  /**
   * 処理が終わったときの、図面への反映と知らせ（この画面を開いているとき）。
   * ほかの画面を見ているあいだに終わったときは、App が図面に反映して、吹き出しで知らせる（useHeavyJob.tsx）。
   */
  const onHeavyDone = (_req: HeavyRequest, res: HeavyResult) => {
    if (res.kind === 'tidy') {
      const r = res.result;
      applyAuto(r.doc);
      const done = Object.entries(r.fixed)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => t('editor.issueCount', { label: issueLabel(k as IssueKind), n }));
      setIssues(r.issues);
      setTidyNote(done.length > 0 ? t('editor.tidyDone', { list: done.join(' / ') }) : t('editor.tidyNone'));
    } else if (res.kind === 'shrink') {
      setTidyNote(null);
      setIssues(null);
      if (!res.result.changed) {
        setLayoutNote(t('editor.layoutLimit'));
        return;
      }
      setLayoutNote(null);
      apply(res.result.doc);
    } else {
      setTidyNote(null);
      setIssues(null);
      setLayoutNote(null);
      if (res.result.changed) apply(res.result.doc);
    }
  };
  useEffect(() => {
    heavy.bind(onHeavyDone);
    return () => heavy.bind(null);
  });

  /**
   * 入力内容が変わったら、ボタンを押さなくても、自動で図面に反映する。
   * （どの回答から作った図面かは、Doc.basis に覚えてある。違っていたら、いまの回答で作り直す）
   * 手で直した図面のときは、作り直したことを知らせる（「操作を戻す」で、元の図面に戻せる）。
   * 動くのは、この画面を開いたときと、回答が変わったときだけ。「操作を戻す」で古い図面に戻したときは、
   * 戻した図面をそのまま見せる（すぐに作り直さない）。
   */
  useEffect(() => {
    if (doc.basis === undefined || doc.basis === basis) return;
    const edited = doc.edited === true;
    const r = regenerate();
    if (edited) setRebuiltNote(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 印刷プレビュー中と、レイヤーを選んでいるあいだは、元の図面を編集できない（Delete や 元に戻す のキーも効かせない）
      if (sheetView) return;
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (locked && activeId !== null) {
        // レイヤーを選んでいるあいだは、そのレイヤーに置いたものだけを、戻す・消す・動かす
        if (e.key === 'Escape' && mode === 'cross' && !e.isComposing) {
          e.preventDefault();
          setMode('select');
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          stepLayer(e.shiftKey ? 'redo' : 'undo');
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length > 0) {
          e.preventDefault();
          editLayer((d) => removeLayerItems(d, activeId, selection));
          setSelection([]);
        } else if (selection.length > 0 && mode === 'select' && !e.ctrlKey && !e.metaKey && !e.altKey && e.key in ARROW_MOVE) {
          e.preventDefault();
          // 動かせるのは文字だけ（×印は、付けた開閉器について動く）
          const textIds = selection.filter((id) => layerDocItems.some((i) => i.id === id));
          if (textIds.length === 0) return;
          const [ux, uy] = ARROW_MOVE[e.key]!;
          const step = e.shiftKey ? ARROW_STEP * ARROW_SHIFT_TIMES : ARROW_STEP;
          editLayer((d) => moveLayerItems(d, activeId, textIds, ux * step, uy * step), `arrow:${textIds.join(',')}`);
        }
        return;
      }
      // 線を引くモードは、Esc キーで解除する（引きかけの線も、取りやめ）
      if (e.key === 'Escape' && mode === 'wire' && !e.isComposing) {
        e.preventDefault();
        setMode('select');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        stepHistory(e.shiftKey ? 'redo' : 'undo');
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length > 0) {
        e.preventDefault();
        apply(selection.length === 1 ? removeItem(doc, selection[0]!) : removeItems(doc, selection));
        setSelection([]);
      } else if (selection.length > 0 && mode === 'select' && !e.ctrlKey && !e.metaKey && !e.altKey && e.key in ARROW_MOVE) {
        // 選んでいる要素（複数のときは、まとめて）を、矢印キーの向きに動かす（マウスでドラッグするのと同じ動かし方）
        e.preventDefault();
        const [ux, uy] = ARROW_MOVE[e.key]!;
        const step = e.shiftKey ? ARROW_STEP * ARROW_SHIFT_TIMES : ARROW_STEP;
        const moved = selection.length === 1 ? moveItem(doc, selection[0]!, ux * step, uy * step) : moveItems(doc, selection, ux * step, uy * step);
        const next: Doc = { ...moved, edited: true, basis: doc.basis };
        const now = Date.now();
        const last = lastArrow.current;
        const arrowKey = selection.join(',');
        lastArrow.current = { id: arrowKey, at: now };
        if (last && last.id === arrowKey && now - last.at < ARROW_MERGE_MS) {
          // 続けて押している間は、1回の操作として扱う（「操作を戻す」を1回押せば、押す前に戻る）
          setHistory((h) => ({ ...h, present: next }));
          onDocChange?.(next);
        } else {
          setHistory((h) => commit(h, next));
          onDocChange?.(next);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, selection, apply, sheetView, locked, activeId, layerHist, mode, layerDocItems]);

  // 自動作図のためだけに用意した差し替え版（PASの枠を広げたものなど）は、
  // 手で選ぶものではないので一覧に出さない
  const palette = SYMBOLS.filter((s) => s.category === paletteCategory && !(s.altOf && s.optional));
  const categories = [...new Set(SYMBOLS.map((s) => s.category))];

  const onPaletteClick = (symbolId: string) => {
    if (selectedSymbol) {
      apply(replaceSymbol(doc, selectedSymbol.id, symbolId));
    } else {
      const b = docBounds(doc);
      const { doc: next, id } = addSymbol(doc, symbolId, (b.x0 + b.x1) / 2, b.y1 + 60);
      apply(next);
      setSelectedId(id);
    }
  };

  return (
    <div className="editor">
      <div className={`editor-bar${moreOpen ? ' more-open' : ''}`}>
        <div className="tools">
          {/* ボタンは、用途ごとに、見出し付きのグループにまとめる。スマホでは、見出しを消し、「sec」の付いたものを「ほかの操作」の中にしまう */}
          <div className="tool-group">
            <span className="cap">{t('editor.group.history')}</span>
            <div className="tool-row">
              <button
                type="button"
                className="btn with-icon"
                title={t('editor.undo.help')}
                onClick={() => (locked ? stepLayer('undo') : stepHistory('undo'))}
                disabled={sheetView || !canUndo}
              >
                <UndoIcon />
                {t('editor.undo')}
              </button>
              <button
                type="button"
                className="btn with-icon"
                title={t('editor.redo.help')}
                onClick={() => (locked ? stepLayer('redo') : stepHistory('redo'))}
                disabled={sheetView || !canRedo}
              >
                <UndoIcon redo />
                {t('editor.redo')}
              </button>
            </div>
          </div>

          <div className="tool-group">
            <span className="cap">{t('editor.group.edit')}</span>
            <div className="tool-row">
              <button
                type="button"
                className="btn danger"
                disabled={sheetView || selection.length === 0}
                onClick={() => {
                  if (selection.length === 0) return;
                  if (locked && activeId !== null) editLayer((d) => removeLayerItems(d, activeId, selection));
                  else apply(selection.length === 1 ? removeItem(doc, selection[0]!) : removeItems(doc, selection));
                  setSelection([]);
                }}
              >
                {t('editor.delete')}
              </button>
              {selection.length > 1 && <span className="multi-note">{selection.length}{t('editor.multiSelected')}</span>}
              <button
                type="button"
                className="sec"
                disabled={sheetView}
                onClick={() => {
                  if (locked) {
                    addLayerTextHere();
                    return;
                  }
                  const b = docBounds(doc);
                  const { doc: next, id } = addText(doc, (b.x0 + b.x1) / 2, b.y1 + 40, '注記');
                  apply(next);
                  setSelectedId(id);
                }}
              >
                {t('editor.addNote')}
              </button>
              <button
                type="button"
                className={`sec${mode === 'wire' ? ' on' : ''}`}
                aria-pressed={mode === 'wire'}
                disabled={frozen}
                onClick={() => {
                  setMode((m) => (m === 'wire' ? 'select' : 'wire'));
                  setSelection([]);
                }}
              >
                {t('editor.drawWire')}
              </button>
            </div>
          </div>

          {/* レイヤーに置く赤い印の道具。レイヤーを選んでいるときだけ使える（単線結線図では、押すと、使えないことを知らせる） */}
          <div className="tool-group sec">
            <span className="cap">{t('editor.group.marks')}</span>
            <div className="tool-row">
              <button
                type="button"
                className={`${locked ? '' : 'dim'}${mode === 'cross' ? ' on' : ''}`.trim()}
                aria-pressed={mode === 'cross'}
                aria-disabled={!locked || sheetView}
                title={t('layer.tool.crossHelp')}
                onClick={() => {
                  if (sheetView) return;
                  if (!locked) {
                    setLayerNote(t('layer.tool.notHere'));
                    return;
                  }
                  setLayerNote(null);
                  setSelection([]);
                  setMode((m) => (m === 'cross' ? 'select' : 'cross'));
                }}
              >
                {t('layer.tool.cross')}
              </button>
            </div>
          </div>

          {/* スマホ専用のボタン */}
          <button type="button" className="tools-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
            {moreOpen ? t('editor.moreClose') : t('editor.more')}
          </button>
          <button type="button" className="tools-toggle" aria-expanded={sideOpen} onClick={() => setSideOpen((v) => !v)}>
            {t('editor.sideOpen')}
          </button>

          <div className="tool-group sec">
            <span className="cap">{t('editor.group.tidy')}</span>
            <div className="tool-row">
              <button
                type="button"
                className="btn sec"
                title={t('editor.tidy.help')}
                disabled={frozen || heavy.busy !== null}
                aria-busy={heavy.busy === 'tidy'}
                onClick={() => startHeavy('tidy')}
              >
                {t('editor.tidy')}
              </button>
              <button
                type="button"
                className="btn"
                title={t('editor.layoutShrinkHelp')}
                disabled={frozen || heavy.busy !== null}
                aria-busy={heavy.busy === 'shrink'}
                onClick={() => startHeavy('shrink')}
              >
                {t('editor.layoutShrink')}
              </button>
              <button
                type="button"
                className="btn"
                title={t('editor.layoutExpandHelp')}
                disabled={frozen || heavy.busy !== null}
                aria-busy={heavy.busy === 'expand'}
                onClick={() => startHeavy('expand')}
              >
                {t('editor.layoutExpand')}
              </button>
            </div>
          </div>

          <div className="tool-group sec">
            <span className="cap">{t('editor.group.print')}</span>
            <div className="tool-row">
              <LayerMenu
                infos={layerInfos(doc)}
                activeId={activeId}
                full={customCount(doc) >= MAX_CUSTOM_LAYERS}
                onSelect={selectLayer}
                onAdd={() => void addLayerFlow()}
                onRename={(id) => void renameLayerFlow(id)}
                onRemove={(id) => void removeLayerFlow(id)}
              />
              <button
                type="button"
                className="btn"
                aria-pressed={sheetView}
                title={t('editor.sheetTitle')}
                onClick={() => {
                  setSheetView((v) => !v);
                  setMode('select');
                }}
              >
                {t('editor.sheetOpen')}
              </button>
              <button type="button" onClick={() => window.print()}>
                {t('editor.print')}
              </button>
            </div>
          </div>

          <div className="tool-group zoom-group">
            <span className="cap">{t('editor.group.view')}</span>
            <div className="tool-row">
              <button type="button" className="with-icon" disabled={sheetView} onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}>
                <ZoomIcon kind="out" />
                {t('editor.zoomOut')}
              </button>
              <span className="zoom">{Math.round(zoom * 100)}%</span>
              <button type="button" className="with-icon" disabled={sheetView} onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>
                <ZoomIcon kind="in" />
                {t('editor.zoomIn')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {locked && (
        <p className="layer-note" role="status">
          <b>{t('layer.editing', { name: layerTitle(doc, activeId!) ?? '' })}</b>
          <span className="hint">{t('layer.locked')}</span>
          <button type="button" className="btn" onClick={() => selectLayer(null)}>
            {t('layer.backToBase')}
          </button>
        </p>
      )}

      {layerNote && (
        <p className="layer-note" role="status">
          <b>{layerNote}</b>
          <button type="button" className="btn" onClick={() => setLayerNote(null)}>
            {t('common.close')}
          </button>
        </p>
      )}

      {rebuiltNote && (
        <p className="stale-note" role="status">
          <Rich text={t('editor.rebuilt')} />
          {rebuiltNote.lost ? (
            <span className="hint">{t('editor.rebuiltLost')}</span>
          ) : rebuiltNote.kept ? (
            <span className="hint">
              {t('editor.rebuiltKept')}
              {rebuiltNote.dormant > 0 && ` ${t('editor.rebuiltDormant', { n: rebuiltNote.dormant })}`}
              {rebuiltNote.overlaps > 0 && ` ${t('editor.rebuiltOverlap', { n: rebuiltNote.overlaps })}`}
              {` ${t('editor.rebuiltUndo')}`}
            </span>
          ) : (
            <span className="hint">{t('editor.rebuiltUndo2')}</span>
          )}
          <button type="button" className="btn" onClick={() => setRebuiltNote(null)}>
            {t('common.close')}
          </button>
        </p>
      )}

      {layoutNote && (
        <p className="tidy-note" role="status">
          <b>{layoutNote}</b>
          <button type="button" className="btn" onClick={() => setLayoutNote(null)}>
            {t('common.close')}
          </button>
        </p>
      )}

      {tidyNote && (
        <p className={`tidy-note${issues && issues.length > 0 ? ' has-left' : ''}`}>
          <b>{tidyNote}</b>
          {issues && issues.length > 0 ? (
            <>
              <span>{t('editor.issuesLeft', { n: issues.length })}</span>
              <ul className="issue-list">
                {issues.slice(0, 8).map((is, i) => (
                  <li key={i}>
                    <span className="tag">{issueLabel(is.kind)}</span>
                    {is.message}
                  </li>
                ))}
                {issues.length > 8 && <li>{t('editor.issuesMore', { n: issues.length - 8 })}</li>}
              </ul>
            </>
          ) : (
            <span>{t('editor.issuesNone')}</span>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setTidyNote(null);
              setIssues(null);
            }}
          >
            {t('common.close')}
          </button>
        </p>
      )}

      {mode === 'wire' && (
        <p className="mode-hint">{t('editor.wireHint')}</p>
      )}

      {mode === 'cross' && locked && !sheetView && (
        <p className="mode-hint cross-hint">
          <span>{t('cross.hint')}</span>
          <span className="cross-size-pick">
            <span className="lbl">{t('cross.size')}</span>
            <span className="seg" role="group" aria-label={t('cross.size')}>
              {CROSS_SIZE_IDS.map((sz) => (
                <button key={sz} type="button" className="btn" aria-pressed={crossSize === sz} onClick={() => setCrossSize_(sz)}>
                  {t(CROSS_LABEL[sz])}
                </button>
              ))}
            </span>
          </span>
          <button type="button" className="btn" onClick={() => setMode('select')}>
            {t('cross.done')}
          </button>
        </p>
      )}

      {sheetView && (
        <p className="preview-note" role="status">
          <span>{t('editor.sheetNoEdit')}</span>
          {/* 縦・横は、印刷プレビューのときだけ出す。上のボタンの列に入れると、出たときに列が折り返して、ボタンがずれるので、プレビュー中の帯に置く */}
          <span className="paper-pick" role="group" title={t('editor.orientation.help')}>
            {(['portrait', 'landscape'] as Orientation[]).map((o) => (
              <button
                key={o}
                type="button"
                className="btn"
                aria-pressed={orientation === o}
                onClick={() => (activeId !== null ? applyLayers(setLayerOrientation(doc, activeId, o)) : applyAuto({ ...doc, orientation: o }))}
              >
                {o === 'portrait' ? t('editor.portrait') : t('editor.landscape')}
              </button>
            ))}
          </span>
          <button type="button" className="btn" onClick={() => setSheetView(false)}>
            {t('editor.sheetClose')}
          </button>
        </p>
      )}

      {/* 印刷の向きだけを指定する。用紙の大きさは、印刷の設定画面（プリンター）で決まり、図面は、その用紙いっぱいに収まる */}
      <style>{`@page { size: ${orientation}; margin: 0; }
        .print-root { position: fixed; inset: 0; }
        .print-root svg { width: 100%; height: 100%; }`}</style>
      <div className="print-root" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sheetSvg }} />

      {/* 「線を引く」のあいだだけ、図面の上に出す、線の種類の窓（道具の並びは、広げない） */}
      {mode === 'wire' && !sheetView && (
        <WireKindWindow
          dashed={wireDashed}
          onChange={setWireDashed}
          onClose={() => {
            setMode('select');
            setSelection([]);
          }}
          pos={wireWinPos}
          onPos={setWireWinPos}
          anchor={canvasWrapRef}
        />
      )}

      <div className="editor-body">
        <div className="canvas-wrap" ref={canvasWrapRef}>
          {sheetView ? (
            <div
              className="sheet-view"
              style={{ aspectRatio: `${sheetMm.mmW} / ${sheetMm.mmH}` }}
              dangerouslySetInnerHTML={{ __html: sheetSvg }}
            />
          ) : (
          <DrawingCanvas
            doc={viewDoc}
            selectedIds={selection}
            onSelect={setSelection}
            onMoveEnd={(ids, dx, dy) => {
              if (locked && activeId !== null) editLayer((d) => moveLayerItems(d, activeId, ids, dx, dy));
              else apply(ids.length === 1 ? moveItem(doc, ids[0]!, dx, dy) : moveItems(doc, ids, dx, dy));
            }}
            onWireEnd={(id, end, dx, dy) => apply(moveWireEnd(doc, id, end, dx, dy))}
            onResizeEnd={(id, rect) => apply(setItemRect(doc, id, rect))}
            onAddWire={(x1, y1, x2, y2, opts) => {
              const { doc: next, id } = addWire(doc, x1, y1, x2, y2, { ...opts, dashed: wireDashed });
              apply(next);
              // 線を引くモードは続ける（次の線を、続けて引ける）。やめるときは、Esc キーか「線を引く」をもう一度押す
              setSelectedId(id);
            }}
            mode={mode}
            crosses={layerCrosses}
            onCrossClick={toggleCross}
            locked={locked}
            activeIds={activeIds}
            wireDashed={wireDashed}
            zoom={zoom}
            onZoom={setZoom}
            issues={issues ?? []}
          />
          )}
        </div>

        <aside className={`side${sideOpen ? ' open' : ''}`} inert={sheetView}>
          <button type="button" className="btn side-close" onClick={() => setSideOpen(false)}>
            {t('common.close')}
          </button>
          <section inert={locked}>
            <h3>{t('editor.palette')}</h3>
            <p className="hint">
              {selectedSymbol
                ? t('editor.palette.replace')
                : t('editor.palette.add')}
            </p>
            <select value={paletteCategory} onChange={(e) => setPaletteCategory(e.target.value as SymbolCategory)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {tx(CATEGORY_LABEL[c])}
                </option>
              ))}
            </select>
            <div className="palette">
              {palette.map((s) => (
                <button key={s.id} type="button" title={tx(s.nameJa)} onClick={() => onPaletteClick(s.id)}>
                  <span
                    className="thumb"
                    dangerouslySetInnerHTML={{ __html: symbolToSvg(s, { padding: 4, scale: 0.62, label: tx(s.nameJa) }) }}
                  />
                  <span className="cap">{tx(s.abbr)}</span>
                </button>
              ))}
            </div>
          </section>

          {selectedCross && activeId !== null && (
            <section>
              <h3>{t('editor.selected')}</h3>
              <p className="hint">{t('cross.selected')}</p>
              <label className="lbl">{t('cross.size')}</label>
              <div className="seg" role="group" aria-label={t('cross.size')}>
                {CROSS_SIZE_IDS.map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    className="btn"
                    aria-pressed={selectedCross.sizeId === sz}
                    onClick={() => editLayer((d) => setCrossSize(d, activeId, selectedCross.id, sz))}
                  >
                    {t(CROSS_LABEL[sz])}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  editLayer((d) => removeLayerItems(d, activeId, [selectedCross.id]));
                  setSelection([]);
                }}
              >
                {t('cross.remove')}
              </button>
            </section>
          )}

          {selected && (
            <section>
              <h3>{t('editor.selected')}</h3>
              {selectedSymbol ? (
                <>
                  <p className="hint">
                    {tx(getSymbol(selectedSymbol.symbolId).nameJa)}
                  </p>
                  {/* 外箱・エリアの区分枠：端や角をつかんで、大きさを変えられる */}
                  {resizeInfoOf(selectedSymbol) && <p className="hint">{t('editor.resizeHint')}</p>}
                  {(() => {
                    const def = getSymbol(selectedSymbol.symbolId);
                    const fields = labelFields(def);
                    if (fields.length === 0) return null;
                    const values = selectedSymbol.values;
                    return (
                      <div className="ratings">
                        <label className="lbl">{t('editor.ratings')}</label>
                        {values ? (
                          <>
                            <p className="hint">{t('editor.ratings.help')}</p>
                            {fields.map((f) => {
                              const listId = `rating-${selectedSymbol.id}-${f.key}`;
                              const free = f.type !== 'select' || f.allowFreeInput;
                              return (
                                <label className="rating" key={f.key}>
                                  <span>{tx(f.label)}</span>
                                  {f.type === 'select' && !f.allowFreeInput ? (
                                    <select value={values[f.key] ?? ''} onChange={(e) => apply(setLabelValue(doc, selectedSymbol.id, f.key, e.target.value))}>
                                      <option value="">{t('editor.ratings.blank')}</option>
                                      {f.options?.map((o) => (
                                        <option key={o.value} value={o.value}>{tx(o.label)}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      type="text"
                                      maxLength={MAX_TEXT_LENGTH}
                                      inputMode={f.type === 'number' ? 'decimal' : undefined}
                                      list={f.type === 'select' ? listId : undefined}
                                      value={values[f.key] ?? ''}
                                      onChange={(e) => apply(setLabelValue(doc, selectedSymbol.id, f.key, e.target.value))}
                                    />
                                  )}
                                  {f.unit && <span className="unit">{tx(f.unit)}</span>}
                                  {free && f.type === 'select' && (
                                    <datalist id={listId}>
                                      {f.options?.map((o) => (
                                        <option key={o.value} value={o.value}>{tx(o.label)}</option>
                                      ))}
                                    </datalist>
                                  )}
                                </label>
                              );
                            })}
                          </>
                        ) : (
                          <>
                            <p className="hint">{t('editor.ratings.manual')}</p>
                            <button type="button" className="btn" onClick={() => apply(resetLabelFromFields(doc, selectedSymbol.id))}>
                              {t('editor.ratings.reset')}
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })()}
                  <label className="lbl">{t('editor.labelText')}</label>
                  <textarea
                    rows={4}
                    maxLength={MAX_TEXT_LENGTH}
                    value={selectedSymbol.label.join('\n')}
                    onChange={(e) => apply(setLabel(doc, selectedSymbol.id, e.target.value.split('\n')))}
                  />
                </>
              ) : selected.kind === 'text' ? (
                <>
                  <label className="lbl">{t('editor.note')}</label>
                  <textarea
                    rows={3}
                    maxLength={MAX_TEXT_LENGTH}
                    value={selected.lines.join('\n')}
                    onChange={(e) => {
                      const lines = e.target.value.split('\n');
                      if (locked && activeId !== null) editLayer((d) => updateLayerText(d, activeId, selected.id, { lines }));
                      else apply(setLabel(doc, selected.id, lines));
                    }}
                  />
                  <TextStyleControls
                    size={selected.size}
                    bold={!!selected.bold}
                    red={locked ? !!selected.red : null}
                    onSize={(n) => {
                      if (locked && activeId !== null) editLayer((d) => updateLayerText(d, activeId, selected.id, { size: n }), `size:${selected.id}`);
                      else applyMerged(setTextStyle(doc, selected.id, { size: n }), `size:${selected.id}`);
                    }}
                    onBold={(b) => {
                      if (locked && activeId !== null) editLayer((d) => updateLayerText(d, activeId, selected.id, { bold: b }));
                      else apply(setTextStyle(doc, selected.id, { bold: b }));
                    }}
                    onRed={(r) => {
                      if (locked && activeId !== null) editLayer((d) => updateLayerText(d, activeId, selected.id, { red: r }));
                    }}
                  />
                </>
              ) : (
                <>
                  <p className="hint">
                    {selected.kind === 'wire'
                      ? t('editor.wireSelected')
                      : t('editor.frameSelected')}
                  </p>
                  {selected.kind === 'wire' && (
                    <>
                      <label className="lbl">{t('editor.lineKind')}</label>
                      <span className="wire-kinds" role="group" aria-label={t('editor.lineKind')}>
                        {([false, true] as const).map((dashed) => (
                          <button
                            key={String(dashed)}
                            type="button"
                            className="line-kind"
                            aria-pressed={!!selected.dashed === dashed}
                            disabled={sheetView}
                            title={t(dashed ? 'editor.lineDashed' : 'editor.lineSolid')}
                            aria-label={t(dashed ? 'editor.lineDashed' : 'editor.lineSolid')}
                            onClick={() => apply(setWireKind(doc, [selected.id], dashed))}
                          >
                            <svg width="44" height="10" viewBox="0 0 44 10" aria-hidden="true">
                              <line x1="2" y1="5" x2="42" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={dashed ? '6 4' : undefined} />
                            </svg>
                          </button>
                        ))}
                      </span>
                    </>
                  )}
                </>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
