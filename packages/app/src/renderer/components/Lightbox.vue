<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useApp } from "../store";

const app = useApp();
const lb = computed(() => app.lightbox);

const idx = ref(0);
const playing = ref(true);
let timer: ReturnType<typeof setInterval> | undefined;

function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
function start() {
  stop();
  if (lb.value?.kind === "animation" && playing.value && lb.value.frames.length > 1) {
    timer = setInterval(() => {
      const n = app.lightbox?.kind === "animation" ? app.lightbox.frames.length : 1;
      idx.value = (idx.value + 1) % n;
    }, 160);
  }
}

const currentSrc = computed(() => {
  const l = lb.value;
  if (!l) return "";
  return l.kind === "image" ? l.src : (l.frames[idx.value] ?? l.frames[0] ?? "");
});

watch(lb, (l) => {
  idx.value = 0;
  playing.value = true;
  if (l) start();
  else stop();
});

function togglePlay() {
  playing.value = !playing.value;
  start();
}

function onKey(e: KeyboardEvent) {
  if (!app.lightbox) return;
  if (e.key === "Escape") app.closeLightbox();
  else if (e.key === " " && app.lightbox.kind === "animation") {
    e.preventDefault();
    togglePlay();
  }
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  stop();
});
</script>

<template>
  <transition name="fade">
    <div v-if="lb" class="lightbox" @click="app.closeLightbox()">
      <div class="lb-stage" @click.stop>
        <img :src="currentSrc" :alt="lb.title" />
      </div>
      <div class="lb-bar" @click.stop>
        <span class="lb-title">{{ lb.title }}</span>
        <template v-if="lb.kind === 'animation'">
          <button class="mini" @click="togglePlay">{{ playing ? "⏸" : "▶" }}</button>
          <span class="lb-count">{{ idx + 1 }}/{{ lb.frames.length }}</span>
        </template>
      </div>
      <button class="lb-close" @click="app.closeLightbox()" title="Schließen (Esc)">×</button>
    </div>
  </transition>
</template>
