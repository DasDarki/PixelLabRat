<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useApp } from "../store";

const props = defineProps<{
  characterId: string;
  animType: string;
  direction: string;
  frameCount: number;
  title?: string;
}>();
const app = useApp();
const frames = ref<string[]>([]);

function enlarge() {
  if (frames.value.length) app.viewAnimation([...frames.value], props.title ?? props.animType);
}
const idx = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  if (!app.currentSlug) return;
  const loaded: string[] = [];
  for (let i = 0; i < props.frameCount; i++) {
    loaded.push(
      await window.api.animationFrame(app.currentSlug, props.characterId, props.animType, props.direction, i),
    );
  }
  frames.value = loaded;
  if (loaded.length > 1) {
    timer = setInterval(() => {
      idx.value = (idx.value + 1) % frames.value.length;
    }, 160);
  }
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="anim-player zoomable" :title="`${animType} (${frameCount} frames) — groß ansehen`" @click="enlarge">
    <img v-if="frames[idx]" :src="frames[idx]" :alt="animType" />
  </div>
</template>
