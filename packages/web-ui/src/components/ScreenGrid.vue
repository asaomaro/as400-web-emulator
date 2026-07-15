<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import type { ScreenSnapshot, Cell, Field } from "@as400web/core";
import {
  initEdit,
  editValue,
  typeChar,
  backspace,
  del,
  moveCursor,
  home,
  end,
  toggleInsert,
  paste,
  type EditState
} from "../composables/fieldEdit.js";
import { acceptsChar } from "../composables/fieldValidate.js";
import { splitLinks, type LinkPart } from "../composables/linkify.js";
// codec サブパスからブラウザ安全に import（root は pino/node 依存を巻き込むため不可）
import { katakanaChar } from "@as400web/core/codec";

// linkify は既定 ON。Vue は未指定の Boolean prop を false にキャストするため withDefaults で true を明示する
const props = withDefaults(
  defineProps<{
    snapshot: ScreenSnapshot;
    edits: Map<number, string>;
    focused: boolean;
    /** SO を { ・SI を } で表示する（ACS の Ctrl+F 相当。既定は空白） */
    showShiftMarks?: boolean;
    /** SBCS を半角カナ解釈で表示する（ACS の表示コード切替。英小文字位置がカナ化） */
    katakanaView?: boolean;
    /** 画面テキストの URL/メールをリンク化する（既定 ON。カタカナ表示中は無効） */
    linkify?: boolean;
  }>(),
  { linkify: true }
);
const emit = defineEmits<{
  (e: "edit", fieldIndex: number, value: string): void;
  (e: "cursor", row: number, col: number): void;
  (e: "gui-select", fieldId: number, choiceIndex: number, selected: boolean): void;
  (e: "gui-submit", fieldId: number): void;
}>();

const gui = computed(() => props.snapshot.gui);

interface GuiChoiceLike {
  index: number;
  text: string;
  selected: boolean;
  available: boolean;
}
interface GuiSelectionLike {
  id: number;
  kind: "radio" | "checkbox" | "pushbutton" | "menu";
  multiple: boolean;
  choices: GuiChoiceLike[];
}

/** 選択肢クリック: ボタン/メニューは選択＋即送信、ラジオは選択、チェックはトグル */
function onChoiceClick(field: GuiSelectionLike, choice: GuiChoiceLike): void {
  if (!choice.available || props.snapshot.keyboardLocked) return;
  if (field.kind === "pushbutton" || field.kind === "menu") {
    emit("gui-select", field.id, choice.index, true);
    emit("gui-submit", field.id);
  } else if (field.kind === "checkbox") {
    emit("gui-select", field.id, choice.index, !choice.selected);
  } else {
    emit("gui-select", field.id, choice.index, true);
  }
}

/** GUI 要素の px 位置（cursor オーバーレイと同じ ch/em 基準） */
function guiPos(row: number, col: number): Record<string, string> {
  return { left: col - 1 + "ch", top: (row - 1) * 1.25 + "em" };
}

/** スクロールバーつまみ位置（総数に対する割合） */
function thumbStyle(bar: { horizontal: boolean; total: number; sliderPos: number }): Record<string, string> {
  const pct = (bar.total ? (bar.sliderPos / bar.total) * 100 : 0) + "%";
  return bar.horizontal ? { left: pct } : { top: pct };
}

/** ウィンドウ枠の位置＋寸法スタイル */
function windowStyle(w: { row: number; col: number; width: number; height: number }): Record<string, string> {
  return { ...guiPos(w.row, w.col), width: w.width + "ch", height: w.height * 1.25 + "em" };
}

const selectionFields = computed<GuiSelectionLike[]>(
  () => (gui.value?.selectionFields ?? []) as GuiSelectionLike[]
);

interface Segment {
  kind: "text" | "input" | "dbcs";
  text: string;
  cls: string;
  field?: Field;
  /** input の表示桁数（行残りにクランプ済み） */
  width?: number;
}

/** セルの表示文字（SO/SI マーク表示・カタカナ再解釈・dbcs-tail 空白埋め） */
function displayChar(c: Cell): string {
  if (props.showShiftMarks && c.kind === "so") return "{";
  if (props.showShiftMarks && c.kind === "si") return "}";
  // カタカナ表示: SBCS の生バイトを半角カナで再解釈
  if (props.katakanaView && c.kind === "sbcs" && c.rawByte !== undefined) {
    return katakanaChar(c.rawByte);
  }
  return c.char === "" ? " " : c.char;
}

