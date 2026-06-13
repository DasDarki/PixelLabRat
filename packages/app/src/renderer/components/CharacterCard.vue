<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { CharacterRecord } from "@pixellabrat/store";
import { useApp } from "../store";
import AnimationPlayer from "./AnimationPlayer.vue";

const props = defineProps<{ character: CharacterRecord }>();
const app = useApp();
const srcs = ref<Record<string, string>>({});
const expanded = ref(false);
const animOpen = ref(false);
const action = ref("");
const dirs = Object.keys(props.character.rotations);
// Which directions to animate (default: south, or the first available rotation).
const animDirs = ref<string[]>([dirs.includes("south") ? "south" : (dirs[0] ?? "south")]);

const animations = computed(() => props.character.animations ?? []);
const busy = computed(() => app.animatingCharacterId === props.character.id);

function toggleDir(d: string) {
  const i = animDirs.value.indexOf(d);
  if (i >= 0) {
    if (animDirs.value.length > 1) animDirs.value.splice(i, 1);
  } else {
    animDirs.value.push(d);
  }
}

function playDir(frames: Record<string, string[]>): string {
  return frames.south ? "south" : (Object.keys(frames)[0] ?? "south");
}

async function load(dir: string) {
  if (dir && !srcs.value[dir] && app.currentSlug) {
    srcs.value[dir] = await window.api.characterImage(app.currentSlug, props.character.id, dir);
  }
}

onMounted(() => load(dirs.includes("south") ? "south" : (dirs[0] ?? "south")));

async function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value) await Promise.all(dirs.map(load));
}

async function animate() {
  const a = action.value.trim();
  if (!a) return;
  await app.animateCharacter(props.character.id, a, { directions: [...animDirs.value] });
  action.value = "";
}
</script>

<template>
  <div class="char-card">
    <div
      class="char-thumb zoomable"
      @click="(srcs.south ?? srcs[dirs[0]!]) && app.viewImage((srcs.south ?? srcs[dirs[0]!])!, character.name)"
    >
      <img :src="srcs.south ?? srcs[dirs[0]!]" :alt="character.name" />
    </div>
    <div class="char-body">
      <div class="char-name" :title="character.prompt">{{ character.name }}</div>
      <div class="char-meta">
        {{ character.directions }} Richtungen · {{ dirs.length }} Bilder
        <template v-if="animations.length"> · {{ animations.length }} Anim.</template>
      </div>
      <div class="char-actions">
        <button @click="toggle">{{ expanded ? "einklappen" : "Rotationen" }}</button>
        <button :class="{ on: animOpen }" @click="animOpen = !animOpen">▶ Anim</button>
        <button class="del" @click="app.deleteCharacter(character.id)" title="Löschen">×</button>
      </div>

      <div v-if="expanded" class="rot-strip">
        <div
          v-for="d in dirs"
          :key="d"
          class="rot zoomable"
          :title="d"
          @click="srcs[d] && app.viewImage(srcs[d]!, `${character.name} · ${d}`)"
        >
          <img :src="srcs[d]" :alt="d" />
        </div>
      </div>

      <div v-if="animOpen" class="anim-section">
        <div v-if="animations.length" class="anim-list">
          <div v-for="a in animations" :key="a.type" class="anim-item">
            <AnimationPlayer
              :character-id="character.id"
              :anim-type="a.type"
              :direction="playDir(a.frames)"
              :frame-count="(a.frames[playDir(a.frames)] ?? []).length"
              :title="`${character.name} · ${a.displayName ?? a.type}`"
            />
            <span class="anim-name">{{ a.displayName ?? a.type }}</span>
          </div>
        </div>
        <div class="anim-create">
          <input
            v-model="action"
            :disabled="busy"
            placeholder="Aktion, z. B. 'walking'"
            @keyup.enter="animate"
          />
          <button :disabled="busy || !action.trim()" @click="animate">
            {{ busy ? Math.round(app.animationProgress * 100) + "%" : "Animieren" }}
          </button>
        </div>
        <div class="anim-dirs" title="Richtungen zum Animieren — mehr Richtungen = mehr Kosten/Zeit">
          <span class="anim-dirs-label">Richtungen:</span>
          <button
            v-for="d in dirs"
            :key="d"
            class="dir-chip"
            :class="{ on: animDirs.includes(d) }"
            :disabled="busy"
            @click="toggleDir(d)"
          >
            {{ d }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
