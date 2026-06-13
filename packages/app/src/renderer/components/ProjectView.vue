<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useApp } from "../store";
import AssetCard from "./AssetCard.vue";
import CharacterCard from "./CharacterCard.vue";
import ObjectCard from "./ObjectCard.vue";
import ObjectReviewCard from "./ObjectReviewCard.vue";
import TilesetCard from "./TilesetCard.vue";

const app = useApp();

type Tab = "images" | "characters" | "objects" | "tilesets";
type ImgRoute = "image" | "ui" | "iso";
type TileKind = "top-down" | "sidescroller";

const tab = ref<Tab>("images");
const imgRoute = ref<ImgRoute>("image");
const prompt = ref("");
const upper = ref(""); // tileset top-down: upper/elevated terrain
const isoShape = ref("block");
const objSingle = ref(true);
const objReview = ref(true);
const tileKind = ref<TileKind>("top-down");
const styleOpen = ref(false);
const desc = ref(app.style?.styleDescription ?? "");
const refSrcs = ref<Record<string, string>>({});

const PERSPECTIVES = [
  { v: "", label: "– keine –" },
  { v: "side", label: "Seitenansicht (Sidescroller)" },
  { v: "low top-down", label: "flache Top-Down" },
  { v: "high top-down", label: "hohe Top-Down" },
];
const DIRECTIONS = ["block", "thick tile", "thin tile"];

// Which style-contract settings the *active* route actually uses → show only those.
const caps = computed(() => {
  if (tab.value === "characters") return { bg: true, view: true, refs: false };
  if (tab.value === "objects") return { bg: false, view: true, refs: false };
  if (tab.value === "tilesets") return { bg: false, view: false, refs: false };
  // images
  if (imgRoute.value === "image") return { bg: true, view: false, refs: true };
  return { bg: false, view: false, refs: false }; // ui / iso
});

const busy = computed(() => {
  if (tab.value === "characters") return app.creatingCharacter;
  if (tab.value === "objects") return app.creatingObject;
  if (tab.value === "tilesets") return app.creatingTileset;
  return app.generating;
});
const progress = computed(() => {
  if (tab.value === "characters") return app.characterProgress;
  if (tab.value === "objects") return app.objectProgress;
  if (tab.value === "tilesets") return app.tilesetProgress;
  return app.progress;
});

const placeholder = computed(() => {
  switch (tab.value) {
    case "characters":
      return "Charakter beschreiben, z. B. 'gaunt Victorian widow in mourning dress'";
    case "objects":
      return "Objekt beschreiben, z. B. 'verwitterter Grabstein mit Kreuz'";
    case "tilesets":
      return tileKind.value === "sidescroller"
        ? "Plattform-/Boden-Terrain, z. B. 'Steinplattform'"
        : "Basis-Terrain, z. B. 'Gras'";
    default:
      if (imgRoute.value === "ui") return "UI-Element, z. B. 'Holz-Button', 'Herz-Lebensanzeige'";
      if (imgRoute.value === "iso") return "Iso-Tile, z. B. 'Grasblock', 'Steinpfad'";
      return "Was soll generiert werden? z. B. 'roter Slime mit Krone'";
  }
});

const cta = computed(() => {
  switch (tab.value) {
    case "characters":
      return "Charakter erstellen · teuer";
    case "objects":
      return objSingle.value
        ? objReview.value
          ? "Objekt · Kandidaten · teuer"
          : "Objekt · 1 Ansicht · teuer"
        : "Objekt · 8 Rotationen · teuer";
    case "tilesets":
      return tileKind.value === "sidescroller"
        ? "Sidescroller-Tileset · teuer"
        : "Top-Down-Tileset · teuer";
    default:
      if (imgRoute.value === "ui") return "UI-Element · Pro";
      if (imgRoute.value === "iso") return "Iso-Tile · Pro";
      return app.refCount > 0 ? "Generieren · Style-Match · ~20 gens" : "Generieren · Pixflux · ~1 gen";
  }
});

const canSubmit = computed(() => {
  if (busy.value || !prompt.value.trim()) return false;
  if (tab.value === "tilesets" && tileKind.value === "top-down" && !upper.value.trim()) return false;
  return true;
});