// リンク化: 既定 ON（withDefaults）。カタカナ表示中は文字が別解釈になるため無効化（誤検出・桁崩れ防止）
const linkEnabled = computed(() => props.linkify && !props.katakanaView);

/** text セグメントをプレーン/リンク部分に分割（リンク無効時は単一のプレーン部分） */
function linkParts(text: string): LinkPart[] {
  return linkEnabled.value ? splitLinks(text) : [{ text }];
}

/** cell の属性を CSS class 文字列にする */
function cellClass(c: Cell): string {
  const cls = [`c-${c.color}`];
  if (c.underline) cls.push("a-underline");
  if (c.reverse) cls.push("a-reverse");
  if (c.blink) cls.push("a-blink");
  return cls.join(" ");
}

/** 各行を text/input セグメントに分解する（v-memo 用に行データの参照同一性を保つのは Vue の再評価に委ねる） */
const rows = computed<Segment[][]>(() => {
  const snap = props.snapshot;
  // col(0-based) → field（その行で入力フィールドが占める桁）
  const fieldAt = new Map<number, Field>();
  for (const f of snap.fields) {
    if (f.row < 1 || f.row > snap.rows) continue;
    for (let i = 0; i < f.length; i++) {
      const col = f.col - 1 + i;
      if (Math.floor(col / snap.cols) === 0 && f.row - 1 + Math.floor((f.col - 1 + i) / snap.cols) === f.row - 1) {
        // 単一行に収まる範囲のみ（複数行フィールドの折返しは 04 で精緻化）
        if (col < snap.cols) fieldAt.set((f.row - 1) * snap.cols + col, f);
      }
    }
  }
  const out: Segment[][] = [];
  for (let r = 0; r < snap.rows; r++) {
    const segs: Segment[] = [];
    const row = snap.cells[r];
    if (!row) {
      out.push(segs);
      continue;
    }
    let c = 0;
    while (c < snap.cols) {
      const addr = r * snap.cols + c;
      const field = fieldAt.get(addr);
      if (field && field.col - 1 === c) {
        // 表示幅はその行の残り桁にクランプ（幅広フィールドのグリッドはみ出し防止）
        const visibleLen = Math.min(field.length, snap.cols - c);
        segs.push({ kind: "input", text: "", cls: cellClass(row[c]!), field, width: visibleLen });
        c += visibleLen;
        continue;
      }
      // DBCS lead セルは 2ch 幅の専用セグメント（tail は char="" なので実質畳まれる）
      if (row[c]!.kind === "dbcs-lead") {
        segs.push({ kind: "dbcs", text: row[c]!.char, cls: cellClass(row[c]!) });
        c += 2; // lead + tail の 2 桁
        continue;
      }
      // text ラン（同一 class をまとめる）。DBCS/SO/SI 桁はまたがない
      const cls = cellClass(row[c]!);
      let text = "";
      while (
        c < snap.cols &&
        !fieldAt.has(r * snap.cols + c) &&
        row[c]!.kind !== "dbcs-lead" &&
        cellClass(row[c]!) === cls
      ) {
        text += displayChar(row[c]!);
        c++;
      }
      segs.push({ kind: "text", text, cls });
    }
    out.push(segs);
  }
  return out;
});

function inputValue(f: Field): string {
  return props.edits.get(f.index) ?? f.value;
}

// ---- フィールド編集（native input 制御方式: keydown を制御して 5250 上書きモード等を実現） ----
const composing = ref(false);
const insertMode = defineModel<boolean>("insertMode", { default: false });
let edit: EditState | undefined;
let editFieldIndex = -1;

function beginEdit(f: Field, inputEl: HTMLInputElement): void {
  edit = initEdit(inputValue(f), f.length, inputEl.selectionStart ?? 0);
  edit.insertMode = insertMode.value;
  editFieldIndex = f.index;
}

function sync(inputEl: HTMLInputElement, f: Field): void {
  if (!edit) return;
  inputEl.value = editValue(edit);
  const c = Math.min(edit.cursor, f.length);
  inputEl.setSelectionRange(c, c);
  insertMode.value = edit.insertMode;
  emit("edit", f.index, editValue(edit).replace(/ +$/, ""));
}

