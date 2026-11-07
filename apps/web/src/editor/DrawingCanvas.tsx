import { useLayoutEffect, useRef, useState } from 'react';
import { tr } from '../i18n/index.ts';
import { FONT_FAMILY, getSymbol, shapesToSvg } from '@zumen/symbols';
import { LABEL_FONT, LABEL_LINE, OVERLAY_RED, clampTextSize, crossPointsAttr } from '@zumen/layout';
import type { Doc, DocItem, PointAssist } from './doc.ts';
import { snap } from '@zumen/layout';
import { assistMove, assistPoint, assistWireEnd, assistWireNew, defOf, docBounds, groupOf, groupRootOf, itemBounds, itemsInRange, moveItem, moveItems, moveWireEnd, resizeInfoOf, setItemRect } from './doc.ts';
import type { Issue } from './inspect.ts';
import type { ResolvedCross } from './layers.ts';

interface Props {
  doc: Doc;
  /** 選んでいる要素（複数のこともある。1つも無ければ空） */
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  /** ドラッグが終わったときに一度だけ呼ぶ（元に戻すの単位をドラッグ1回にするため）。複数選んでいるときは、まとめて動かす */
  onMoveEnd: (ids: string[], dx: number, dy: number) => void;
  /** 線の端を動かして伸縮したとき */
  onWireEnd: (id: string, end: 1 | 2, dx: number, dy: number) => void;
  /** 線を引き終えたとき */
  onAddWire: (x1: number, y1: number, x2: number, y2: number, opts?: { assist?: boolean; range?: number }) => void;
  /** 'wire' のときは2点をクリックして線を引く。'cross' のときは、開閉器をクリックして、開放の×印を付ける・外す */
  mode: 'select' | 'wire' | 'cross';
  /** レイヤーに付けた赤い×印（図面のいちばん上に描く） */
  crosses?: ResolvedCross[];
  /** 'cross' のときに、記号（PAS のような、中に部品を抱えるものは、かたまりの親）をクリックしたとき */
  onCrossClick?: (symbolId: string) => void;
  /** 'cross' のときに、×印そのものをクリックしたとき（その×印を外す） */
  onCrossRemove?: (crossId: string) => void;
  /** ×印をドラッグして動かし終わったとき（動かした量。付けた開閉器の中央からのずれが変わる） */
  onCrossMoveEnd?: (crossId: string, dx: number, dy: number) => void;
  /**
   * 元の図面を動かせない状態（レイヤーを選んでいるとき）。元の図面は薄く表示して、選ぶ・動かす・線を引くことはできない。
   * 触れるのは、activeIds に入っているもの（そのレイヤーに置いたもの）だけ
   */
  locked?: boolean;
  activeIds?: ReadonlySet<string>;
  /** 線を引くとき、点線で引くか（引いている最中の見本の線も、同じ種類で出す） */
  wireDashed?: boolean;
  zoom: number;
  /** 2本指で拡大縮小したとき（指で操作する端末用） */
  onZoom?: (zoom: number) => void;
  /** 枠の端・角をつかんで、大きさを変え終わったとき（左上の位置と大きさ） */
  onResizeEnd?: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
  /** 「結線を整える」で直しきれなかったところ。赤い印で知らせる */
  issues?: Issue[];
}

/** 吸い付く範囲の、画面上の大きさ（ピクセル）。拡大・縮小しても、同じ感覚になるよう、図面の長さには直して使う */
const SNAP_PX = 9;

/** 拡大縮小の範囲（Editor の「拡大」「縮小」ボタンと同じ） */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 3;

/** 指で操作するときの、つまんだ・なぞった状態 */
interface Pinch {
  startDist: number;
  startZoom: number;
}

/** 動かしている最中の状態。dx・dy は吸い寄せたあとの値 */
interface Drag {
  id: string;
  /** いっしょに動かすもの（複数選んでいるとき）。1つだけのときは [id] */
  ids: string[];
  end?: 1 | 2;
  dx: number;
  dy: number;
  /** 揃った位置に引く目安の線 */
  guideX?: number;
  guideY?: number;
}

/** 端・角をつかんで大きさを変えている最中の状態 */
interface Resize {
  id: string;
  /** つかんだ場所。h＝横（l 左端／r 右端）、v＝縦（t 上端／b 下端） */
  h: 'l' | 'r' | null;
  v: 't' | 'b' | null;
  /** つかむ前の範囲と、いまの範囲 */
  from: { x: number; y: number; w: number; h: number };
  rect: { x: number; y: number; w: number; h: number };
}

