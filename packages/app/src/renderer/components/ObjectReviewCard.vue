<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ObjectReviewRecord } from "@pixellabrat/store";
import { useApp } from "../store";

const props = defineProps<{ review: ObjectReviewRecord }>();
const app = useApp();
const srcs = ref<string[]>([]);
const selected = ref<Set<number>>(new Set());
const saving = ref(false);

onMounted(async () => {
  if (!app.currentSlug) return;
  const out: string[] = [];
  for (let i = 0; i < props.review.frames.length; i++) {
    out.push(await window.api.objectReviewFrame(app.currentSlug, props.review.id, i));
  }
  srcs.value = out;
});

function toggle(i: number) {
  const s = new Set(selected.value);
  if (s.has(i)) s.delete(i);
  else s.add(i);
  selected.value = s;
}

async function keep() {
  if (selected.value.size === 0 || saving.value) return;
  saving.value = true;
  try {
    await app.selectObjectFrames(props.review.id, [...selected.value].sort((a, b) => a - b));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="char-card review-card">
    <div class="char-body">
      <div class="char-name" :title="review.prompt">{{ review.prompt }}</div>
      <div class="char-meta">
        {{ review.frames.length }} Kandidaten · {{ selected.size }} gewählt
      </div>
      <div class="cand-grid">
        <button
          v-for="(src, i) in srcs"
          :key="i"
          class="cand"
          :class="{ on: selected.has(i) }"
          @click="toggle(i)"
        >
          <img :src="src" :alt="`Kandidat ${i}`" />
          <span class="cand-tick" v-if="selected.has(i)">✓</span>
        </button>
      </div>
      <div class="char-actions">
        <button class="gen" :disabled="saving || selected.size === 0" @click="keep">
          {{ saving ? "…" : `${selected.size || ""} übernehmen` }}
        </button>
        <button class="del" :disabled="saving" title="Verwerfen" @click="app.discardObjectReview(review.id)">
          ×
        </button>
      </div>
    </div>
  </div>
</template>
