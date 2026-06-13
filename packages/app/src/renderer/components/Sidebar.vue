<script setup lang="ts">
import { ref } from "vue";
import { useApp } from "../store";

const app = useApp();
const newName = ref("");

async function create() {
  const n = newName.value.trim();
  if (!n) return;
  await app.createProject(n);
  newName.value = "";
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">Pixel<span>Lab</span>Rat</div>
    <div class="new">
      <input v-model="newName" placeholder="Neues Projekt…" @keyup.enter="create" />
      <button @click="create">＋</button>
    </div>
    <nav class="projects">
      <button
        v-for="p in app.projects"
        :key="p.slug"
        class="proj"
        :class="{ active: p.slug === app.currentSlug }"
        @click="app.open(p.slug)"
      >
        <span class="proj-name">{{ p.name }}</span>
        <span class="proj-meta">{{ p.assetCount }}·{{ p.refCount }}/4</span>
      </button>
    </nav>
    <div class="balance" v-if="app.balance">
      <div class="bal-plan">{{ app.balance.subscription.plan }}</div>
      <div class="bal-gen">
        {{ app.balance.subscription.generations }} / {{ app.balance.subscription.total }} gens
      </div>
    </div>
  </aside>
</template>