async function submit() {
  if (!canSubmit.value) return;
  const d = prompt.value.trim();
  if (tab.value === "images") {
    if (imgRoute.value === "ui") await app.generateUI({ description: d });
    else if (imgRoute.value === "iso")
      await app.createIsometricTile({ description: d, size: 32, shape: isoShape.value });
    else await app.generate({ description: d });
  } else if (tab.value === "characters") {
    await app.createCharacter({ description: d });
  } else if (tab.value === "objects") {
    await app.createObject({
      description: d,
      directions: objSingle.value ? 1 : 8,
      size: objSingle.value ? (objReview.value ? 128 : 192) : 64,
    });
  } else if (tab.value === "tilesets") {
    if (tileKind.value === "sidescroller")
      await app.createTileset({ lowerDescription: d, kind: "sidescroller", tileSize: 16 });
    else
      await app.createTileset({
        lowerDescription: d,
        upperDescription: upper.value.trim(),
        kind: "top-down",
        tileSize: 16,
      });
  }
  prompt.value = "";
  upper.value = "";
}

// ---- persistent style-contract settings (show/hide per route) ----
function saveDesc() {
  if (desc.value !== (app.style?.styleDescription ?? "")) app.saveStyle({ styleDescription: desc.value });
}
function toggleBg() {
  app.saveStyle({ noBackground: !app.style?.noBackground });
}
function setView(e: Event) {
  app.saveStyle({ view: (e.target as HTMLSelectElement).value || undefined });
}

watch(
  () => app.style?.styleDescription,
  (v) => {
    desc.value = v ?? "";
  },
);
watch(
  () => app.style?.refs,
  async (refs) => {
    const next: Record<string, string> = {};
    for (const r of refs ?? []) next[r.file] = await window.api.refImage(app.currentSlug!, r.file);
    refSrcs.value = next;
  },
  { immediate: true, deep: true },
);
</script>

