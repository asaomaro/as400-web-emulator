import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ScreenGrid from "../src/components/ScreenGrid.vue";
import { MSG_OPT_HINTS } from "../src/composables/opMessages.js";
import type { Cell, Field, ScreenSnapshot } from "@as400web/core";

/**
 * **オプション欄の選択肢（UI）。**
 *
 * 利用者指示（2026-07-29）: **矩形選択とコピー＆ペーストに影響を与えないこと。**
 * 実装は次の 3 点でそれを担保しており、ここで固定する:
 *
 * 1. ポップオーバーの `mousedown` を `.stop` でグリッドへ伝播させない
 *    （伝播すると `onGridMousedown` → `clearRectSel()` が走り**矩形選択が消える**）
 * 2. `mousedown` を `.prevent` して既定のフォーカス移動を止める
 *    （**入力欄にフォーカスを残す**。奪うと貼り付け先が変わる）
 * 3. **キーイベントを 1 つも購読しない**（矢印・Tab・Enter・Esc は今日と同じ経路）
 *
 * 開閉はフォーカスにのみ従属するので、矩形選択が始まって入力欄が blur された時点で自然に閉じる。
 */

const SID = "opt1";

function cell(ch: string, kind: Cell["kind"] = "sbcs"): Cell {
  return { char: ch, kind, color: "green", reverse: false, underline: false, blink: false, columnSeparator: false, nonDisplay: false };
}
function toCells(line: string, cols = 80): Cell[] {
  const out: Cell[] = [];
  for (const ch of line) {
    if (/[⺀-꓏가-힣豈-﫿＀-｠]/.test(ch)) { out.push(cell(ch, "dbcs-lead")); out.push(cell(" ", "dbcs-tail")); }
    else out.push(cell(ch));
  }
  while (out.length < cols) out.push(cell(" "));
  return out.slice(0, cols);
}

/** PDM 風の一覧: 凡例 2 行＋ c2/len2 の Opt 欄が 4 行 */
const LINES: string[] = (() => {
  const l = Array(24).fill("");
  l[0] = "  オブジェクトの処理";
  l[5] = "  オプションを入力して，実行キーを押してください。";
  l[6] = "   2=変更      3=コピー      4=削除      5=表示";
  l[7] = "   8=記述の表示              9=保管";
  l[9] = " OPT  オブジェクト   タイプ";
  for (let r = 10; r <= 13; r++) l[r] = "      OBJ" + (r - 9) + "        *PGM";
  l[21] = " F3=終了   F4=プロンプト";
  return l;
})();

const OPT_FIELDS: Field[] = [10, 11, 12, 13].map((row, i) => ({
  index: i, row, col: 2, length: 2,
  protected: false, numeric: false, hidden: false, mdt: false, value: "  "
}));

function snapOf(fields: Field[] = OPT_FIELDS): ScreenSnapshot {
  const cells: Cell[][] = [];
  for (let r = 0; r < 24; r++) cells.push(toCells(LINES[r] ?? "", 80));
  return {
    sessionId: SID, rows: 24, cols: 80, cursor: { row: 1, col: 1 },
    keyboardLocked: false, cells, fields
  } as ScreenSnapshot;
}

function mountGrid(optHints: boolean) {
  return mount(ScreenGrid, {
    props: { snapshot: snapOf(), edits: new Map(), focused: true, optHints },
    attachTo: document.body
  });
}

const firstOptInput = (w: ReturnType<typeof mountGrid>) =>
  w.find('input.grid-input[data-field-index="0"]');

describe("オプション欄の選択肢（UI）", () => {
  it("既定（設定 OFF）では欄にフォーカスしても何も出ない", async () => {
    const w = mountGrid(false);
    await firstOptInput(w).trigger("focus");
    await nextTick();
    expect(w.find(".opt-hints").exists()).toBe(false);
    w.unmount();
  });

  it("設定 ON かつ Opt 欄にフォーカスすると選択肢が出る", async () => {
    const w = mountGrid(true);
    await firstOptInput(w).trigger("focus");
    await nextTick();
    const pop = w.find(".opt-hints");
    expect(pop.exists()).toBe(true);
    expect(pop.attributes("aria-label")).toBe(MSG_OPT_HINTS);
    const items = w.findAll(".opt-hint");
    expect(items.map((i) => i.find(".opt-hint-n").text())).toEqual(["2", "3", "4", "5", "8", "9"]);
    expect(items[0]!.find(".opt-hint-l").text()).toBe("変更");
    w.unmount();
  });

  it("フォーカスが外れると閉じる（矩形選択の開始は入力欄を blur するのでここに合流する）", async () => {
    const w = mountGrid(true);
    const el = firstOptInput(w);
    await el.trigger("focus");
    await nextTick();
    expect(w.find(".opt-hints").exists()).toBe(true);
    await el.trigger("blur");
    await nextTick();
    expect(w.find(".opt-hints").exists()).toBe(false);
    w.unmount();
  });

  describe("矩形選択・クリップボードを妨げない", () => {
    it("ポップオーバーの mousedown はグリッドへ伝播しない", async () => {
      const w = mountGrid(true);
      await firstOptInput(w).trigger("focus");
      await nextTick();

      let reached = false;
      w.element.addEventListener("mousedown", () => { reached = true; });
      await w.find(".opt-hints").trigger("mousedown");
      // 伝播すると onGridMousedown が走り clearRectSel() で矩形選択が消える
      expect(reached).toBe(false);
      w.unmount();
    });

    it("項目の mousedown もグリッドへ伝播せず、既定動作（フォーカス移動）も止める", async () => {
      const w = mountGrid(true);
      await firstOptInput(w).trigger("focus");
      await nextTick();

      let reached = false;
      w.element.addEventListener("mousedown", () => { reached = true; });
      const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      w.find(".opt-hint").element.dispatchEvent(ev);
      expect(reached).toBe(false);
      // preventDefault されていれば既定のフォーカス移動が起きない＝貼り付け先が変わらない
      expect(ev.defaultPrevented).toBe(true);
      w.unmount();
    });

    it("キーイベントを購読しない（矢印・Esc は素通り）", async () => {
      const w = mountGrid(true);
      await firstOptInput(w).trigger("focus");
      await nextTick();
      const pop = w.find(".opt-hints").element as HTMLElement;
      for (const type of ["keydown", "keyup", "keypress"]) {
        const ev = new KeyboardEvent(type, { key: "Escape", bubbles: true, cancelable: true });
        pop.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(false);
      }
      w.unmount();
    });
  });

  it("選ぶと欄へ番号が入る", async () => {
    const w = mountGrid(true);
    await firstOptInput(w).trigger("focus");
    await nextTick();
    await w.findAll(".opt-hint")[1]!.trigger("click"); // 3=コピー
    await nextTick();
    expect((firstOptInput(w).element as HTMLInputElement).value.trim()).toBe("3");
    w.unmount();
  });
});
