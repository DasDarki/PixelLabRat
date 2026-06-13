<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useApp } from "../store";

const app = useApp();
const input = ref("");
const token = ref("");
const body = ref<HTMLElement | null>(null);

const authLabel = computed(() => {
  switch (app.authVia) {
    case "api-key":
      return "API-Key";
    case "stored-token":
      return "Claude-Abo (gespeichert)";
    case "env-token":
      return "Claude-Abo (.env)";
    case "cli-login":
      return "Claude Code Login";
    default:
      return "nicht verbunden";
  }
});

function send() {
  if (!input.value.trim()) return;
  app.sendChat(input.value);
  input.value = "";
}

async function saveToken() {
  if (await app.setClaudeToken(token.value)) token.value = "";
}

watch(
  () => app.chat.map((m) => m.text.length + m.tools.length).join(","),
  () => nextTick(() => body.value && (body.value.scrollTop = body.value.scrollHeight)),
);
</script>

<template>
  <transition name="slide">
    <aside v-if="app.chatOpen" class="chat">
      <header class="chat-head">
        <span class="chat-title">✨ Art-Director</span>
        <div class="chat-head-actions">
          <button class="icon" @click="app.resetChat()" title="Neuer Chat">⟳</button>
          <button class="icon" @click="app.toggleChat()" title="Schließen">×</button>
        </div>
      </header>

      <div v-if="app.agentAvailable" class="chat-status">
        <span class="dot"></span> {{ authLabel }}
        <button v-if="app.authStored" class="link" @click="app.disconnectClaude()">trennen</button>
      </div>

      <!-- Not connected: one-click connect + fallbacks -->
      <div v-else class="chat-connect">
        <p class="connect-lead">
          Verbinde den Art-Director mit deinem <b>Claude-Abo</b> — kein API-Key nötig.
        </p>
        <button class="gen connect-btn" :disabled="app.connecting" @click="app.connectClaude()">
          {{ app.connecting ? "Browser geöffnet — bitte autorisieren…" : "Mit Claude verbinden" }}
        </button>
        <details class="connect-alt">
          <summary>Alternativen</summary>
          <p class="muted">Token manuell aus <code>claude setup-token</code>:</p>
          <div class="token-row">
            <input v-model="token" type="password" placeholder="sk-ant-oat01-…" />
            <button @click="saveToken" :disabled="!token.trim()">Speichern</button>
          </div>
          <p class="muted">Oder <code>ANTHROPIC_API_KEY</code> in <code>.env</code> (Pay-per-Token).</p>
        </details>
      </div>

      <div class="chat-body" ref="body">
        <div v-if="app.agentAvailable && app.chat.length === 0" class="chat-empty">
          Bitte den Art-Director um Hilfe — z. B. „Generiere 3 Slime-Varianten und sag mir, welche
          am besten zum Projekt-Style passt."
        </div>
        <div v-for="(m, i) in app.chat" :key="i" class="msg" :class="m.role">
          <div v-if="m.text" class="bubble">{{ m.text }}</div>
          <div
            v-else-if="m.role === 'assistant' && app.chatBusy && i === app.chat.length - 1"
            class="bubble dim"
          >
            …
          </div>
          <div v-if="m.tools.length" class="tools">
            <span v-for="(t, j) in m.tools" :key="j" class="toolchip">
              {{ t.name }}<template v-if="t.summary"> · {{ t.summary }}</template>
            </span>
          </div>
        </div>
      </div>

      <div class="chat-input">
        <textarea
          v-model="input"
          rows="2"
          :disabled="!app.agentAvailable"
          placeholder="Nachricht an den Art-Director…"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <button class="gen" :disabled="!app.agentAvailable || app.chatBusy || !input.trim()" @click="send">
          {{ app.chatBusy ? "…" : "Senden" }}
        </button>
      </div>
    </aside>
  </transition>
</template>
