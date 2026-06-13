<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ObjectRecord } from "@pixellabrat/store";
import { useApp } from "../store";

const props = defineProps<{ object: ObjectRecord }>();
const app = useApp();
const srcs = ref<Record<string, string>>({});
const expanded = ref(false);
const dirs = Object.keys(props.object.rotations);
const thumbDir = dirs.includes("south") ? "south" : (dirs[0] ?? "");

async function load(dir: string) {
  if (dir && !srcs.value[dir] && app.currentSlug) {
    srcs.value[dir] = await window.api.objectImage(app.currentSlug, props.object.id, dir);
  }
}

onMounted(() => load(thumbDir));

async function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value) await Promise.all(dirs.map(load));
}
</script>

<template>
  <div class="char-card">
    <div class="char-thumb zoomable" @click="srcs[thumbDir] && app.viewImage(srcs[thumbDir]!, object.name)">
      <img :src="srcs[thumbDir]" :alt="object.name" />
    </div>
    <div class="char-body">
      <div class="char-name" :title="object.prompt">{{ object.name }}</div>
      <div class="char-meta">{{ object.directions }} Richtung(en) · {{ dirs.length }} Bilder</div>
      <div class="char-actions">
        <button v-if="dirs.length > 1" @click="toggle">{{ expanded ? "einklappen" : "Ansichten" }}</button>
        <button class="del" @click="app.deleteObject(object.id)" title="Löschen">×</button>
      </div>
      <div v-if="expanded" class="rot-strip">
        <div
          v-for="d in dirs"
          :key="d"
          class="rot zoomable"
          :title="d"
          @click="srcs[d] && app.viewImage(srcs[d]!, `${object.name} · ${d}`)"
        >
          <img :src="srcs[d]" :alt="d" />
        </div>
      </div>
    </div>
  </div>
</template>
