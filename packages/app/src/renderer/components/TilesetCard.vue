<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { TilesetRecord } from "@pixellabrat/store";
import { useApp } from "../store";

const props = defineProps<{ tileset: TilesetRecord }>();
const app = useApp();
const srcs = ref<Record<string, string>>({});

onMounted(async () => {
  if (!app.currentSlug) return;
  for (const t of props.tileset.tiles) {
    srcs.value[t.id] = await window.api.tileImage(app.currentSlug, props.tileset.id, t.id);
  }
});
</script>

<template>
  <div class="char-card tileset-card">
    <div class="char-body">
      <div class="char-name" :title="`${tileset.lowerDescription} / ${tileset.upperDescription}`">
        {{ tileset.lowerDescription }} / {{ tileset.upperDescription }}
      </div>
      <div class="char-meta">{{ tileset.totalTiles }} Tiles · {{ tileset.tileSize.width }}px</div>
      <div class="tile-grid">
        <div
          v-for="t in tileset.tiles"
          :key="t.id"
          class="tile zoomable"
          :title="t.name"
          @click="srcs[t.id] && app.viewImage(srcs[t.id]!, `${tileset.lowerDescription} · ${t.name}`)"
        >
          <img :src="srcs[t.id]" :alt="t.name" />
        </div>
      </div>
      <div class="char-actions">
        <button class="del" @click="app.deleteTileset(tileset.id)" title="Löschen">×</button>
      </div>
    </div>
  </div>
</template>
