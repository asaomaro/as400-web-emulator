import { describe, it, expect } from "vitest";
import { detectWindowRect } from "../src/composables/fkeyLegend.js";
import type { Cell, ScreenSnapshot, WriteExtent } from "@as400web/core";

/**
 * **罫線・反転からの推測をやめ、受信データの書き込み範囲で窓かどうかを決める。**
 *
 * 2026-07-28 の実測で、推測は 2 経路とも誤検出することが確認されている:
 *
 * | 画面 | 従来の判定 | 誤る経路 |
 * |---|---|---|
 * | ① 本物の窓（F1 ヘルプ相当。上下 `.`・左右 `:`） | 検出（正） | — |
 * | ② 一覧画面（`---` 区切り 2 本） | null（正） | — |
 * | ③ 表（左右に `:` が並ぶ帳票） | **誤検出** | 罫線 |
 * | ④ 反転バナー（見出し行＋末尾行が反転） | **誤検出** | 反転 |
 *
 * 「枠の外に何も無ければ窓」は**逆効果**なので採らない（実測で否定済み。本物の窓ほど外側に
 * 内容があり ① は 130 セル、誤検出の ④ はむしろ 0）。
 *
 * 代わりに受信データを見る。判定の第一級条件が CLEAR の有無なのは、実機採取レコードの再生で
 * **通常の全画面遷移 6/6 すべてに CLEAR が付いていた**ため（`packages/core/test/write-extent.test.ts`）。
 */

const ROWS = 24;
const COLS = 80;

function cell(char = " ", reverse = false): Cell {
  return {
    char,
    kind: "sbcs",
    color: reverse ? "white" : "green",
    reverse,
    underline: false,
    blink: false,
    columnSeparator: false,
    nonDisplay: false
  } as Cell;
}

/** `行 → 文字列` と `行 → 反転区間` からスナップショットを作る（どちらも 1 始まり） */
function snapOf(
  opts: {
    text?: Record<number, string>;
    reverse?: Record<number, [number, number][]>;
    lastWrite?: WriteExtent;
  } = {}
): ScreenSnapshot {
  const cells: Cell[][] = [];
  for (let r = 1; r <= ROWS; r++) {
    const line = opts.text?.[r] ?? "";
    const spans = opts.reverse?.[r] ?? [];
    const row: Cell[] = [];
    for (let c = 1; c <= COLS; c++) {
      row.push(cell(line[c - 1] ?? " ", spans.some(([a, b]) => c >= a && c <= b)));
    }
    cells.push(row);
  }
  const snap = {
    sessionId: "s",
    rows: ROWS,
    cols: COLS,
    cursor: { row: 1, col: 1 },
    keyboardLocked: false,
    cells,
    fields: []
  } as unknown as ScreenSnapshot;
  if (opts.lastWrite) snap.lastWrite = opts.lastWrite;
  return snap;
}

const pad = (col: number, s: string) => " ".repeat(col - 1) + s;

/** ① 本物の窓: 上下 `.`・左右 `:`（F1 ヘルプ相当） */
const WINDOW_TEXT: Record<number, string> = {
  1: "MAIN MENU  background text that stays behind the window",
  5: pad(20, ".".repeat(40)),
  6: pad(20, ":") + pad(19, ":"),
  7: pad(20, ":") + pad(19, ":"),
  8: pad(20, ":") + pad(19, ":"),
  9: pad(20, ".".repeat(40)),
  20: "background text below the window"
};
/** 窓を描くレコードは背景を消さずに窓の領域だけ書く */
const WINDOW_WRITE: WriteExtent = {
  rect: { row1: 5, row2: 9, col1: 20, col2: 59 },
  cleared: false,
  restored: false,
  cells: 200
};

/** ② 一覧画面（PDM 風。`---` 区切りが 2 本あるだけで縦罫が無い）。従来から正しく null */
const LIST_TEXT: Record<number, string> = {
  2: "  ライブラリー内のオブジェクトの処理",
  4: pad(3, "-".repeat(74)),
  5: "  OPT  オブジェクト   タイプ    属性     テキスト",
  6: pad(3, "-".repeat(74)),
  7: "       QGPL          *LIB      PROD",
  8: "       QTEMP         *LIB      PROD"
};

/** ③ 表（左右に `:` が並ぶ帳票）。罫線経路が誤検出していた形 */
const TABLE_TEXT: Record<number, string> = {
  3: pad(5, "-".repeat(70)),
  4: pad(5, ":") + pad(69, ":"),
  5: pad(5, ":") + pad(69, ":"),
  6: pad(5, ":") + pad(69, ":"),
  7: pad(5, ":") + pad(69, ":"),
  8: pad(5, "-".repeat(70))
};

/** ④ 反転バナー（見出し行＋末尾行が反転）。反転経路が誤検出していた形 */
const BANNER_REVERSE: Record<number, [number, number][]> = {
  18: [[24, 78]],
  19: [[24, 24], [78, 78]],
  20: [[24, 24], [78, 78]],
  21: [[24, 24], [78, 78]],
  22: [[24, 24], [78, 78]],
  23: [[24, 78]]
};

/** 通常画面のレコード: CLEAR してから画面全体を書く */
const FULL_SCREEN_WRITE: WriteExtent = {
  rect: { row1: 1, row2: 24, col1: 1, col2: 80 },
  cleared: true,
  restored: false,
  cells: 1920
};

