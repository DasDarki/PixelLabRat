<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { AssetRecord, EditOp } from "@pixellabrat/store";
import { useApp } from "../store";

const props = defineProps<{ asset: AssetRecord }>();
const app = useApp();
const src = ref("");

async function loadSrc() {
  src.value = await window.api.assetImage(app.currentSlug!, props.asset.id);
}
onMounted(loadSrc);

const endpointLabel = computed(() => {
  switch (props.asset.endpoint) {
    case "generate-with-style-v2":
      return "styled";
    case "create-image-pixflux":
      return "pixflux";
    case "create-isometric-tile":
      return "iso";
    case "inpaint":
      return "inpaint";
    case "generate-ui-v2":
      return "ui";
    default:
      return props.asset.endpoint;
  }
});

const DIRECTIONS = [
  "south", "north", "east", "west",
  "south-east", "north-east", "north-west", "south-west",
];

// ---- edit panel ----
const panelOpen = ref(false);
// which parameterized op (or inpaint) is expanded; immediate ops run on click
type SubOp = null | "edit" | "rotate" | "resize" | "inpaint";
const sub = ref<SubOp>(null);
const busy = computed(() => app.generating);

// op params
const editDesc = ref("");
const rotateDir = ref("east");
const resizeW = ref(props.asset.size.width * 2);
const resizeH = ref(props.asset.size.height * 2);

function togglePanel() {
  panelOpen.value = !panelOpen.value;
  if (!panelOpen.value) sub.value = null;
}

async function runOp(spec: EditOp) {
  if (busy.value) return;
  const ok = await app.editAsset(props.asset.id, spec);
  if (ok) {
    panelOpen.value = false;
    sub.value = null;
  }
}

function applyParamOp() {
  if (sub.value === "edit") {
    const d = editDesc.value.trim();
    if (d) runOp({ op: "edit", description: d }).then(() => (editDesc.value = ""));
  } else if (sub.value === "rotate") {
    runOp({ op: "rotate", toDirection: rotateDir.value });
  } else if (sub.value === "resize") {
    runOp({ op: "resize", targetWidth: resizeW.value, targetHeight: resizeH.value });
  }
}

// ---- inpaint mask painter ----
const nativeW = props.asset.size.width;
const nativeH = props.asset.size.height;
const scale = Math.max(2, Math.round(256 / Math.max(nativeW, nativeH)));
const dispW = nativeW * scale;
const dispH = nativeH * scale;
const brush = ref(Math.max(2, Math.round(nativeW / 16)));
const inpaintDesc = ref("");
const canvas = ref<HTMLCanvasElement | null>(null);
let drawing = false;

watch(sub, async (v) => {
  if (v === "inpaint") {
    await nextTick();
    clearMask();
  }
});

function ctx(): CanvasRenderingContext2D | null {
  return canvas.value?.getContext("2d") ?? null;
}
function clearMask() {
  ctx()?.clearRect(0, 0, nativeW, nativeH);
}
function toNative(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.value!.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * nativeW,
    y: ((e.clientY - rect.top) / rect.height) * nativeH,
  };
}
function dot(e: PointerEvent) {
  const c = ctx();
  if (!c) return;
  const { x, y } = toNative(e);
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.arc(x, y, brush.value / 2, 0, Math.PI * 2);
  c.fill();
}
function startPaint(e: PointerEvent) {
  drawing = true;
  canvas.value?.setPointerCapture(e.pointerId);
  dot(e);
}
function movePaint(e: PointerEvent) {
  if (drawing) dot(e);
}
function endPaint() {
  drawing = false;
}
function buildMaskBase64(): string {
  const mask = document.createElement("canvas");
  mask.width = nativeW;
  mask.height = nativeH;
  const mc = mask.getContext("2d")!;
  mc.fillStyle = "#000000";
  mc.fillRect(0, 0, nativeW, nativeH);
  if (canvas.value) mc.drawImage(canvas.value, 0, 0);
  return mask.toDataURL("image/png").split(",")[1] ?? "";
}
async function applyInpaint() {
  const d = inpaintDesc.value.trim();
  if (!d || busy.value) return;
  const ok = await app.inpaintAsset({
    assetId: props.asset.id,
    maskBase64: buildMaskBase64(),
    description: d,
  });
  if (ok) {
    panelOpen.value = false;
    sub.value = null;
    inpaintDesc.value = "";
  }
}
</script>

