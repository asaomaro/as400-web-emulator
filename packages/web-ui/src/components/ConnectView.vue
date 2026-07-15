<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { PublicProfile } from "@as400web/server";
import { settingsStore, type SavedConnection } from "../stores/settings.js";
import { openSession } from "../session-controller.js";

const emit = defineEmits<{ (e: "connected", sessionId: string): void }>();

const profiles = ref<PublicProfile[]>([]);
const error = ref("");
const connecting = ref(false);
const showForm = ref(false);
const form = ref<{ id?: string; name: string; host: string; port?: number; ccsid?: number; deviceName?: string }>({
  name: "",
  host: ""
});

onMounted(async () => {
  try {
    const res = await fetch("/api/profiles");
    const body = (await res.json()) as { profiles: PublicProfile[] };
    profiles.value = body.profiles;
  } catch {
    /* サーバー未起動時は空。ブラウザ保存の接続だけ使える */
  }
});

async function connectProfile(p: PublicProfile): Promise<void> {
  await doConnect({ type: "open", profile: p.name }, p.name);
}

async function connectSaved(c: SavedConnection): Promise<void> {
  const open = {
    type: "open" as const,
    host: c.host,
    ...(c.port !== undefined ? { port: c.port } : {}),
    ...(c.ccsid !== undefined ? { ccsid: c.ccsid } : {}),
    ...(c.deviceName !== undefined ? { deviceName: c.deviceName } : {})
  };
  settingsStore.markConnected(c.id, Date.now());
  await doConnect(open, c.name);
}

async function doConnect(open: Parameters<typeof openSession>[0], label: string): Promise<void> {
  error.value = "";
  connecting.value = true;
  try {
    const id = await openSession(open, label);
    emit("connected", id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    connecting.value = false;
  }
}

function saveForm(): void {
  if (!form.value.name || !form.value.host) return;
  settingsStore.save(form.value);
  showForm.value = false;
  form.value = { name: "", host: "" };
}
</script>

<template>
  <div class="connect">
    <h2>接続</h2>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <div class="list">
      <button
        v-for="p in profiles"
        :key="'srv-' + p.name"
        class="card"
        :disabled="connecting"
        @click="connectProfile(p)"
      >
        <span class="src srv">サーバー</span>
        <b>{{ p.name }}</b>
        <span v-if="p.autoSignon" title="自動サインオン">⚡</span>
        <small>{{ p.host }}{{ p.port ? ":" + p.port : "" }}{{ p.tls ? " TLS" : "" }}</small>
      </button>

      <button
        v-for="c in settingsStore.connections"
        :key="'loc-' + c.id"
        class="card"
        :disabled="connecting"
        @click="connectSaved(c)"
      >
        <span class="src loc">ブラウザ</span>
        <b>{{ c.name }}</b>
        <small>{{ c.host }}{{ c.port ? ":" + c.port : "" }}</small>
      </button>

      <button class="card add" @click="showForm = !showForm">＋ 新規接続</button>
    </div>

    <form v-if="showForm" class="form" @submit.prevent="saveForm">
      <input v-model="form.name" placeholder="名称" required />
      <input v-model="form.host" placeholder="ホスト" required />
      <input v-model.number="form.port" type="number" placeholder="ポート (既定 23)" />
      <input v-model.number="form.ccsid" type="number" placeholder="CCSID (既定 37)" />
      <button type="submit">保存</button>
    </form>
  </div>
</template>

<style scoped>
.connect {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px;
}
h2 {
  font-family: var(--mono);
}
.err {
  color: #c62828;
  font-family: var(--mono);
}
.list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--card);
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.card:hover {
  border-color: var(--accent);
}
.card.add {
  border-style: dashed;
  align-items: center;
  color: var(--accent);
}
.src {
  font-family: var(--mono);
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 4px;
}
.src.srv {
  background: var(--accent-soft);
  color: var(--accent);
}
.src.loc {
  border: 1px dashed var(--line);
  color: var(--muted);
}
small {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
}
.form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.form input {
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--card);
  color: var(--ink);
}
.form button {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}
</style>