describe("書き込み範囲によるウィンドウ判定", () => {
  describe("誤検出を弾く", () => {
    it("② 一覧画面は改修の前後どちらでも窓と判定しない", () => {
      // 縦罫が無いので従来の罫線経路でも落ちる。門を足しても結果が変わらないことの担保
      expect(detectWindowRect(snapOf({ text: LIST_TEXT }))).toBeNull();
      expect(detectWindowRect(snapOf({ text: LIST_TEXT, lastWrite: FULL_SCREEN_WRITE }))).toBeNull();
    });

    it("③ 帳票は罫線が揃っていても窓と判定しない", () => {
      // 門が無ければ罫線経路が拾ってしまう形
      expect(detectWindowRect(snapOf({ text: TABLE_TEXT }))).not.toBeNull();
      expect(
        detectWindowRect(snapOf({ text: TABLE_TEXT, lastWrite: FULL_SCREEN_WRITE }))
      ).toBeNull();
    });

    it("④ 反転バナーは閉じた矩形でも窓と判定しない", () => {
      expect(detectWindowRect(snapOf({ reverse: BANNER_REVERSE }))).not.toBeNull();
      expect(
        detectWindowRect(snapOf({ reverse: BANNER_REVERSE, lastWrite: FULL_SCREEN_WRITE }))
      ).toBeNull();
    });

    it("RESTORE SCREEN（窓を閉じた直後）は窓と判定しない", () => {
      const restored: WriteExtent = {
        rect: { row1: 1, row2: 24, col1: 1, col2: 80 },
        cleared: false,
        restored: true,
        cells: 1920
      };
      expect(detectWindowRect(snapOf({ text: TABLE_TEXT, lastWrite: restored }))).toBeNull();
    });

    it("メッセージ行だけの書き換えは窓と判定しない（小さすぎる更新）", () => {
      const msgLine: WriteExtent = {
        rect: { row1: 24, row2: 24, col1: 1, col2: 60 },
        cleared: false,
        restored: false,
        cells: 60
      };
      expect(detectWindowRect(snapOf({ text: TABLE_TEXT, lastWrite: msgLine }))).toBeNull();
    });

    it("細すぎる書き込みは窓と判定しない", () => {
      const narrow: WriteExtent = {
        rect: { row1: 5, row2: 9, col1: 20, col2: 24 },
        cleared: false,
        restored: false,
        cells: 25
      };
      expect(detectWindowRect(snapOf({ text: WINDOW_TEXT, lastWrite: narrow }))).toBeNull();
    });

    it("1 セルも書いていないレコードでは窓と判定しない", () => {
      const nothing: WriteExtent = { cleared: false, restored: false, cells: 0 };
      expect(detectWindowRect(snapOf({ text: WINDOW_TEXT, lastWrite: nothing }))).toBeNull();
    });

    it("CLEAR 付きで画面の一部しか書かなくても窓と判定しない（実測 96% の遷移）", () => {
      const partialAfterClear: WriteExtent = {
        rect: { row1: 1, row2: 23, col1: 1, col2: 80 },
        cleared: true,
        restored: false,
        cells: 1840
      };
      expect(
        detectWindowRect(snapOf({ text: WINDOW_TEXT, lastWrite: partialAfterClear }))
      ).toBeNull();
    });
  });

  describe("本物の窓は通す", () => {
    it("① CLEAR なしの部分書き込みなら従来どおり枠を返す", () => {
      const without = detectWindowRect(snapOf({ text: WINDOW_TEXT }));
      const withExtent = detectWindowRect(snapOf({ text: WINDOW_TEXT, lastWrite: WINDOW_WRITE }));

      expect(without).not.toBeNull();
      // 門は通すだけで、枠の位置は従来の罫線検出がそのまま決める（降格の実体）
      expect(withExtent).toEqual(without);
    });
  });

  describe("記録が無い snapshot（既存テスト資産との互換）", () => {
    it("lastWrite が無ければ従来と同じ結果になる", () => {
      // 既存 4 本（window-view / stacked-window / reverse-frame-window / pane-cursor-window）は
      // 手組み snapshot・描画済み fixture で lastWrite を持たない。**不在時は 1 行も変えない**
      expect(detectWindowRect(snapOf({ text: WINDOW_TEXT }))).not.toBeNull();
      expect(detectWindowRect(snapOf({ text: TABLE_TEXT }))).not.toBeNull();
      expect(detectWindowRect(snapOf({ reverse: BANNER_REVERSE }))).not.toBeNull();
      expect(detectWindowRect(snapOf({}))).toBeNull();
    });
  });

  describe("ホストの宣言（gui.windows）が最優先", () => {
    it("CLEAR 付きでも gui.windows があればそちらを返す", () => {
      const snap = snapOf({ text: TABLE_TEXT, lastWrite: FULL_SCREEN_WRITE });
      snap.gui = {
        selectionFields: [],
        windows: [{ id: 1, row: 8, col: 24, width: 30, height: 8 } as never],
        scrollBars: [],
        gridLines: []
      };
      expect(detectWindowRect(snap)).toEqual({ row1: 9, row2: 16, col1: 27, col2: 56 });
    });
  });
});