/** input の keydown 制御。印字文字は上書き/挿入、編集キーは 5250 挙動、AID/移動キーはペインへ委譲 */
function onInputKeydown(f: Field, ev: KeyboardEvent): void {
  if (f.protected) {
    // 非入力キー（F キー等）はペインの keymap に委譲するため preventDefault しない
    if (ev.key.length === 1) ev.preventDefault();
    return;
  }
  if (composing.value) return; // IME 変換中は自前制御しない
  const el = ev.target as HTMLInputElement;
  if (!edit || editFieldIndex !== f.index) beginEdit(f, el);
  edit = edit!;

  if (ev.key === "Insert") {
    ev.preventDefault();
    edit = toggleInsert(edit);
    insertMode.value = edit.insertMode;
    return;
  }
  if (ev.key === "Backspace") {
    ev.preventDefault();
    edit = backspace(edit);
    sync(el, f);
    return;
  }
  if (ev.key === "Delete") {
    ev.preventDefault();
    edit = del(edit);
    sync(el, f);
    return;
  }
  if (ev.key === "Home") {
    ev.preventDefault();
    edit = home(edit);
    sync(el, f);
    return;
  }
  if (ev.key === "End") {
    ev.preventDefault();
    edit = end(edit);
    sync(el, f);
    return;
  }
  if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
    ev.preventDefault();
    edit = moveCursor(edit, ev.key === "ArrowLeft" ? -1 : 1);
    sync(el, f);
    return;
  }
  // 印字可能な 1 文字（修飾なし）: 型・コードページ検証してから上書き/挿入
  if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    ev.preventDefault();
    if (!acceptsChar(f, ev.key)) return; // 型違反は拒否
    edit = typeChar(edit, ev.key);
    sync(el, f);
    return;
  }
  // その他（Enter/F キー/PageUp/Down/Tab）はペインの keymap に委譲（preventDefault しない）
}

function onInputFocus(f: Field, ev: FocusEvent): void {
  beginEdit(f, ev.target as HTMLInputElement);
  emit("cursor", f.row, f.col);
}

/** paste（複数文字）: 上書き/挿入で順に入力し、型・長さで整形 */
function onInputBeforeInput(f: Field, ev: InputEvent): void {
  if (f.protected) {
    ev.preventDefault();
    return;
  }
  if (ev.inputType === "insertFromPaste" && ev.data) {
    ev.preventDefault();
    const el = ev.target as HTMLInputElement;
    if (!edit || editFieldIndex !== f.index) beginEdit(f, el);
    const filtered = [...ev.data].filter((ch) => acceptsChar(f, ch)).join("");
    edit = paste(edit!, filtered);
    sync(el, f);
  }
}

function onCompositionEnd(f: Field, ev: CompositionEvent): void {
  composing.value = false;
  const el = ev.target as HTMLInputElement;
  // IME 確定後は native input の現在値を field 値の真とみなして取り込む
  // （長さクランプ・型フィルタ・カーソルは selectionStart。旧値からの再打ち込みはしない）
  const filtered = [...el.value.slice(0, f.length)].filter((ch) => acceptsChar(f, ch)).join("");
  const caret = Math.min(el.selectionStart ?? filtered.length, f.length);
  edit = initEdit(filtered, f.length, caret);
  editFieldIndex = f.index;
  sync(el, f);
}

// ---- クリックでカーソル位置を算出（出力セルクリック。入力欄は @focus で emit） ----
function onGridClick(ev: MouseEvent): void {
  const el = gridEl.value;
  if (!el || (ev.target as HTMLElement).tagName === "INPUT") return;
  const rect = el.getBoundingClientRect();
  const chW = fontPx.value * 0.6;
  const lineH = fontPx.value * 1.25;
  const col = Math.floor((ev.clientX - rect.left - 10) / chW) + 1;
  const row = Math.floor((ev.clientY - rect.top - 8) / lineH) + 1;
  if (row >= 1 && row <= props.snapshot.rows && col >= 1 && col <= props.snapshot.cols) {
    emit("cursor", row, col);
  }
}

// ---- フォント自動フィット（ResizeObserver。paneWidth/cols で ch を算出） ----
const gridEl = ref<HTMLElement>();
const fontPx = ref(14);
let ro: ResizeObserver | undefined;

