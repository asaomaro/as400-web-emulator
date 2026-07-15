<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AidKey } from "@as400web/core";
import ScreenGrid from "./ScreenGrid.vue";
import StatusBar from "./StatusBar.vue";
import { sessionsStore } from "../stores/sessions.js";
import { workspaceStore } from "../stores/workspace.js";
import { makeKeydownHandler } from "../composables/useKeymap.js";
import { sendKey, selectGuiChoice, submitGuiSelection } from "../session-controller.js";

const props = defineProps<{ sessionId: string; focused: boolean }>();
const emit = defineEmits<{ (e: "focus"): void }>();

const state = computed(() => sessionsStore.get(props.sessionId));
const snapshot = computed(() => state.value?.snapshot);
const insertMode = ref(false);
// ユーザーがクリック/フォーカスでカーソルを動かしたときの上書き（未操作ならホスト snapshot.cursor を使う）
const cursorOverride = ref<{ row: number; col: number } | undefined>();
const cursor = computed(() => cursorOverride.value ?? snapshot.value?.cursor ?? { row: 1, col: 1 });

function onEdit(fieldIndex: number, value: string): void {
  state.value?.edits.set(fieldIndex, value);
}
function onCursor(row: number, col: number): void {
  cursorOverride.value = { row, col };
}
function onGuiSelect(fieldId: number, choiceIndex: number, selected: boolean): void {
  selectGuiChoice(props.sessionId, fieldId, choiceIndex, selected);
}
function onGuiSubmit(fieldId: number): void {
  submitGuiSelection(props.sessionId, fieldId, cursor.value);
}
// 新しいホスト画面が来たらユーザーのカーソル上書きをリセットする
watch(snapshot, () => (cursorOverride.value = undefined));

const onKeydown = makeKeydownHandler({
  sendAid: (key: AidKey) => sendKey(props.sessionId, key, cursor.value),
  local: () => {
    /* Home/End/Tab/矢印のローカル操作は将来精緻化（フォーカス移動はブラウザ既定を抑止済み） */
  },
  isFocused: () => props.focused
});
</script>

<template>
  <div class="pane" :data-focused="focused" tabindex="0" @keydown="onKeydown" @mousedown="emit('focus')">
    <ScreenGrid
      v-if="snapshot"
      v-model:insert-mode="insertMode"
      :snapshot="snapshot"
      :edits="state!.edits"
      :focused="focused"
      :show-shift-marks="workspaceStore.showShiftMarks"
      :katakana-view="workspaceStore.katakanaView"
      :linkify="workspaceStore.linkify"
      @edit="onEdit"
      @cursor="onCursor"
      @gui-select="onGuiSelect"
      @gui-submit="onGuiSubmit"
    />
    <div v-else class="pane-empty">接続待ち…</div>
    <StatusBar v-if="state" :state="state" :insert-mode="insertMode" />
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--crt-line);
  border-radius: 6px;
  overflow: hidden;
  background: var(--crt);
}
.pane[data-focused="true"] {
  border-color: var(--t-green);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--t-green) 35%, transparent);
}
.pane:focus {
  outline: none;
}
.pane-empty {
  color: var(--muted);
  padding: 20px;
  font-family: var(--mono);
}
</style>