<template>
  <div class="project" v-if="app.manifest">
    <header class="phead">
      <h2>{{ app.manifest.name }}</h2>
      <span class="slug">{{ app.manifest.slug }}</span>
      <button class="assistant-btn" :class="{ on: app.chatOpen }" @click="app.toggleChat()">
        ✨ Art-Director
      </button>
    </header>

    <!-- route selector -->
    <div class="tabs">
      <button :class="{ on: tab === 'images' }" @click="tab = 'images'">Bilder ({{ app.assets.length }})</button>
      <button :class="{ on: tab === 'characters' }" @click="tab = 'characters'">
        Charaktere ({{ app.characters.length }})
      </button>
      <button :class="{ on: tab === 'objects' }" @click="tab = 'objects'">Objekte ({{ app.objects.length }})</button>
      <button :class="{ on: tab === 'tilesets' }" @click="tab = 'tilesets'">Tilesets ({{ app.tilesets.length }})</button>
    </div>

    <!-- one composer to rule them all -->
    <section class="composer">
      <!-- sub-route for the image library (all produce library assets) -->
      <div v-if="tab === 'images'" class="seg">
        <button :class="{ on: imgRoute === 'image' }" @click="imgRoute = 'image'">Bild</button>
        <button :class="{ on: imgRoute === 'ui' }" @click="imgRoute = 'ui'">UI-Element</button>
        <button :class="{ on: imgRoute === 'iso' }" @click="imgRoute = 'iso'">Iso-Tile</button>
      </div>
      <!-- tileset kind -->
      <div v-if="tab === 'tilesets'" class="seg">
        <button :class="{ on: tileKind === 'top-down' }" @click="tileKind = 'top-down'">Top-Down</button>
        <button :class="{ on: tileKind === 'sidescroller' }" @click="tileKind = 'sidescroller'">Sidescroller</button>
      </div>

      <div class="genbar">
        <input v-model="prompt" :disabled="busy" :placeholder="placeholder" @keyup.enter="submit" />
        <input
          v-if="tab === 'tilesets' && tileKind === 'top-down'"
          v-model="upper"
          :disabled="busy"
          placeholder="Oberes Terrain, z. B. 'Wasser'"
        />
        <select v-if="tab === 'images' && imgRoute === 'iso'" v-model="isoShape" :disabled="busy">
          <option value="block">Block (hoch)</option>
          <option value="thick tile">dicke Kachel</option>
          <option value="thin tile">dünne Kachel</option>
        </select>
        <button class="gen" :disabled="!canSubmit" @click="submit">
          <span v-if="!busy">{{ cta }}</span>
          <span v-else>… {{ Math.round(progress * 100) }}%</span>
        </button>
      </div>
      <div v-if="busy" class="progress"><div class="bar" :style="{ width: progress * 100 + '%' }"></div></div>

      <!-- conditional settings: only what this route supports -->
      <div class="settings-row" v-if="caps.bg || caps.view || caps.refs || tab === 'objects'">
        <label v-if="caps.bg" class="chk">
          <input type="checkbox" :checked="app.style?.noBackground" @change="toggleBg" />
          transparenter Hintergrund
        </label>
        <label v-if="caps.view" class="view-sel">
          Perspektive
          <select :value="app.style?.view ?? ''" @change="setView">
            <option v-for="p in PERSPECTIVES" :key="p.v" :value="p.v">{{ p.label }}</option>
          </select>
        </label>
        <template v-if="tab === 'objects'">
          <label class="chk">
            <input type="checkbox" v-model="objSingle" :disabled="busy" />
            Einzelansicht (1 Richtung)
          </label>
          <label v-if="objSingle" class="chk">
            <input type="checkbox" v-model="objReview" :disabled="busy" />
            Kandidaten zur Auswahl
          </label>
        </template>
      </div>

      <!-- style references: only for the style-match image route -->
      <div v-if="caps.refs" class="refs">
        <div class="refs-head">
          <span>Style-Referenzen ({{ app.refCount }}/4)</span>
          <button @click="app.addRef()" :disabled="app.refCount >= 4">+ PNG</button>
        </div>
        <div class="ref-strip">
          <div v-for="r in app.style?.refs ?? []" :key="r.file" class="ref">
            <img :src="refSrcs[r.file]" />
            <button class="x" @click="app.removeRef(r.file)">×</button>
          </div>
          <div v-if="app.refCount === 0" class="ref-hint">
            Ohne Referenzen → günstiger Pixflux-Entwurf. Mit Refs (oder „★ Ref" an einem Asset) → konsistenter Style.
          </div>
        </div>
      </div>

      <!-- persistent project style anchor (applies to most routes) -->
      <div class="disclosure">
        <button class="disc-head" @click="styleOpen = !styleOpen">
          <span class="disc-caret">{{ styleOpen ? "▾" : "▸" }}</span>
          Projekt-Stil
          <span class="disc-summary">{{ app.style?.styleDescription || "(keine Stil-Beschreibung)" }}</span>
        </button>
        <div v-if="styleOpen" class="disc-body">
          <textarea
            v-model="desc"
            rows="2"
            @blur="saveDesc"
            placeholder="Gilt für alle Generierungen, z. B. 'detailed gothic horror pixel art, side view'"
          ></textarea>
          <span class="disc-note">Wird automatisch an jeden Prompt angehängt — der gemeinsame Stil-Anker des Projekts.</span>
        </div>
      </div>
    </section>

    <!-- active route's library -->
    <section class="library">
      <template v-if="tab === 'images'">
        <div v-if="app.assets.length === 0" class="lib-empty">Noch keine Assets. Generiere das erste oben.</div>
        <div class="grid"><AssetCard v-for="a in app.assets" :key="a.id" :asset="a" /></div>
      </template>

      <template v-else-if="tab === 'characters'">
        <div v-if="app.characters.length === 0 && !busy" class="lib-empty">Noch keine Charaktere.</div>
        <div class="char-grid"><CharacterCard v-for="c in app.characters" :key="c.id" :character="c" /></div>
      </template>

      <template v-else-if="tab === 'objects'">
        <div v-if="app.objectReviews.length" class="review-section">
          <div class="review-head">Zur Auswahl ({{ app.objectReviews.length }})</div>
          <div class="char-grid"><ObjectReviewCard v-for="r in app.objectReviews" :key="r.id" :review="r" /></div>
        </div>
        <div v-if="app.objects.length === 0 && app.objectReviews.length === 0 && !busy" class="lib-empty">
          Noch keine Objekte.
        </div>
        <div class="char-grid"><ObjectCard v-for="o in app.objects" :key="o.id" :object="o" /></div>
      </template>

      <template v-else-if="tab === 'tilesets'">
        <div v-if="app.tilesets.length === 0 && !busy" class="lib-empty">
          Noch keine Tilesets. (Iso-Tiles liegen im Tab „Bilder".)
        </div>
        <div class="char-grid"><TilesetCard v-for="t in app.tilesets" :key="t.id" :tileset="t" /></div>
      </template>
    </section>
  </div>
</template>