function fit(): void {
  const el = gridEl.value;
  if (!el) return;
  const w = el.clientWidth;
  // 等幅で cols 桁が収まる字幅 ≈ w/cols。char 幅は約 0.6em なので font ≈ (w/cols)/0.6
  const px = Math.max(6, Math.min(22, (w / props.snapshot.cols) / 0.6));
  fontPx.value = px;
}

onMounted(() => {
  if (typeof ResizeObserver !== "undefined" && gridEl.value) {
    ro = new ResizeObserver(() => fit());
    ro.observe(gridEl.value);
  }
  fit();
});
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div
    ref="gridEl"
    class="grid"
    :style="{ fontSize: fontPx + 'px' }"
    :data-focused="focused"
    @click="onGridClick"
  >
    <div
      class="cursor"
      :class="{ live: focused }"
      :style="{ left: (snapshot.cursor.col - 1) + 'ch', top: (snapshot.cursor.row - 1) * 1.25 + 'em' }"
      aria-hidden="true"
    ></div>
    <!-- 拡張 5250 GUI オーバーレイ（ウィンドウ枠・選択フィールド・スクロールバー） -->
    <template v-if="gui">
      <div
        v-for="w in gui.windows"
        :key="'w' + w.id"
        class="gui-window"
        :style="windowStyle(w)"
        aria-hidden="true"
      >
        <span v-if="w.title" class="gui-window-title">{{ w.title }}</span>
      </div>
      <div
        v-for="b in gui.scrollBars"
        :key="'b' + b.id"
        class="gui-scrollbar"
        :class="b.horizontal ? 'horizontal' : 'vertical'"
        :style="guiPos(b.row, b.col)"
        :title="`${b.horizontal ? 'horizontal' : 'vertical'} ${b.sliderPos}/${b.total}`"
        aria-hidden="true"
      >
        <div class="gui-thumb" :style="thumbStyle(b)"></div>
      </div>
      <div
        v-for="f in selectionFields"
        :key="'s' + f.id"
        class="gui-selection"
        :class="f.kind"
        :style="guiPos(f.row, f.col)"
        role="group"
      >
        <button
          v-for="c in f.choices"
          :key="c.index"
          type="button"
          class="gui-choice"
          :class="{ selected: c.selected, unavailable: !c.available }"
          :disabled="!c.available || snapshot.keyboardLocked"
          @click="onChoiceClick(f, c)"
        >
          <span v-if="f.kind === 'radio'" class="gui-marker">{{ c.selected ? "◉" : "○" }}</span>
          <span v-else-if="f.kind === 'checkbox'" class="gui-marker">{{ c.selected ? "☑" : "☐" }}</span>
          <span class="gui-choice-text">{{ c.text }}</span>
        </button>
      </div>
    </template>
    <div v-for="(segs, r) in rows" :key="r" class="grid-row" v-memo="[segs, linkEnabled]">
      <template v-for="(seg, i) in segs" :key="i">
        <input
          v-if="seg.kind === 'input'"
          class="grid-input"
          :class="seg.cls"
          :style="{ width: (seg.width ?? seg.field!.length) + 'ch' }"
          :value="inputValue(seg.field!)"
          :readonly="seg.field!.protected"
          :type="seg.field!.hidden ? 'password' : 'text'"
          :maxlength="seg.field!.length"
          @keydown="onInputKeydown(seg.field!, $event)"
          @beforeinput="onInputBeforeInput(seg.field!, $event as InputEvent)"
          @focus="onInputFocus(seg.field!, $event)"
          @compositionstart="composing = true"
          @compositionend="onCompositionEnd(seg.field!, $event as CompositionEvent)"
        />
        <span v-else-if="seg.kind === 'dbcs'" class="grid-span grid-dbcs" :class="seg.cls">{{ seg.text }}</span>
        <span v-else class="grid-span" :class="seg.cls"><template
          v-for="(p, j) in linkParts(seg.text)"
          :key="j"
        ><a
            v-if="p.href"
            class="grid-link"
            :href="p.href"
            target="_blank"
            rel="noopener noreferrer"
            @click.stop
          >{{ p.text }}</a><template v-else>{{ p.text }}</template></template></span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.grid {
  position: relative;
  font-family: var(--mono);
  line-height: 1.25;
  background: var(--crt);
  padding: 8px 10px;
  white-space: pre;
  overflow: auto;
  min-height: 0;
  flex: 1;
}
/* ホストのカーソル位置を示すブロックカーソル（padding 分オフセット） */
.cursor {
  position: absolute;
  margin: 8px 0 0 10px;
  width: 1ch;
  height: 1.25em;
  background: color-mix(in srgb, var(--t-green) 45%, transparent);
  pointer-events: none;
}
.cursor.live {
  animation: cursorBlink 1.1s steps(1) infinite;
}
@keyframes cursorBlink {
  50% { opacity: 0.2; }
}
@media (prefers-reduced-motion: reduce) {
  .cursor.live { animation: none; }
}
.grid-row {
  height: 1.25em;
  white-space: pre;
}
.grid-span {
  text-shadow: var(--t-glow) currentColor;
}
/* 画面テキスト内のリンク（桁幅は変えずインライン。色は turquoise 系＋下線） */
.grid-link {
  color: var(--t-turquoise, var(--t-white));
  text-decoration: underline;
  cursor: pointer;
}
.grid-link:hover {
  color: var(--t-white);
}
/* DBCS（全角）は 2ch 幅を占有し中央寄せ（全角=半角×2 の桁対応を担保） */
.grid-dbcs {
  display: inline-block;
  width: 2ch;
  text-align: center;
  overflow: hidden;
}
.grid-input {
  font: inherit;
  height: 1.25em;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  color: var(--t-white);
  border-bottom: 1px solid color-mix(in srgb, var(--t-green) 55%, transparent);
  vertical-align: baseline;
  caret-color: var(--t-green);
}
.grid-input:focus {
  outline: none;
  background: color-mix(in srgb, var(--t-green) 12%, transparent);
}

