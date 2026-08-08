<script setup lang="ts">
/**
 * 列の候補一覧（SQL 欄の `別名.` で出る）。
 *
 * **入力欄そのものは `textarea` のまま**。候補は入力欄に重ねた別の箱で、
 * キーの取り回しは親（`SqlPane`）が持つ——`textarea` からフォーカスを移すと
 * 変換中の文字が確定してしまうので、**ここは絶対にフォーカスを取らない**
 * （選ぶのは親のキー操作か、マウスの `mousedown` を止めてのクリック）。
 */
import type { ColumnCandidate } from "../sqlColumns.js";

const props = defineProps<{
  items: readonly ColumnCandidate[];
  /** 選択中の位置（親がキーで動かす） */
  index: number;
  /** 入力欄の左上を原点とした表示位置 */
  left: number;
  top: number;
}>();

const emit = defineEmits<{ pick: [item: ColumnCandidate] }>();
</script>

<template>
  <ul
    class="sqlc"
    role="listbox"
    aria-label="列の候補"
    :style="{ left: `${props.left}px`, top: `${props.top}px` }"
  >
    <li
      v-for="(c, i) in props.items"
      :key="c.name"
      class="sqlc-item"
      :class="{ on: i === props.index }"
      role="option"
      :aria-selected="i === props.index"
      :title="c.text ?? c.name"
      @mousedown.prevent="emit('pick', c)"
    >
      <span class="sqlc-name">{{ c.name }}</span>
      <span v-if="c.type" class="sqlc-type">{{ c.type }}</span>
      <span v-if="c.text" class="sqlc-text">{{ c.text }}</span>
    </li>
  </ul>
</template>

<style scoped>
.sqlc {
  position: absolute;
  z-index: 30;
  margin: 0;
  padding: 2px;
  list-style: none;
  min-width: 220px;
  max-width: 420px;
  max-height: 220px;
  overflow: auto;
  background: var(--card);
  border: 1px solid var(--accent);
  border-radius: 6px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 25%);
}
.sqlc-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.sqlc-item:hover {
  background: var(--accent-soft);
}
.sqlc-item.on {
  background: var(--accent-soft);
  outline: 1px solid var(--accent);
}
.sqlc-name {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--ink);
}
.sqlc-type {
  font-size: 11px;
  color: var(--muted);
}
/* 説明は伸びるので、はみ出したら切る（`title` で全文が読める） */
.sqlc-text {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
