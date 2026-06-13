<script setup lang="ts">
import { onMounted } from "vue";
import { useApp } from "./store";
import Sidebar from "./components/Sidebar.vue";
import ProjectView from "./components/ProjectView.vue";
import ChatPanel from "./components/ChatPanel.vue";
import Lightbox from "./components/Lightbox.vue";

const app = useApp();
onMounted(() => app.init());
</script>

<template>
  <div class="app">
    <Sidebar />
    <main class="main">
      <ProjectView v-if="app.currentSlug" />
      <div v-else class="empty">
        <div class="empty-card">
          <h1>Pixel<span style="color: var(--accent)">Lab</span>Rat</h1>
          <p>Wähle links ein Projekt oder lege ein neues an.</p>
        </div>
      </div>
      <transition name="fade">
        <div v-if="app.error" class="toast" @click="app.error = null">{{ app.error }}</div>
      </transition>
    </main>
    <ChatPanel />
    <Lightbox />
  </div>
</template>