/* ==== 拡張 5250 GUI オーバーレイ ==== */
.gui-window {
  position: absolute;
  margin: 8px 0 0 10px;
  border: 1px solid color-mix(in srgb, var(--t-turquoise, var(--t-green)) 70%, transparent);
  box-shadow: 0 0 6px color-mix(in srgb, var(--t-green) 30%, transparent);
  pointer-events: none;
  box-sizing: border-box;
}
.gui-window-title {
  position: absolute;
  top: -0.7em;
  left: 0.5ch;
  padding: 0 0.4ch;
  font-size: 0.85em;
  background: var(--crt);
  color: var(--t-turquoise, var(--t-white));
  white-space: nowrap;
}
.gui-selection {
  position: absolute;
  margin: 8px 0 0 10px;
  display: flex;
  gap: 2px;
  z-index: 2;
}
.gui-selection.radio,
.gui-selection.checkbox {
  flex-direction: column;
  align-items: flex-start;
}
.gui-selection.pushbutton,
.gui-selection.menu {
  flex-direction: row;
}
.gui-choice {
  font: inherit;
  color: var(--t-white);
  background: color-mix(in srgb, var(--t-green) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--t-green) 45%, transparent);
  padding: 0 0.4ch;
  line-height: 1.2em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4ch;
}
.gui-selection.radio .gui-choice,
.gui-selection.checkbox .gui-choice {
  border: none;
  background: transparent;
}
.gui-choice:hover:not(:disabled) {
  background: color-mix(in srgb, var(--t-green) 22%, transparent);
}
.gui-choice.selected {
  color: var(--t-green);
  border-color: var(--t-green);
}
.gui-choice.unavailable,
.gui-choice:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.gui-marker {
  font-size: 0.9em;
}
.gui-scrollbar {
  position: absolute;
  margin: 8px 0 0 10px;
  background: color-mix(in srgb, var(--t-green) 12%, transparent);
  pointer-events: none;
}
.gui-scrollbar.vertical {
  width: 1ch;
  height: 8.75em; /* 7 行相当の目安 */
}
.gui-scrollbar.horizontal {
  height: 1.25em;
  width: 20ch;
}
.gui-thumb {
  position: absolute;
  background: color-mix(in srgb, var(--t-green) 55%, transparent);
}
.gui-scrollbar.vertical .gui-thumb {
  left: 0;
  width: 100%;
  height: 1.5em;
}
.gui-scrollbar.horizontal .gui-thumb {
  top: 0;
  height: 100%;
  width: 2ch;
}
</style>