<template>
  <div class="card" :class="asset.status">
    <div class="thumb zoomable" @click="src && app.viewImage(src, asset.prompt)">
      <img :src="src" :alt="asset.prompt" />
    </div>
    <div class="card-body">
      <div class="prompt" :title="asset.prompt">{{ asset.prompt }}</div>
      <div class="badges">
        <span class="badge" :class="asset.status">{{ asset.status }}</span>
        <span class="endp">{{ endpointLabel }}</span>
      </div>
      <div class="actions">
        <button @click="app.review(asset.id, 'approve')" title="Approve">✓</button>
        <button @click="app.review(asset.id, 'reject')" title="Reject">✕</button>
        <button class="star" @click="app.review(asset.id, 'promote')" title="Approve + als Style-Referenz">
          ★ Ref
        </button>
        <button :class="{ on: panelOpen }" @click="togglePanel" title="Bearbeiten / Inpaint">✎</button>
      </div>

      <div v-if="panelOpen" class="edit-panel">
        <div class="edit-ops">
          <button :disabled="busy" @click="runOp({ op: 'remove-background' })">Hintergrund weg</button>
          <button :disabled="busy" @click="runOp({ op: 'image-to-pixelart' })">→ Pixel-Art</button>
          <button :class="{ on: sub === 'edit' }" @click="sub = sub === 'edit' ? null : 'edit'">Bearbeiten</button>
          <button :class="{ on: sub === 'rotate' }" @click="sub = sub === 'rotate' ? null : 'rotate'">Drehen</button>
          <button :class="{ on: sub === 'resize' }" @click="sub = sub === 'resize' ? null : 'resize'">Größe</button>
          <button :class="{ on: sub === 'inpaint' }" @click="sub = sub === 'inpaint' ? null : 'inpaint'">Inpaint</button>
        </div>
        <div v-if="busy" class="progress"><div class="bar" :style="{ width: app.progress * 100 + '%' }"></div></div>

        <!-- text-described edit -->
        <div v-if="sub === 'edit'" class="edit-form">
          <input v-model="editDesc" :disabled="busy" placeholder="Änderung beschreiben, z. B. 'Hut rot färben'" @keyup.enter="applyParamOp" />
          <button class="gen" :disabled="busy || !editDesc.trim()" @click="applyParamOp">Anwenden · teuer</button>
        </div>

        <!-- rotate -->
        <div v-else-if="sub === 'rotate'" class="edit-form">
          <select v-model="rotateDir" :disabled="busy">
            <option v-for="d in DIRECTIONS" :key="d" :value="d">{{ d }}</option>
          </select>
          <button class="gen" :disabled="busy" @click="applyParamOp">Drehen</button>
        </div>

        <!-- resize -->
        <div v-else-if="sub === 'resize'" class="edit-form resize-form">
          <input v-model.number="resizeW" :disabled="busy" type="number" min="16" max="512" />
          <span>×</span>
          <input v-model.number="resizeH" :disabled="busy" type="number" min="16" max="512" />
          <button class="gen" :disabled="busy" @click="applyParamOp">Skalieren</button>
        </div>

        <!-- inpaint mask painter -->
        <div v-else-if="sub === 'inpaint'" class="inpaint">
          <div class="inpaint-stage" :style="{ width: dispW + 'px', height: dispH + 'px' }">
            <img class="inpaint-bg" :src="src" :style="{ width: dispW + 'px', height: dispH + 'px' }" />
            <canvas
              ref="canvas"
              class="inpaint-canvas"
              :width="nativeW"
              :height="nativeH"
              :style="{ width: dispW + 'px', height: dispH + 'px' }"
              @pointerdown="startPaint"
              @pointermove="movePaint"
              @pointerup="endPaint"
              @pointerleave="endPaint"
            ></canvas>
          </div>
          <div class="inpaint-row">
            <label>Pinsel <input type="range" min="1" :max="Math.max(4, nativeW / 4)" v-model.number="brush" /></label>
            <button class="mini" @click="clearMask">Maske leeren</button>
          </div>
          <input v-model="inpaintDesc" class="inpaint-desc" :disabled="busy" placeholder="Was soll im markierten Bereich entstehen?" @keyup.enter="applyInpaint" />
          <button class="gen" :disabled="busy || !inpaintDesc.trim()" @click="applyInpaint">Inpaint anwenden · teuer</button>
          <p class="inpaint-hint">Weiß übermalen = neu generieren. Rest bleibt erhalten.</p>
        </div>
      </div>
    </div>
  </div>
</template>