/** 図面のキャンバス。記号をクリックで選び、ドラッグで動かせる */
export function DrawingCanvas({ doc, selectedIds, onSelect, onMoveEnd, onWireEnd, onAddWire, onResizeEnd, mode, crosses = [], onCrossClick, onCrossRemove, onCrossMoveEnd, locked = false, activeIds, wireDashed = false, zoom, onZoom, issues = [] }: Props) {
  const selectedId = selectedIds.length === 1 ? selectedIds[0]! : null;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resize, setResize] = useState<Resize | null>(null);
  /** ×印をドラッグしている最中（動かした量） */
  const [crossDrag, setCrossDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** 何も無いところからドラッグして、範囲で選んでいる最中。表示用の枠（図面の座標）と、動いたか・追加選択か */
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const bandRef = useRef<{ x: number; y: number; cx: number; cy: number; additive: boolean; moved: boolean; base: string[] } | null>(null);
  /** 複数選んでいるうちの1つを、動かさずにクリックして離したとき、その1つだけの選択にする */
  const collapseTo = useRef<string | null>(null);
  /** 線を引いている途中の始点と、いまのカーソル位置 */
  const [wireStart, setWireStart] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  /** 線を引くモードで、いま吸い付いている先（つなぐ先の目印を出すため）。Alt キーを押している間は無し */
  const [hint, setHint] = useState<PointAssist | null>(null);

  /* ---- 指での操作：2本指で拡大縮小・動かす／何も無いところを1本指でなぞって動かす ---- */
  /** いま画面に触れている指（touch のみ） */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<Pinch | null>(null);
  /** 2本指の操作のあと、残った指は、離すまで何もしない */
  const ignored = useRef(new Set<number>());
  /** 何も無いところを1本指でなぞっている状態。動かしていなければ、離したときに「選択を外す」 */
  const pan = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  /** 拡大縮小の前後で、指の位置がずれないよう、動かす前の位置を覚えておく */
  const anchor = useRef<{ fx: number; fy: number; sl: number; st: number; sw: number; sh: number } | null>(null);

  // 線を引くモードに入った・出たときは、引きかけの線を捨てる（Esc で解除したときも、ここで片づく）
  useLayoutEffect(() => {
    setWireStart(null);
    setCursor(null);
    setHint(null);
  }, [mode]);

  const scroller = () => svgRef.current?.parentElement ?? null;

  useLayoutEffect(() => {
    const a = anchor.current;
    const sc = scroller();
    if (!a || !sc) return;
    sc.scrollLeft = (a.sl + a.fx) * (sc.scrollWidth / a.sw) - a.fx;
    sc.scrollTop = (a.st + a.fy) * (sc.scrollHeight / a.sh) - a.fy;
    anchor.current = null;
  }, [zoom]);

  const centerOf = () => {
    const pts = [...touches.current.values()];
    return { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
  };
  const distOf = () => {
    const pts = [...touches.current.values()];
    return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
  };

  /**
   * 指の操作は、図面の外側の枠（動かせる領域）全体で受ける。
   * 図面の外に指が置かれても、2本指の操作ができるように。また、記号などの処理より先に受ける（捕まえて止めることがある）
   */
  const latest = useRef({ zoom, mode, onSelect, onZoom });
  latest.current = { zoom, mode, onSelect, onZoom };

  useLayoutEffect(() => {
    const sc = svgRef.current?.parentElement;
    if (!sc) return;
    const stop = (e: Event) => e.stopPropagation();

    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const n = touches.current.size;
      if (n === 2) {
        // 2本目の指：動かしかけていた記号は、そのまま元に戻す（確定しない）
        setDrag(null);
        start.current = null;
        pan.current = null;
        setWireStart(null);
        setCursor(null);
        pinch.current = { startDist: Math.max(1, distOf()), startZoom: latest.current.zoom };
        stop(e);
      } else if (n > 2 || ignored.current.has(e.pointerId)) {
        stop(e);
      } else if (latest.current.mode === 'select' && !(e.target as Element).closest?.('g.item, .grip, .grip-edge')) {
        // 1本指で、記号でないところ：なぞれば画面が動く。ちょんと触れただけなら、離したときに選択を外す
        pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      }
    };

    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const prev = touches.current.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      touches.current.set(e.pointerId, cur);
      if (pinch.current && touches.current.size === 2) {
        stop(e);
        // 2本指：指の間隔で拡大縮小し、指の中心が動いた分だけ、画面を動かす
        const c = centerOf();
        const r = sc.getBoundingClientRect();
        const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinch.current.startZoom * (distOf() / pinch.current.startDist)));
        sc.scrollLeft -= (cur.x - prev.x) / 2;
        sc.scrollTop -= (cur.y - prev.y) / 2;
        const z = latest.current.zoom;
        if (latest.current.onZoom && Math.abs(next - z) > 0.01) {
          anchor.current = { fx: c.x - r.left, fy: c.y - r.top, sl: sc.scrollLeft, st: sc.scrollTop, sw: sc.scrollWidth, sh: sc.scrollHeight };
          latest.current.onZoom(next);
        }
        return;
      }
      if (ignored.current.has(e.pointerId) || touches.current.size > 1) {
        stop(e);
        return;
      }
      const p = pan.current;
      if (p && p.id === e.pointerId) {
        if (!p.moved && Math.hypot(cur.x - p.x, cur.y - p.y) > 6) p.moved = true;
        if (p.moved) {
          sc.scrollLeft -= cur.x - prev.x;
          sc.scrollTop -= cur.y - prev.y;
        }
      }
    };

    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const wasPinching = pinch.current !== null;
      touches.current.delete(e.pointerId);
      const p = pan.current;
      if (p && p.id === e.pointerId) {
        pan.current = null;
        if (!p.moved && latest.current.mode === 'select') latest.current.onSelect([]);
      }
      if (ignored.current.delete(e.pointerId)) stop(e);
      if (wasPinching) {
        stop(e);
        if (touches.current.size < 2) {
          pinch.current = null;
          for (const id of touches.current.keys()) ignored.current.add(id);
        }
      }
    };

    /**
     * Ctrl（Macでは、トラックパッドの2本指の広げ・縮めも同じ扱い）＋ホイール：
     * ブラウザ全体ではなく、図面だけを拡大縮小する。マウスのある位置を動かさずに拡大縮小する。
     * Ctrl を押していないホイールは、これまでどおり（画面を動かす）。
     */
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !latest.current.onZoom) return;
      e.preventDefault();
      // 行単位・ページ単位で届く環境（Firefoxなど）は、ピクセルに直す
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const dy = Math.max(-120, Math.min(120, e.deltaY * unit));
      const z = latest.current.zoom;
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * Math.exp(-dy * 0.002)));
      if (Math.abs(next - z) < 0.005) return;
      const r = sc.getBoundingClientRect();
      anchor.current = { fx: e.clientX - r.left, fy: e.clientY - r.top, sl: sc.scrollLeft, st: sc.scrollTop, sw: sc.scrollWidth, sh: sc.scrollHeight };
      latest.current.zoom = next;
      latest.current.onZoom(next);
    };

    sc.addEventListener('pointerdown', down, true);
    sc.addEventListener('pointermove', move, true);
    sc.addEventListener('pointerup', up, true);
    sc.addEventListener('pointercancel', up, true);
    sc.addEventListener('wheel', wheel, { passive: false });
    return () => {
      sc.removeEventListener('wheel', wheel);
      sc.removeEventListener('pointerdown', down, true);
      sc.removeEventListener('pointermove', move, true);
      sc.removeEventListener('pointerup', up, true);
      sc.removeEventListener('pointercancel', up, true);
    };
  }, []);

  // 表示用の図面。動かしている最中も、結線をつないだまま見せる
  const view = resize
    ? setItemRect(doc, resize.id, resize.rect)
    : !drag
    ? doc
    : drag.end
      ? moveWireEnd(doc, drag.id, drag.end, drag.dx, drag.dy)
      : drag.ids.length > 1
        ? moveItems(doc, drag.ids, drag.dx, drag.dy)
        : moveItem(doc, drag.id, drag.dx, drag.dy);

  // 見える範囲は動かす前の図面から決める。動かすたびに画面が揺れないように
  const b = docBounds(doc);
  const pad = 40;
  const vb = { x: b.x0 - pad, y: b.y0 - pad, w: b.x1 - b.x0 + pad * 2, h: b.y1 - b.y0 + pad * 2 };

  /** 吸い付く範囲（図面の長さ）。画面で SNAP_PX ピクセルになるよう、拡大率に合わせる */
  const snapRange = () => {
    const m = svgRef.current?.getScreenCTM();
    const scale = m && m.a > 0 ? m.a : 1;
    return Math.max(3, Math.min(40, SNAP_PX / scale));
  };

  /** 画面の座標を図面の座標に直す */
  const toDrawing = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return {
      x: vb.x + ((e.clientX - r.left) / r.width) * vb.w,
      y: vb.y + ((e.clientY - r.top) / r.height) * vb.h,
    };
  };

  /** 薄く表示していて、触れないもの（レイヤーを選んでいるときの、元の図面） */
  const inert = (id: string) => locked && !activeIds?.has(id);

  const onPointerDown = (e: React.PointerEvent, it: DocItem) => {
    // ×印を付けるモード：記号をクリックすると、×印を付ける・外す（薄く表示している元の図面の記号も、押せる）
    if (mode === 'cross') {
      if (it.kind === 'symbol') {
        e.stopPropagation();
        onCrossClick?.(groupRootOf(doc, it.id));
      }
      return;
    }
    if (mode === 'wire' || inert(it.id)) return;
    e.stopPropagation();

    // PASのように中に部品を抱えている記号は、かたまりごと選ぶ。
    // すでにそのかたまりだけを選んでいるときだけ、もう一度押すと中の部品を選べる
    const root = groupRootOf(doc, it.id);
    const insideSelected = selectedId !== null && groupOf(doc, root).includes(selectedId);
    const pick = insideSelected ? it.id : root;

    // Shift・Ctrl・Command のどれかを押しながらクリック：選んでいなければ、選びに加える。すでに選んでいれば、選びから外す
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const has = selectedIds.includes(pick) || selectedIds.includes(root);
      onSelect(has ? selectedIds.filter((s) => s !== pick && s !== root) : [...selectedIds, pick]);
      return;
    }

    // 複数選んでいるうちの1つを押したときは、選びはそのまま、まとめて動かす（動かさずに離したら、その1つだけの選びにする）
    const keepMulti = selectedIds.length > 1 && (selectedIds.includes(pick) || selectedIds.includes(root));
    collapseTo.current = keepMulti ? (selectedIds.includes(pick) ? pick : root) : null;
    if (!keepMulti) onSelect([pick]);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = toDrawing(e);
    setDrag({ id: keepMulti ? (selectedIds.includes(pick) ? pick : root) : pick, ids: keepMulti ? selectedIds : [pick], dx: 0, dy: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // 範囲で選んでいる最中：少し動いたら、枠を出す
    const bd = bandRef.current;
    if (bd) {
      if (!bd.moved && Math.hypot(e.clientX - bd.cx, e.clientY - bd.cy) > 4) bd.moved = true;
      if (bd.moved) {
        const q = toDrawing(e);
        setBand({ x0: Math.min(bd.x, q.x), y0: Math.min(bd.y, q.y), x1: Math.max(bd.x, q.x), y1: Math.max(bd.y, q.y) });
      }
      return;
    }
    if (crossDrag && start.current) {
      const p = toDrawing(e);
      setCrossDrag({ id: crossDrag.id, dx: snap(p.x - start.current.x), dy: snap(p.y - start.current.y) });
      return;
    }
    if (mode === 'wire') {
      const p = toDrawing(e);
      if (wireStart) setCursor(p);
      // Alt（Mac は option）キーを押している間は、吸い付けない（わざとずらしたり、突き抜けたりしたいとき）
      setHint(e.altKey ? null : wireStart ? assistWireNew(doc, wireStart.x, wireStart.y, p.x, p.y, undefined, snapRange()) : assistPoint(doc, p.x, p.y, undefined, snapRange()));
    }
    if (resize && start.current) {
      const p = toDrawing(e);
      const item = doc.items.find((i) => i.id === resize.id);
      const info = item ? resizeInfoOf(item) : null;
      if (!info) return;
      const dx = p.x - start.current.x;
      const dy = p.y - start.current.y;
      const f = resize.from;
      let { x, y, w, h } = f;
      // つかんだ端だけが動く。反対側の端は動かさない。大きさは、変えられる範囲に収めて、刻みに合わせる
      if (resize.h && info.w2) {
        const r = info.w2;
        const raw = resize.h === 'r' ? f.w + dx : f.w - dx;
        w = Math.max(r.min, Math.min(r.max, Math.round(raw / r.step) * r.step));
        if (resize.h === 'l') x = f.x + f.w - w;
      }
      if (resize.v && info.h2) {
        const r = info.h2;
        const raw = resize.v === 'b' ? f.h + dy : f.h - dy;
        h = Math.max(r.min, Math.min(r.max, Math.round(raw / r.step) * r.step));
        if (resize.v === 't') y = f.y + f.h - h;
      }
      setResize({ ...resize, rect: { x, y, w, h } });
      return;
    }
    if (!drag || !start.current) return;
    const p = toDrawing(e);
    const rawDx = p.x - start.current.x;
    const rawDy = p.y - start.current.y;
    // 複数をまとめて動かすときは、格子に合わせるだけ（ほかの記号への吸い付きは、1つを動かすときだけ）
    if (!drag.end && drag.ids.length > 1) {
      setDrag({ ...drag, dx: snap(rawDx), dy: snap(rawDy), guideX: undefined, guideY: undefined });
      return;
    }
    const a = drag.end
      ? assistWireEnd(doc, drag.id, drag.end, rawDx, rawDy, snapRange())
      : assistMove(doc, drag.id, rawDx, rawDy, snapRange());
    setDrag({ id: drag.id, ids: drag.ids, end: drag.end, dx: a.dx, dy: a.dy, guideX: a.guideX, guideY: a.guideY });
  };

  const onPointerUp = () => {
    // 範囲で選び終わった：囲んだ範囲にまるごと入っている要素を選ぶ（追加のときは、いまの選びに加える）。動かしていなければ、選びを外す
    const bd = bandRef.current;
    if (bd) {
      bandRef.current = null;
      const rect = band;
      setBand(null);
      if (bd.moved && rect) {
        const found = itemsInRange(doc, rect).filter((id) => !inert(id));
        onSelect(bd.additive ? [...new Set([...bd.base, ...found])] : found);
      } else if (!bd.additive) {
        onSelect([]);
      }
      return;
    }
    if (crossDrag) {
      const { id, dx, dy } = crossDrag;
      setCrossDrag(null);
      start.current = null;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) onCrossMoveEnd?.(id, dx, dy);
      return;
    }
    if (resize) {
      const { from, rect, id } = resize;
      setResize(null);
      start.current = null;
      if (from.x !== rect.x || from.y !== rect.y || from.w !== rect.w || from.h !== rect.h) onResizeEnd?.(id, rect);
      return;
    }
    if (drag && (Math.abs(drag.dx) > 0.01 || Math.abs(drag.dy) > 0.01)) {
      if (drag.end) onWireEnd(drag.id, drag.end, drag.dx, drag.dy);
      else onMoveEnd(drag.ids, drag.dx, drag.dy);
    } else if (drag && collapseTo.current) {
      onSelect([collapseTo.current]);
    }
    collapseTo.current = null;
    setDrag(null);
    start.current = null;
  };

  /** 線を引くモードのとき、1回目のクリックで始点、2回目で線を確定する */
  const onCanvasDown = (e: React.PointerEvent) => {
    if (mode === 'cross') return;
    // レイヤーを選んでいて、置いたものが無いときは、触れるものが無いので、何もしない
    if (locked && !(activeIds && activeIds.size > 0)) return;
    if (mode !== 'wire') {
      // 指のときは、なぞれば画面が動くので、「選択を外す」のは、離したときに上の処理で行う。
      // マウス・ペンは、何も無いところからドラッグすると、範囲で選べる（離したとき、動かしていなければ、選びを外す）
      if (e.pointerType !== 'touch') {
        const q = toDrawing(e);
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        svgRef.current?.setPointerCapture?.(e.pointerId);
        bandRef.current = { x: q.x, y: q.y, cx: e.clientX, cy: e.clientY, additive, moved: false, base: additive ? selectedIds : [] };
      }
      return;
    }
    const p = toDrawing(e);
    const free = e.altKey;
    if (!wireStart) {
      // 始点も吸い付ける（接続点・線の端・線の上）
      const a = free ? { x: snap(p.x), y: snap(p.y) } : assistPoint(doc, p.x, p.y, undefined, snapRange());
      setWireStart({ x: a.x, y: a.y });
      setCursor(p);
      setHint(null);
    } else {
      onAddWire(wireStart.x, wireStart.y, p.x, p.y, { assist: !free, range: snapRange() });
      setWireStart(null);
      setCursor(null);
      setHint(null);
    }
  };

  const selectedWire = view.items.find((i) => i.id === selectedId && i.kind === 'wire');

  return (
    <svg
      ref={svgRef}
      className={`canvas${locked ? ' locked' : ''}${mode === 'cross' ? ' cross-mode' : ''}`}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      style={{ height: `${zoom * 100}%` }}
      onPointerDown={onCanvasDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // Mac の Control＋クリックは、ふつう、右クリックのメニューが出る。追加選択に使うので、出さない
      onContextMenu={(e) => {
        if (e.ctrlKey && mode === 'select') e.preventDefault();
      }}
      role="application"
      aria-label={tr('editor.canvasLabel')}
    >
      <g stroke="#000" fill="none" strokeLinecap="round" strokeLinejoin="round" color="#000">
        {view.items.map((it) => {
          const selected = selectedIds.includes(it.id);
          const common = {
            key: it.id,
            onPointerDown: (e: React.PointerEvent) => onPointerDown(e, it),
            className: `item${selected ? ' selected' : ''}${inert(it.id) ? ' inert' : ''}${mode === 'cross' && it.kind === 'symbol' && defOf(it).markCenter ? ' eligible' : ''}`,
          };

          if (it.kind === 'wire') {
            return (
              <g {...common}>
                <line x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} strokeWidth={1} strokeDasharray={it.dashed ? '5 4' : undefined} />
                <line x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} strokeWidth={8} stroke="transparent" />
              </g>
            );
          }

          if (it.kind === 'frame') {
            return (
              <g {...common}>
                <path
                  d={`M ${it.x} ${it.y} L ${it.x + it.w} ${it.y} M ${it.x} ${it.y} L ${it.x} ${it.y + 26} M ${it.x + it.w} ${it.y} L ${it.x + it.w} ${it.y + 26}`}
                  strokeWidth={1}
                />
                {/* 細い線でもつかめるように、見えない太い線を重ねる */}
                <path
                  d={`M ${it.x} ${it.y} L ${it.x + it.w} ${it.y} M ${it.x} ${it.y} L ${it.x} ${it.y + 26} M ${it.x + it.w} ${it.y} L ${it.x + it.w} ${it.y + 26}`}
                  strokeWidth={18}
                  stroke="transparent"
                />
                {it.label && (
                  <text x={it.x} y={it.y - 6} fontSize={LABEL_FONT} fontFamily={FONT_FAMILY} fill="currentColor" stroke="none">
                    {it.label}
                  </text>
                )}
              </g>
            );
          }

          if (it.kind === 'text') {
            // 大きさは、縦横の比を変えず、文字と行の間隔を同じ倍率で変える。赤い文字は、レイヤーに置いたもの
            const k = clampTextSize(it.size);
            return (
              <g {...common}>
                <text
                  x={it.x}
                  y={it.y}
                  fontSize={LABEL_FONT * k}
                  fontWeight={it.bold ? 700 : undefined}
                  textAnchor={it.anchor}
                  fontFamily={FONT_FAMILY}
                  fill={it.red ? OVERLAY_RED : 'currentColor'}
                  stroke="none"
                >
                  {it.lines.map((l, i) => (
                    <tspan key={i} x={it.x} dy={i === 0 ? 0 : LABEL_LINE * k}>
                      {l}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          }

          const def = defOf(it);
          const cx = def.box.w / 2;
          const cy = def.box.h / 2;
          return (
            <g {...common}>
              <g
                transform={`translate(${it.x} ${it.y})${it.rotate ? ` rotate(${it.rotate} ${cx} ${cy})` : ''}`}
                dangerouslySetInnerHTML={{ __html: shapesToSvg(def.shapes, '') }}
              />
              {it.label.length > 0 && (
                <text
                  x={it.x + it.labelDx}
                  y={it.y + it.labelDy}
                  fontSize={LABEL_FONT}
                  textAnchor={it.labelAnchor}
                  fontFamily={FONT_FAMILY}
                  fill="currentColor"
                  stroke="none"
                >
                  {it.label.map((l, i) => (
                    <tspan key={i} x={it.x + it.labelDx} dy={i === 0 ? 0 : LABEL_LINE}>
                      {l}
                    </tspan>
                  ))}
                </text>
              )}
              <rect x={it.x} y={it.y} width={def.box.w} height={def.box.h} fill="transparent" stroke="none" />
            </g>
          );
        })}

        {/* 開放の赤い×印。付けた開閉器について動くので、ドラッグでは動かさない（選ぶ・外すだけ） */}
        {crosses.map((c) => {
          const sel = selectedIds.includes(c.id);
          return (
            <g
              key={c.id}
              className={`cross-mark${sel ? ' selected' : ''}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (mode === 'cross') onCrossRemove?.(c.id);
                else if (mode === 'select') {
                  // 選んで、そのままドラッグすれば、付けた開閉器の中央からずらせる
                  onSelect([c.id]);
                  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                  start.current = toDrawing(e);
                  setCrossDrag({ id: c.id, dx: 0, dy: 0 });
                }
              }}
            >
              <polygon points={crossPointsAttr(c.x + (crossDrag?.id === c.id ? crossDrag.dx : 0), c.y + (crossDrag?.id === c.id ? crossDrag.dy : 0), c.size, c.thickness)} fill={OVERLAY_RED} stroke="none" />
              {sel && (
                <rect
                  className="selection"
                  x={c.x + (crossDrag?.id === c.id ? crossDrag.dx : 0) - c.size / 2 - 4}
                  y={c.y + (crossDrag?.id === c.id ? crossDrag.dy : 0) - c.size / 2 - 4}
                  width={c.size + 8}
                  height={c.size + 8}
                  fill="none"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* 動かしている最中、まっすぐ揃った位置に目安の線を出す */}
        {drag?.guideX !== undefined && (
          <line className="guide" x1={drag.guideX} y1={vb.y} x2={drag.guideX} y2={vb.y + vb.h} pointerEvents="none" />
        )}
        {drag?.guideY !== undefined && (
          <line className="guide" x1={vb.x} y1={drag.guideY} x2={vb.x + vb.w} y2={drag.guideY} pointerEvents="none" />
        )}

        {selectedWire && selectedWire.kind === 'wire' && selectedIds.length === 1 && mode === 'select' && (
          <>
            {([1, 2] as const).map((end) => (
              <circle
                key={end}
                className="handle"
                cx={end === 1 ? selectedWire.x1 : selectedWire.x2}
                cy={end === 1 ? selectedWire.y1 : selectedWire.y2}
                r={4}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  start.current = toDrawing(e);
                  setDrag({ id: selectedWire.id, ids: [selectedWire.id], end, dx: 0, dy: 0 });
                }}
              />
            ))}
          </>
        )}

        {mode === 'wire' && wireStart && cursor && (
          <line
            className="preview"
            x1={wireStart.x}
            y1={wireStart.y}
            x2={hint ? hint.x : Math.abs(cursor.x - wireStart.x) <= Math.abs(cursor.y - wireStart.y) ? wireStart.x : cursor.x}
            y2={hint ? hint.y : Math.abs(cursor.x - wireStart.x) <= Math.abs(cursor.y - wireStart.y) ? cursor.y : wireStart.y}
            strokeWidth={1}
            strokeDasharray={wireDashed ? '5 4' : undefined}
          />
        )}
        {/* 吸い付く先の目印（丸）。揃う位置のときは、目安の線 */}
        {mode === 'wire' && hint && (hint.kind === 'port' || hint.kind === 'end' || hint.kind === 'wire') && (
          <circle className="snap-mark" cx={hint.x} cy={hint.y} r={snapRange() * 0.6} pointerEvents="none" />
        )}
        {mode === 'wire' && hint?.guideX !== undefined && (
          <line className="guide" x1={hint.guideX} y1={vb.y} x2={hint.guideX} y2={vb.y + vb.h} pointerEvents="none" />
        )}
        {mode === 'wire' && hint?.guideY !== undefined && (
          <line className="guide" x1={vb.x} y1={hint.guideY} x2={vb.x + vb.w} y2={hint.guideY} pointerEvents="none" />
        )}

        {/* 直しきれなかったところに、赤い印を出す */}
        {issues.map((is, i) => (
          <g key={`issue-${i}`} className="issue-mark" pointerEvents="none">
            <circle cx={is.x} cy={is.y} r={11} />
            <line x1={is.x} y1={is.y - 5} x2={is.x} y2={is.y + 1} />
            <circle cx={is.x} cy={is.y + 4.5} r={0.9} className="dot" />
          </g>
        ))}

        {selectedIds.map((sid) => {
          // かたまりを選んでいるときは、中の部品まで含めて囲う
          const ids = groupOf(view, sid);
          const boxes = view.items.filter((i) => ids.includes(i.id)).map(itemBounds);
          if (boxes.length === 0) return null;
          const bb = {
            x0: Math.min(...boxes.map((b) => b.x0)),
            y0: Math.min(...boxes.map((b) => b.y0)),
            x1: Math.max(...boxes.map((b) => b.x1)),
            y1: Math.max(...boxes.map((b) => b.y1)),
          };
          return (
            <rect
              key={`sel-${sid}`}
              className="selection"
              x={bb.x0 - 4}
              y={bb.y0 - 4}
              width={bb.x1 - bb.x0 + 8}
              height={bb.y1 - bb.y0 + 8}
              fill="none"
              pointerEvents="none"
            />
          );
        })}

        {/* 枠の端・角をつかんで、大きさを変える（外箱・エリアの区分枠）。端＝その向きだけ、角＝横と縦を同時に */}
        {selectedId && mode === 'select' && (() => {
          const it = view.items.find((i) => i.id === selectedId);
          const info = it ? resizeInfoOf(it) : null;
          if (!it || !info) return null;
          const m = svgRef.current?.getScreenCTM();
          const scale = m && m.a > 0 ? m.a : 1;
          const px = (n: number) => n / scale;
          const { x, y, w, h } = info;
          const grip = px(9);
          const hit = px(12);
          const cursorOf = (hh: 'l' | 'r' | null, vv: 't' | 'b' | null) =>
            hh && vv ? (hh === vv.replace('t', 'l').replace('b', 'r') ? 'nwse-resize' : 'nesw-resize') : hh ? 'ew-resize' : 'ns-resize';
          const start0 = (e: React.PointerEvent, hh: 'l' | 'r' | null, vv: 't' | 'b' | null) => {
            e.stopPropagation();
            (e.target as Element).setPointerCapture?.(e.pointerId);
            start.current = toDrawing(e);
            setResize({ id: it.id, h: hh, v: vv, from: { x, y, w, h }, rect: { x, y, w, h } });
          };
          const canW = !!info.w2;
          const canH = !!info.h2;
          const edges: { key: string; hh: 'l' | 'r' | null; vv: 't' | 'b' | null; x1: number; y1: number; x2: number; y2: number }[] = [];
          if (canW) {
            edges.push({ key: 'l', hh: 'l', vv: null, x1: x, y1: y, x2: x, y2: y + h });
            edges.push({ key: 'r', hh: 'r', vv: null, x1: x + w, y1: y, x2: x + w, y2: y + h });
          }
          if (canH) {
            edges.push({ key: 't', hh: null, vv: 't', x1: x, y1: y, x2: x + w, y2: y });
            edges.push({ key: 'b', hh: null, vv: 'b', x1: x, y1: y + h, x2: x + w, y2: y + h });
          }
          const pts: { key: string; hh: 'l' | 'r' | null; vv: 't' | 'b' | null; cx: number; cy: number }[] = [];
          if (canW) {
            pts.push({ key: 'l', hh: 'l', vv: null, cx: x, cy: y + h / 2 });
            pts.push({ key: 'r', hh: 'r', vv: null, cx: x + w, cy: y + h / 2 });
          }
          if (canH) {
            pts.push({ key: 't', hh: null, vv: 't', cx: x + w / 2, cy: y });
            pts.push({ key: 'b', hh: null, vv: 'b', cx: x + w / 2, cy: y + h });
          }
          if (canW && canH) {
            for (const hh of ['l', 'r'] as const) for (const vv of ['t', 'b'] as const) pts.push({ key: hh + vv, hh, vv, cx: hh === 'l' ? x : x + w, cy: vv === 't' ? y : y + h });
          }
          return (
            <g className="resize-grips">
              {edges.map((ed) => (
                <line
                  key={`e-${ed.key}`}
                  className="grip-edge"
                  x1={ed.x1}
                  y1={ed.y1}
                  x2={ed.x2}
                  y2={ed.y2}
                  strokeWidth={hit}
                  style={{ cursor: cursorOf(ed.hh, ed.vv) }}
                  onPointerDown={(e) => start0(e, ed.hh, ed.vv)}
                />
              ))}
              {pts.map((pt) => (
                <rect
                  key={`g-${pt.key}`}
                  className="grip"
                  data-grip={pt.key}
                  x={pt.cx - grip / 2}
                  y={pt.cy - grip / 2}
                  width={grip}
                  height={grip}
                  strokeWidth={px(1.5)}
                  style={{ cursor: cursorOf(pt.hh, pt.vv) }}
                  onPointerDown={(e) => start0(e, pt.hh, pt.vv)}
                />
              ))}
            </g>
          );
        })()}

        {/* 範囲で選んでいる最中の枠 */}
        {band && <rect className="band" x={band.x0} y={band.y0} width={band.x1 - band.x0} height={band.y1 - band.y0} pointerEvents="none" />}
      </g>
    </svg>
  );
}
