"use strict";
const node_fs = require("node:fs");
const node_path = require("node:path");
const electron = require("electron");
const Anthropic = require("@anthropic-ai/sdk");
const node_child_process = require("node:child_process");
function resolveConfig(overrides = {}) {
  const token = overrides.token ?? process.env.PIXELLAB_API_KEY ?? process.env.API_KEY;
  if (!token) {
    throw new Error(
      "PixelLab API token missing. Set PIXELLAB_API_KEY (or API_KEY) in your environment or .env file."
    );
  }
  const baseUrl = (overrides.baseUrl ?? process.env.PIXELLAB_BASE_URL ?? "https://api.pixellab.ai/v2").replace(/\/+$/, "");
  return { token, baseUrl };
}
class PixelLabError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "PixelLabError";
  }
}
class PixelLabClient {
  config;
  constructor(config) {
    this.config = resolveConfig(config);
  }
  async request(method, path, body, opts = {}) {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        ...body !== void 0 ? { "Content-Type": "application/json" } : {}
      },
      body: body !== void 0 ? JSON.stringify(body) : void 0,
      signal: opts.signal
    });
    const text = await res.text();
    let parsed;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const p = parsed;
      const detail = p?.detail ?? p?.error ?? res.statusText;
      throw new PixelLabError(
        `PixelLab ${method} ${path} failed (${res.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
        res.status,
        parsed
      );
    }
    return { data: parsed, status: res.status };
  }
}
function stripDataUrl(b64) {
  const m = /^data:[^;]+;base64,(.*)$/s.exec(b64);
  return m ? m[1] : b64;
}
function base64ToBytes(b64) {
  return new Uint8Array(Buffer.from(stripDataUrl(b64), "base64"));
}
function pngSize(bytes) {
  if (bytes.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true }
    );
  });
}
class PixelLab extends PixelLabClient {
  /** Account balance: subscription generations + USD credits. Free to call. */
  async getBalance(opts) {
    const { data } = await this.request("GET", "/balance", void 0, opts);
    return data;
  }
  /** Pixflux: text -> pixel art. Synchronous. Costs ~1 generation. */
  async generatePixflux(input, opts) {
    const body = {
      description: input.description,
      image_size: { width: input.width ?? 64, height: input.height ?? 64 }
    };
    if (input.noBackground !== void 0) body.no_background = input.noBackground;
    if (input.seed !== void 0) body.seed = input.seed;
    const { data } = await this.request(
      "POST",
      "/create-image-pixflux",
      body,
      opts
    );
    return { image: data.image, usage: data.usage ?? null };
  }
  async getJob(id, opts) {
    const { data } = await this.request("GET", `/background-jobs/${id}`, void 0, opts);
    return {
      id: data.id,
      status: data.status,
      usage: data.usage ?? null,
      lastResponse: data.last_response ?? null
    };
  }
  /** Poll a background job until it leaves `processing`. */
  async pollJob(id, opts = {}) {
    const interval = opts.intervalMs ?? 3e3;
    const timeout = opts.timeoutMs ?? 6e5;
    const start = Date.now();
    for (; ; ) {
      const job = await this.getJob(id, { signal: opts.signal });
      const progress = job.lastResponse?.progress;
      if (typeof progress === "number") opts.onProgress?.(progress, job);
      if (job.status !== "processing") return job;
      if (Date.now() - start > timeout) {
        throw new Error(`Job ${id} timed out after ${timeout}ms (last status: ${job.status})`);
      }
      await sleep(interval, opts.signal);
    }
  }
  /**
   * generate-with-style-v2 (Pro). Submits the async job and polls to completion.
   * Costs ~20 generations. Returns the generated image candidates.
   */
  async generateWithStyle(input, opts = {}) {
    if (input.styleImages.length < 1 || input.styleImages.length > 4) {
      throw new Error(
        `generateWithStyle requires 1-4 style images, got ${input.styleImages.length}`
      );
    }
    const body = {
      description: input.description,
      image_size: { width: input.width ?? 64, height: input.height ?? 64 },
      style_images: input.styleImages.map((s) => ({
        image: { base64: s.base64 },
        width: s.width,
        height: s.height
      }))
    };
    if (input.styleDescription) body.style_description = input.styleDescription;
    if (input.noBackground !== void 0) body.no_background = input.noBackground;
    if (input.seed !== void 0) body.seed = input.seed;
    const submit = await this.request("POST", "/generate-with-style-v2", body, { signal: opts.signal });
    const jobId = submit.data.background_job_id;
    const job = await this.pollJob(jobId, opts);
    if (job.status !== "completed") {
      throw new Error(`generate-with-style job ${jobId} ended with status "${job.status}"`);
    }
    const lr = job.lastResponse ?? {};
    return {
      images: lr.images ?? [],
      quantizedImages: lr.quantized_images ?? [],
      usage: job.usage,
      jobId,
      seed: lr.seed,
      raw: lr
    };
  }
  // ---- characters ----
  /** Submit a v3 character generation. Returns immediately with ids; poll the job. */
  async createCharacterV3(input, opts) {
    const body = { description: input.description };
    if (input.width || input.height) {
      body.image_size = { width: input.width ?? 64, height: input.height ?? 64 };
    }
    if (input.view) body.view = input.view;
    if (input.templateId) body.template_id = input.templateId;
    if (input.noBackground !== void 0) body.no_background = input.noBackground;
    if (input.seed !== void 0) body.seed = input.seed;
    if (input.enhancePrompt !== void 0) body.enhance_prompt = input.enhancePrompt;
    if (input.referenceImageBase64) body.reference_image = { base64: input.referenceImageBase64 };
    const { data } = await this.request("POST", "/create-character-v3", body, opts);
    return {
      characterId: data.character_id,
      jobId: data.background_job_id,
      status: data.status,
      usage: data.usage ?? null,
      enhancedPrompt: data.enhanced_prompt ?? null
    };
  }
  async getCharacter(id, opts) {
    const { data } = await this.request("GET", `/characters/${id}`, void 0, opts);
    return data;
  }
  async listCharacters(opts) {
    const { data } = await this.request(
      "GET",
      "/characters",
      void 0,
      opts
    );
    return data.characters ?? [];
  }
  async deleteCharacter(id, opts) {
    await this.request("DELETE", `/characters/${id}`, void 0, opts);
  }
  /** Download a rotation/asset URL. Tries unauthenticated (signed URLs), then Bearer. */
  async downloadUrl(url, opts) {
    const full = url.startsWith("http") ? url : new URL(url, `${this.config.baseUrl}/`).toString();
    let res = await fetch(full, { signal: opts?.signal });
    if (res.status === 401 || res.status === 403) {
      res = await fetch(full, {
        headers: { Authorization: `Bearer ${this.config.token}` },
        signal: opts?.signal
      });
    }
    if (!res.ok) {
      throw new PixelLabError(
        `Download failed (${res.status}) for ${full}`,
        res.status,
        await res.text().catch(() => "")
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  /** Create a character, poll to completion, and download all rotation images. */
  async createCharacterAndWait(input, opts = {}) {
    const sub = await this.createCharacterV3(input, { signal: opts.signal });
    const job = await this.pollJob(sub.jobId, opts);
    if (job.status !== "completed") {
      throw new Error(`Character job ${sub.jobId} ended with status "${job.status}"`);
    }
    const character = await this.getCharacter(sub.characterId, { signal: opts.signal });
    const rotations = {};
    for (const [dir, url] of Object.entries(character.rotation_urls)) {
      if (typeof url === "string" && url) {
        rotations[dir] = await this.downloadUrl(url, { signal: opts.signal });
      }
    }
    return { character, rotations, usage: sub.usage };
  }
  // ---- objects (mirror characters) ----
  async createObject(input, opts) {
    const endpoint = input.directions === 1 ? "/create-1-direction-object" : "/create-8-direction-object";
    const body = { description: input.description };
    if (input.size) body.size = input.size;
    if (input.view) body.view = input.view;
    if (input.referenceImageBase64) body.reference_image = { base64: input.referenceImageBase64 };
    if (input.styleImageBase64) body.style_image = { base64: input.styleImageBase64 };
    const { data } = await this.request("POST", endpoint, body, opts);
    return {
      objectId: data.object_id,
      jobId: data.background_job_id,
      status: data.status,
      usage: data.usage ?? null
    };
  }
  async getObject(id, opts) {
    const { data } = await this.request("GET", `/objects/${id}`, void 0, opts);
    return data;
  }
  async listObjects(opts) {
    const { data } = await this.request(
      "GET",
      "/objects",
      void 0,
      opts
    );
    return data.objects ?? [];
  }
  async deleteObject(id, opts) {
    await this.request("DELETE", `/objects/${id}`, void 0, opts);
  }
  async createObjectAndWait(input, opts = {}) {
    const sub = await this.createObject(input, { signal: opts.signal });
    const job = await this.pollJob(sub.jobId, opts);
    if (job.status !== "completed") {
      throw new Error(`Object job ${sub.jobId} ended with status "${job.status}"`);
    }
    const object = await this.getObject(sub.objectId, { signal: opts.signal });
    const rotations = {};
    const sources = {
      ...object.rotation_urls,
      ...object.storage_urls ?? {}
    };
    for (const [dir, url] of Object.entries(sources)) {
      if (typeof url === "string" && url) {
        rotations[dir] = await this.downloadUrl(url, { signal: opts.signal });
      }
    }
    const frames = [];
    if (object.status === "review" && object.frame_urls?.length) {
      for (const url of object.frame_urls) {
        if (typeof url === "string" && url) {
          frames.push(await this.downloadUrl(url, { signal: opts.signal }));
        }
      }
    }
    return { object, rotations, frames, status: object.status ?? null, usage: sub.usage };
  }
  /**
   * Pick which candidate frames of a `review`-status object to keep. Each chosen
   * index becomes its own completed single-direction object.
   */
  async selectObjectFrames(objectId, indices, commonTag, opts) {
    const body = { indices };
    if (commonTag) body.common_tag = commonTag;
    const { data } = await this.request("POST", `/objects/${objectId}/select-frames`, body, opts);
    return { createdObjectIds: data.created_object_ids ?? [], usage: data.usage ?? null };
  }
  // ---- character animations (async, one job per direction) ----
  async animateCharacter(input, opts) {
    const body = {
      character_id: input.characterId,
      action_description: input.actionDescription,
      enhance_prompt: input.enhancePrompt ?? true
    };
    if (input.animationName) body.animation_name = input.animationName;
    if (input.mode) body.mode = input.mode;
    if (input.templateAnimationId) body.template_animation_id = input.templateAnimationId;
    if (input.frameCount !== void 0) body.frame_count = input.frameCount;
    if (input.directions && input.directions.length) body.directions = input.directions;
    if (input.seed !== void 0) body.seed = input.seed;
    const { data } = await this.request("POST", "/animate-character", body, opts);
    return {
      jobIds: data.background_job_ids ?? [],
      directions: data.directions ?? [],
      status: data.status,
      usage: data.usage ?? null
    };
  }
  /** Submit an animation and poll every per-direction job to completion. */
  async animateCharacterAndWait(input, opts = {}) {
    const sub = await this.animateCharacter(input, { signal: opts.signal });
    await Promise.all(sub.jobIds.map((id) => this.pollJob(id, opts)));
    const character = await this.getCharacter(input.characterId, { signal: opts.signal });
    return { character, directions: sub.directions, jobIds: sub.jobIds };
  }
  // ---- single-image generation & editing ----
  /** Submit an async image job, poll it, and collect the resulting image(s). */
  async runImageJob(endpoint, body, opts) {
    const submit = await this.request("POST", endpoint, body, { signal: opts.signal });
    const job = await this.pollJob(submit.data.background_job_id, opts);
    if (job.status !== "completed") {
      throw new Error(`${endpoint} job ${submit.data.background_job_id} ended with status "${job.status}"`);
    }
    const lr = job.lastResponse ?? {};
    const images = lr.images ?? (lr.image ? [lr.image] : []);
    return { images, usage: job.usage };
  }
  /** Pixen text->image (synchronous). */
  async generatePixen(input, opts) {
    const body = {
      description: input.description,
      image_size: { width: input.width ?? 64, height: input.height ?? 64 }
    };
    if (input.noBackground !== void 0) body.no_background = input.noBackground;
    if (input.seed !== void 0) body.seed = input.seed;
    const { data } = await this.request(
      "POST",
      "/create-image-pixen",
      body,
      opts
    );
    return { image: data.image, usage: data.usage ?? null };
  }
  /** Convert an image to pixel art (synchronous). */
  async imageToPixelart(input, opts) {
    const body = {
      image: { base64: input.imageBase64 },
      image_size: { width: input.width, height: input.height },
      output_size: { width: input.outputWidth ?? input.width, height: input.outputHeight ?? input.height }
    };
    const { data } = await this.request(
      "POST",
      "/image-to-pixelart",
      body,
      opts
    );
    return { image: data.image, usage: data.usage ?? null };
  }
  /** Remove background (synchronous). */
  async removeBackground(input, opts) {
    const body = { image: { base64: input.imageBase64 }, image_size: { width: input.width, height: input.height } };
    const { data } = await this.request(
      "POST",
      "/remove-background",
      body,
      opts
    );
    return { image: data.image, usage: data.usage ?? null };
  }
  /** Rotate an object/character image (synchronous). */
  async rotate(input, opts) {
    const body = {
      from_image: { base64: input.imageBase64 },
      image_size: { width: input.width, height: input.height }
    };
    if (input.fromDirection) body.from_direction = input.fromDirection;
    if (input.toDirection) body.to_direction = input.toDirection;
    const { data } = await this.request(
      "POST",
      "/rotate",
      body,
      opts
    );
    return { image: data.image, usage: data.usage ?? null };
  }
  /** Intelligently resize pixel art (synchronous). */
  async resize(input, opts) {
    const body = {
      description: input.description,
      reference_image: { base64: input.imageBase64 },
      reference_image_size: { width: input.width, height: input.height },
      target_size: { width: input.targetWidth, height: input.targetHeight }
    };
    const { data } = await this.request(
      "POST",
      "/resize",
      body,
      opts
    );
    return { image: data.image, usage: data.usage ?? null };
  }
  /** Edit an image from a text description (async, Pro). */
  async editImage(input, opts = {}) {
    const body = {
      image: { base64: input.imageBase64 },
      image_size: { width: input.width, height: input.height },
      description: input.description,
      width: input.width,
      height: input.height
    };
    const { images, usage } = await this.runImageJob("/edit-image", body, opts);
    return { image: images[0] ?? null, usage };
  }
  /** Generate pixel-art UI elements (async, Pro). */
  async generateUI(input, opts = {}) {
    const body = { description: input.description };
    if (input.width || input.height) {
      body.image_size = { width: input.width ?? 64, height: input.height ?? 64 };
    }
    return this.runImageJob("/generate-ui-v2", body, opts);
  }
  /**
   * Inpaint: regenerate the masked region of an image from a description (synchronous).
   * `maskImageBase64` is a black/white mask — white pixels are repainted.
   */
  async inpaint(input, opts) {
    const body = {
      description: input.description,
      image_size: { width: input.width, height: input.height },
      inpainting_image: { base64: input.imageBase64 },
      mask_image: { base64: input.maskBase64 }
    };
    if (input.noBackground !== void 0) body.no_background = input.noBackground;
    if (input.seed !== void 0) body.seed = input.seed;
    const { data } = await this.request(
      "POST",
      "/inpaint",
      body,
      opts
    );
    return { image: data.image ?? null, usage: data.usage ?? null };
  }
  // ---- tilesets (scenes) ----
  async createTileset(input, opts) {
    const sidescroller = input.kind === "sidescroller";
    const body = {
      lower_description: input.lowerDescription,
      tile_size: { width: input.tileWidth ?? 16, height: input.tileHeight ?? 16 }
    };
    if (!sidescroller) {
      body.upper_description = input.upperDescription ?? input.lowerDescription;
      if (input.view) body.view = input.view;
    }
    if (input.transitionDescription) body.transition_description = input.transitionDescription;
    if (input.seed !== void 0) body.seed = input.seed;
    const endpoint = sidescroller ? "/create-tileset-sidescroller" : "/create-tileset";
    const { data } = await this.request("POST", endpoint, body, opts);
    return {
      tilesetId: data.tileset_id,
      jobId: data.background_job_id,
      status: data.status,
      usage: data.usage ?? null
    };
  }
  async getTileset(id, opts) {
    const { data } = await this.request("GET", `/tilesets/${id}`, void 0, opts);
    return data;
  }
  async listTilesets(opts) {
    const { data } = await this.request(
      "GET",
      "/tilesets",
      void 0,
      opts
    );
    return data.tilesets ?? [];
  }
  async createTilesetAndWait(input, opts = {}) {
    const sub = await this.createTileset(input, { signal: opts.signal });
    const job = await this.pollJob(sub.jobId, opts);
    if (job.status !== "completed") {
      throw new Error(`Tileset job ${sub.jobId} ended with status "${job.status}"`);
    }
    const detail = await this.getTileset(sub.tilesetId, { signal: opts.signal });
    return {
      tilesetId: sub.tilesetId,
      tiles: detail.tileset.tiles ?? [],
      tileSize: detail.tileset.tile_size,
      totalTiles: detail.tileset.total_tiles,
      terrainTypes: detail.tileset.terrain_types ?? [],
      usage: sub.usage
    };
  }
  // ---- isometric tiles (async, single image) ----
  async createIsometricTile(input, opts) {
    const size = input.size ?? 32;
    const body = {
      description: input.description,
      image_size: { width: size, height: size }
    };
    if (input.shape) body.isometric_tile_shape = input.shape;
    if (input.tileSize) body.isometric_tile_size = input.tileSize;
    if (input.seed !== void 0) body.seed = input.seed;
    const { data } = await this.request("POST", "/create-isometric-tile", body, opts);
    return {
      tileId: data.tile_id,
      jobId: data.background_job_id,
      status: data.status,
      usage: data.usage ?? null
    };
  }
  async getIsometricTile(id, opts) {
    const { data } = await this.request(
      "GET",
      `/isometric-tiles/${id}`,
      void 0,
      opts
    );
    return { image: data.image ?? null, usage: data.usage ?? null };
  }
  async createIsometricTileAndWait(input, opts = {}) {
    const sub = await this.createIsometricTile(input, { signal: opts.signal });
    const job = await this.pollJob(sub.jobId, opts);
    if (job.status !== "completed") {
      throw new Error(`Isometric tile job ${sub.jobId} ended with status "${job.status}"`);
    }
    const { image, usage } = await this.getIsometricTile(sub.tileId, { signal: opts.signal });
    return { tileId: sub.tileId, image, usage: usage ?? sub.usage };
  }
}
function loadDotEnv(startDir = process.cwd(), maxDepth = 6) {
  let dir = startDir;
  for (let i = 0; i < maxDepth; i++) {
    const file = node_path.join(dir, ".env");
    if (node_fs.existsSync(file)) {
      for (const raw of node_fs.readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
        if (!m) continue;
        const key = m[1];
        let val = m[2];
        if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === void 0) process.env[key] = val;
      }
      return;
    }
    const parent = node_path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
function formatUsage(usage) {
  if (!usage) return "unknown";
  if (usage.type === "generations") return `${usage.generations ?? 0} generations`;
  return `$${(usage.usd ?? 0).toFixed(4)}`;
}
const DEFAULT_SIZE = { width: 64, height: 64 };
const MAX_REFS = 4;
const MANIFEST = "project.json";
const LIBRARY = "library.json";
const CHARACTERS = "characters.json";
const OBJECTS = "objects.json";
const OBJECT_REVIEWS = "object-reviews.json";
const TILESETS = "tilesets.json";
const STYLE_GUIDE = "STYLE_GUIDE.md";
function now$1() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
class Project {
  dir;
  manifest;
  library;
  characters;
  objects;
  objectReviews;
  tilesets;
  constructor(dir, manifest, library, characters, objects, objectReviews, tilesets) {
    this.dir = dir;
    this.manifest = manifest;
    this.library = library;
    this.characters = characters;
    this.objects = objects;
    this.objectReviews = objectReviews;
    this.tilesets = tilesets;
  }
  static load(dir) {
    const manifest = JSON.parse(node_fs.readFileSync(node_path.join(dir, MANIFEST), "utf8"));
    const readJson = (name, fallback) => {
      const p = node_path.join(dir, name);
      return node_fs.existsSync(p) ? JSON.parse(node_fs.readFileSync(p, "utf8")) : fallback;
    };
    return new Project(
      dir,
      manifest,
      readJson(LIBRARY, []),
      readJson(CHARACTERS, []),
      readJson(OBJECTS, []),
      readJson(OBJECT_REVIEWS, []),
      readJson(TILESETS, [])
    );
  }
  static create(dir, manifest) {
    node_fs.mkdirSync(node_path.join(dir, "refs"), { recursive: true });
    node_fs.mkdirSync(node_path.join(dir, "assets"), { recursive: true });
    node_fs.mkdirSync(node_path.join(dir, "characters"), { recursive: true });
    node_fs.mkdirSync(node_path.join(dir, "objects"), { recursive: true });
    node_fs.mkdirSync(node_path.join(dir, "tilesets"), { recursive: true });
    const p = new Project(dir, manifest, [], [], [], [], []);
    p.saveManifest();
    p.saveLibrary();
    node_fs.writeFileSync(
      node_path.join(dir, STYLE_GUIDE),
      `# Style Guide — ${manifest.name}

_What works, what to avoid, palette notes. Grows as you approve/reject assets._
`
    );
    return p;
  }
  // ---- manifest / style ----
  get id() {
    return this.manifest.id;
  }
  get slug() {
    return this.manifest.slug;
  }
  get name() {
    return this.manifest.name;
  }
  get createdAt() {
    return this.manifest.createdAt;
  }
  getManifest() {
    return structuredClone(this.manifest);
  }
  getStyle() {
    return structuredClone(this.manifest.style);
  }
  setStyle(patch) {
    this.manifest.style = { ...this.manifest.style, ...patch };
    this.saveManifest();
    return this.getStyle();
  }
  get styleGuidePath() {
    return node_path.join(this.dir, STYLE_GUIDE);
  }
  readStyleGuide() {
    return node_fs.existsSync(this.styleGuidePath) ? node_fs.readFileSync(this.styleGuidePath, "utf8") : "";
  }
  writeStyleGuide(content) {
    node_fs.writeFileSync(this.styleGuidePath, content);
  }
  // ---- refs ----
  /** Add a style reference from raw PNG bytes. Enforces the 4-ref cap. */
  addRefFromBytes(bytes, opts = {}) {
    if (this.manifest.style.refs.length >= MAX_REFS) {
      throw new Error(`Style contract already has the maximum of ${MAX_REFS} references`);
    }
    const dims = pngSize(bytes);
    if (!dims) throw new Error("Reference is not a readable PNG");
    const id = crypto.randomUUID();
    const file = node_path.join("refs", `${id}.png`);
    node_fs.writeFileSync(node_path.join(this.dir, file), bytes);
    const meta = {
      file,
      width: dims.width,
      height: dims.height,
      addedAt: now$1(),
      ...opts.fromAssetId ? { fromAssetId: opts.fromAssetId } : {}
    };
    this.manifest.style.refs.push(meta);
    this.saveManifest();
    return meta;
  }
  removeRef(file) {
    const before = this.manifest.style.refs.length;
    this.manifest.style.refs = this.manifest.style.refs.filter((r) => r.file !== file);
    if (this.manifest.style.refs.length === before) return;
    const abs = node_path.join(this.dir, file);
    if (node_fs.existsSync(abs)) node_fs.rmSync(abs);
    this.saveManifest();
  }
  /** Load the active style references as base64 + dims for the API. */
  loadRefs() {
    return this.manifest.style.refs.map((r) => ({
      base64: node_fs.readFileSync(node_path.join(this.dir, r.file)).toString("base64"),
      width: r.width,
      height: r.height
    }));
  }
  // ---- assets ----
  listAssets() {
    return this.library.map((a) => structuredClone(a));
  }
  getAsset(id) {
    const a = this.library.find((x) => x.id === id);
    return a ? structuredClone(a) : void 0;
  }
  readAssetBytes(id) {
    const a = this.requireAsset(id);
    return new Uint8Array(node_fs.readFileSync(node_path.join(this.dir, a.file)));
  }
  /** Persist a generated image + its metadata as a draft asset. */
  addAsset(input) {
    const id = crypto.randomUUID();
    const file = node_path.join("assets", `${id}.png`);
    node_fs.writeFileSync(node_path.join(this.dir, file), input.bytes);
    const record = {
      id,
      kind: "image",
      file,
      status: input.status ?? "draft",
      prompt: input.prompt,
      endpoint: input.endpoint,
      params: input.params,
      usage: input.usage ?? null,
      ...input.seed !== void 0 ? { seed: input.seed } : {},
      size: input.size,
      ...input.parentId ? { parentId: input.parentId } : {},
      createdAt: now$1()
    };
    this.library.unshift(record);
    this.saveLibrary();
    return structuredClone(record);
  }
  setAssetStatus(id, status) {
    const a = this.requireAsset(id);
    a.status = status;
    this.saveLibrary();
    return structuredClone(a);
  }
  rateAsset(id, rating) {
    const a = this.requireAsset(id);
    a.rating = rating;
    this.saveLibrary();
    return structuredClone(a);
  }
  setAssetNote(id, note) {
    const a = this.requireAsset(id);
    a.note = note;
    this.saveLibrary();
    return structuredClone(a);
  }
  /** Approve an asset and add it to the style references in one step. */
  promoteAssetToRef(id) {
    const a = this.requireAsset(id);
    a.status = "approved";
    this.saveLibrary();
    return this.addRefFromBytes(this.readAssetBytes(id), { fromAssetId: id });
  }
  // ---- characters ----
  listCharacters() {
    return this.characters.map((c) => structuredClone(c));
  }
  getCharacter(id) {
    const c = this.characters.find((x) => x.id === id);
    return c ? structuredClone(c) : void 0;
  }
  readCharacterImage(id, direction) {
    const c = this.characters.find((x) => x.id === id);
    const file = c?.rotations[direction];
    if (!file) throw new Error(`No "${direction}" rotation for character ${id}`);
    return new Uint8Array(node_fs.readFileSync(node_path.join(this.dir, file)));
  }
  /** Persist a generated character + its rotation images. */
  addCharacter(input) {
    const dir = node_path.join("characters", input.id);
    node_fs.mkdirSync(node_path.join(this.dir, dir), { recursive: true });
    const rotations = {};
    for (const [d, bytes] of Object.entries(input.rotations)) {
      const file = node_path.join(dir, `${d}.png`);
      node_fs.writeFileSync(node_path.join(this.dir, file), bytes);
      rotations[d] = file;
    }
    const record = {
      id: input.id,
      name: input.name,
      prompt: input.prompt,
      size: input.size,
      directions: input.directions,
      ...input.view ? { view: input.view } : {},
      rotations,
      usage: input.usage ?? null,
      createdAt: now$1()
    };
    this.characters = this.characters.filter((c) => c.id !== record.id);
    this.characters.unshift(record);
    this.saveCharacters();
    return structuredClone(record);
  }
  deleteCharacter(id) {
    const before = this.characters.length;
    this.characters = this.characters.filter((c) => c.id !== id);
    if (this.characters.length === before) return;
    const dir = node_path.join(this.dir, "characters", id);
    if (node_fs.existsSync(dir)) node_fs.rmSync(dir, { recursive: true, force: true });
    this.saveCharacters();
  }
  /** Persist a character animation's downloaded frames (per direction). */
  addCharacterAnimation(characterId, anim) {
    const c = this.characters.find((x) => x.id === characterId);
    if (!c) return;
    const baseDir = node_path.join("characters", characterId, "animations", anim.type);
    const frames = {};
    for (const [dir, frameList] of Object.entries(anim.frames)) {
      const dirRel = node_path.join(baseDir, dir);
      node_fs.mkdirSync(node_path.join(this.dir, dirRel), { recursive: true });
      frames[dir] = frameList.map((bytes, i) => {
        const file = node_path.join(dirRel, `${i}.png`);
        node_fs.writeFileSync(node_path.join(this.dir, file), bytes);
        return file;
      });
    }
    const record = {
      type: anim.type,
      ...anim.displayName ? { displayName: anim.displayName } : {},
      frames
    };
    c.animations = [...(c.animations ?? []).filter((a) => a.type !== anim.type), record];
    this.saveCharacters();
  }
  readAnimationFrame(characterId, animType, direction, frameIndex) {
    const file = this.characters.find((x) => x.id === characterId)?.animations?.find((a) => a.type === animType)?.frames[direction]?.[frameIndex];
    if (!file) {
      throw new Error(`No animation frame ${animType}/${direction}/${frameIndex} for ${characterId}`);
    }
    return new Uint8Array(node_fs.readFileSync(node_path.join(this.dir, file)));
  }
  // ---- objects (mirror characters) ----
  listObjects() {
    return this.objects.map((o) => structuredClone(o));
  }
  getObject(id) {
    const o = this.objects.find((x) => x.id === id);
    return o ? structuredClone(o) : void 0;
  }
  readObjectImage(id, direction) {
    const o = this.objects.find((x) => x.id === id);
    const file = o?.rotations[direction];
    if (!file) throw new Error(`No "${direction}" rotation for object ${id}`);
    return new Uint8Array(node_fs.readFileSync(node_path.join(this.dir, file)));
  }
  addObject(input) {
    const dir = node_path.join("objects", input.id);
    node_fs.mkdirSync(node_path.join(this.dir, dir), { recursive: true });
    const rotations = {};
    for (const [d, bytes] of Object.entries(input.rotations)) {
      const file = node_path.join(dir, `${d}.png`);
      node_fs.writeFileSync(node_path.join(this.dir, file), bytes);
      rotations[d] = file;
    }
    const record = {
      id: input.id,
      name: input.name,
      prompt: input.prompt,
      size: input.size,
      directions: input.directions,
      ...input.view ? { view: input.view } : {},
      rotations,
      usage: input.usage ?? null,
      createdAt: now$1()
    };
    this.objects = this.objects.filter((o) => o.id !== record.id);
    this.objects.unshift(record);
    this.saveObjects();
    return structuredClone(record);
  }
  deleteObject(id) {
    const before = this.objects.length;
    this.objects = this.objects.filter((o) => o.id !== id);
    if (this.objects.length === before) return;
    const dir = node_path.join(this.dir, "objects", id);
    if (node_fs.existsSync(dir)) node_fs.rmSync(dir, { recursive: true, force: true });
    this.saveObjects();
  }
  // ---- object reviews (1-direction candidate frames awaiting selection) ----
  listObjectReviews() {
    return this.objectReviews.map((r) => structuredClone(r));
  }
  getObjectReview(id) {
    const r = this.objectReviews.find((x) => x.id === id);
    return r ? structuredClone(r) : void 0;
  }
  readObjectReviewFrame(objectId, frameIndex) {
    const file = this.objectReviews.find((x) => x.id === objectId)?.frames[frameIndex];
    if (!file) throw new Error(`No review frame ${frameIndex} for object ${objectId}`);
    return new Uint8Array(node_fs.readFileSync(node_path.join(this.dir, file)));
  }
  /** Persist the candidate frames of a review-status object for later selection. */
  addObjectReview(input) {
    const dir = node_path.join("objects", "_reviews", input.id);
    node_fs.mkdirSync(node_path.join(this.dir, dir), { recursive: true });
    const frames = input.frames.map((bytes, i) => {
      const file = node_path.join(dir, `${i}.png`);
      node_fs.writeFileSync(node_path.join(this.dir, file), bytes);
      return file;
    });
    const record = {
      id: input.id,
      prompt: input.prompt,
      size: input.size,
      ...input.view ? { view: input.view } : {},
      frames,
      createdAt: now$1()
    };
    this.objectReviews = this.objectReviews.filter((r) => r.id !== record.id);
    this.objectReviews.unshift(record);
    this.saveObjectReviews();
    return structuredClone(record);
  }
  deleteObjectReview(id) {
    const before = this.objectReviews.length;
    this.objectReviews = this.objectReviews.filter((r) => r.id !== id);
    if (this.objectReviews.length === before) return;
    const dir = node_path.join(this.dir, "objects", "_reviews", id);
    if (node_fs.existsSync(dir)) node_fs.rmSync(dir, { recursive: true, force: true });
    this.saveObjectReviews();
  }
  // ---- tilesets ----
  listTilesets() {
    return this.tilesets.map((t) => structuredClone(t));
  }
  getTileset(id) {
    const t = this.tilesets.find((x) => x.id === id);
    return t ? structuredClone(t) : void 0;
  }
  readTileImage(tilesetId, tileId) {
    const file = this.tilesets.find((x) => x.id === tilesetId)?.tiles.find((t) => t.id === tileId)?.file;
    if (!file) throw new Error(`No tile ${tileId} in tileset ${tilesetId}`);
    return new Uint8Array(node_fs.readFileSync(node_path.join(this.dir, file)));
  }
  addTileset(input) {
    const dir = node_path.join("tilesets", input.id);
    node_fs.mkdirSync(node_path.join(this.dir, dir), { recursive: true });
    const tiles = input.tiles.map((t) => {
      const file = node_path.join(dir, `${t.id}.png`);
      node_fs.writeFileSync(node_path.join(this.dir, file), t.bytes);
      return { id: t.id, name: t.name, file, ...t.description ? { description: t.description } : {} };
    });
    const record = {
      id: input.id,
      lowerDescription: input.lowerDescription,
      upperDescription: input.upperDescription,
      tileSize: input.tileSize,
      totalTiles: input.totalTiles,
      terrainTypes: input.terrainTypes,
      tiles,
      usage: input.usage ?? null,
      createdAt: now$1()
    };
    this.tilesets = this.tilesets.filter((t) => t.id !== record.id);
    this.tilesets.unshift(record);
    this.saveTilesets();
    return structuredClone(record);
  }
  deleteTileset(id) {
    const before = this.tilesets.length;
    this.tilesets = this.tilesets.filter((t) => t.id !== id);
    if (this.tilesets.length === before) return;
    const dir = node_path.join(this.dir, "tilesets", id);
    if (node_fs.existsSync(dir)) node_fs.rmSync(dir, { recursive: true, force: true });
    this.saveTilesets();
  }
  // ---- internals ----
  requireAsset(id) {
    const a = this.library.find((x) => x.id === id);
    if (!a) throw new Error(`Asset not found: ${id}`);
    return a;
  }
  saveManifest() {
    node_fs.writeFileSync(node_path.join(this.dir, MANIFEST), JSON.stringify(this.manifest, null, 2));
  }
  saveLibrary() {
    node_fs.writeFileSync(node_path.join(this.dir, LIBRARY), JSON.stringify(this.library, null, 2));
  }
  saveCharacters() {
    node_fs.writeFileSync(node_path.join(this.dir, CHARACTERS), JSON.stringify(this.characters, null, 2));
  }
  saveObjects() {
    node_fs.writeFileSync(node_path.join(this.dir, OBJECTS), JSON.stringify(this.objects, null, 2));
  }
  saveObjectReviews() {
    node_fs.writeFileSync(node_path.join(this.dir, OBJECT_REVIEWS), JSON.stringify(this.objectReviews, null, 2));
  }
  saveTilesets() {
    node_fs.writeFileSync(node_path.join(this.dir, TILESETS), JSON.stringify(this.tilesets, null, 2));
  }
  summaryCounts() {
    return {
      assetCount: this.library.length,
      refCount: this.manifest.style.refs.length,
      characterCount: this.characters.length,
      objectCount: this.objects.length,
      tilesetCount: this.tilesets.length
    };
  }
}
function defaultProjectsRoot() {
  return process.env.PIXELLABRAT_PROJECTS_DIR ?? node_path.join(process.cwd(), "projects");
}
function slugify(name) {
  return name.toLowerCase().normalize("NFKD").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
}
function uniqueSlug(root, base) {
  let slug = base;
  let n = 2;
  while (node_fs.existsSync(node_path.join(root, slug))) {
    slug = `${base}-${n++}`;
  }
  return slug;
}
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
class Store {
  root;
  constructor(root = defaultProjectsRoot()) {
    this.root = root;
    node_fs.mkdirSync(this.root, { recursive: true });
  }
  slugDirs() {
    return node_fs.readdirSync(this.root).filter((name) => {
      const dir = node_path.join(this.root, name);
      return node_fs.statSync(dir).isDirectory() && node_fs.existsSync(node_path.join(dir, "project.json"));
    });
  }
  list() {
    return this.slugDirs().map((slug) => {
      const p = Project.load(node_path.join(this.root, slug));
      const counts = p.summaryCounts();
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        createdAt: p.createdAt,
        ...counts
      };
    }).sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
  }
  createProject(name) {
    const slug = uniqueSlug(this.root, slugify(name));
    const manifest = {
      id: crypto.randomUUID(),
      slug,
      name: name.trim() || slug,
      createdAt: now(),
      style: { refs: [], defaultSize: { ...DEFAULT_SIZE } }
    };
    return Project.create(node_path.join(this.root, slug), manifest);
  }
  open(slug) {
    const dir = node_path.join(this.root, slug);
    if (!node_fs.existsSync(node_path.join(dir, "project.json"))) {
      throw new Error(`No project at slug "${slug}" under ${this.root}`);
    }
    return Project.load(dir);
  }
  openById(id) {
    for (const slug of this.slugDirs()) {
      const p = Project.load(node_path.join(this.root, slug));
      if (p.id === id) return p;
    }
    throw new Error(`No project with id ${id}`);
  }
  delete(slug) {
    const dir = node_path.join(this.root, slug);
    if (node_fs.existsSync(dir)) node_fs.rmSync(dir, { recursive: true, force: true });
  }
}
function openStore(root) {
  return new Store(root);
}
async function generateForProject(client2, project, input, pollOpts) {
  const style = project.getStyle();
  const size = input.size ?? style.defaultSize;
  if (style.refs.length > 0) {
    const styleImages = project.loadRefs();
    const res2 = await client2.generateWithStyle(
      {
        description: input.description,
        styleImages,
        width: size.width,
        height: size.height,
        styleDescription: style.styleDescription,
        noBackground: style.noBackground,
        seed: input.seed
      },
      pollOpts ?? {}
    );
    const first = res2.images[0];
    if (!first) throw new Error("Style generation returned no images");
    const asset2 = project.addAsset({
      bytes: base64ToBytes(first.base64),
      prompt: input.description,
      endpoint: "generate-with-style-v2",
      params: {
        styleRefs: style.refs.map((r) => r.file),
        styleDescription: style.styleDescription,
        noBackground: style.noBackground
      },
      usage: res2.usage,
      seed: res2.seed ?? input.seed,
      size
    });
    return { asset: asset2, mode: "generate-with-style-v2", candidates: res2.images.length };
  }
  const res = await client2.generatePixflux({
    description: input.description,
    width: size.width,
    height: size.height,
    noBackground: style.noBackground,
    seed: input.seed
  });
  const asset = project.addAsset({
    bytes: base64ToBytes(res.image.base64),
    prompt: input.description,
    endpoint: "create-image-pixflux",
    params: { noBackground: style.noBackground },
    usage: res.usage,
    seed: input.seed,
    size
  });
  return { asset, mode: "create-image-pixflux", candidates: 1 };
}
async function createCharacterForProject(client2, project, input, pollOpts) {
  const style = project.getStyle();
  const size = input.size ?? style.defaultSize;
  const description = style.styleDescription ? `${input.description}. Style: ${style.styleDescription}` : input.description;
  const view = input.view ?? style.view;
  const res = await client2.createCharacterAndWait(
    {
      description,
      width: size.width,
      height: size.height,
      ...view ? { view } : {},
      noBackground: style.noBackground,
      seed: input.seed,
      enhancePrompt: true
    },
    pollOpts ?? {}
  );
  const character = project.addCharacter({
    id: res.character.id,
    name: res.character.name,
    prompt: res.character.prompt,
    size: res.character.size,
    directions: res.character.directions,
    view: res.character.view ?? void 0,
    rotations: res.rotations,
    usage: res.usage
  });
  return { character, directionsDownloaded: Object.keys(res.rotations).length };
}
async function createObjectForProject(client2, project, input, pollOpts) {
  const style = project.getStyle();
  const size = input.size ?? style.defaultSize.width;
  const view = input.view ?? style.view;
  const description = style.styleDescription ? `${input.description}. Style: ${style.styleDescription}` : input.description;
  const res = await client2.createObjectAndWait(
    {
      description,
      size,
      directions: input.directions ?? 8,
      ...view ? { view } : {}
    },
    pollOpts ?? {}
  );
  if (res.status === "review" && res.frames.length) {
    const review = project.addObjectReview({
      id: res.object.id,
      prompt: input.description,
      size,
      view: res.object.view ?? view ?? void 0,
      frames: res.frames
    });
    return { directionsDownloaded: 0, review };
  }
  const object = project.addObject({
    id: res.object.id,
    name: res.object.name ?? input.description.slice(0, 50),
    prompt: res.object.prompt,
    size: res.object.size,
    directions: res.object.directions,
    view: res.object.view ?? void 0,
    rotations: res.rotations,
    usage: res.usage
  });
  return { object, directionsDownloaded: Object.keys(res.rotations).length };
}
async function selectObjectFramesForProject(client2, project, objectId, indices, pollOpts) {
  const review = project.getObjectReview(objectId);
  if (!review) throw new Error(`No pending object review: ${objectId}`);
  const { createdObjectIds } = await client2.selectObjectFrames(objectId, indices);
  const objects = [];
  for (const id of createdObjectIds) {
    const detail = await client2.getObject(id, { signal: pollOpts?.signal });
    const sources = {
      ...detail.rotation_urls,
      ...detail.storage_urls ?? {}
    };
    const rotations = {};
    for (const [dir, url] of Object.entries(sources)) {
      if (typeof url === "string" && url) {
        rotations[dir] = await client2.downloadUrl(url, { signal: pollOpts?.signal });
      }
    }
    objects.push(
      project.addObject({
        id: detail.id,
        name: detail.name ?? review.prompt.slice(0, 50),
        prompt: detail.prompt ?? review.prompt,
        size: detail.size ?? { width: review.size, height: review.size },
        directions: detail.directions ?? 1,
        view: detail.view ?? review.view ?? void 0,
        rotations
      })
    );
  }
  project.deleteObjectReview(objectId);
  return { objects };
}
async function animateCharacterForProject(client2, project, input, pollOpts) {
  const res = await client2.animateCharacterAndWait(
    {
      characterId: input.characterId,
      actionDescription: input.actionDescription,
      animationName: input.animationName,
      frameCount: input.frameCount,
      ...input.directions?.length ? { directions: input.directions } : {},
      enhancePrompt: true
    },
    pollOpts ?? {}
  );
  const name = input.animationName ?? input.actionDescription;
  const groups = res.character.animations ?? [];
  const group = groups.find((g) => g.display_name === name) ?? groups.find((g) => g.animation_type === name) ?? groups[groups.length - 1];
  if (!group) return { name, directions: [], frameCount: 0 };
  const frames = {};
  for (const d of group.directions) {
    const downloaded = [];
    for (const url of d.frames) downloaded.push(await client2.downloadUrl(url));
    frames[d.direction] = downloaded;
  }
  project.addCharacterAnimation(input.characterId, {
    type: group.animation_type,
    displayName: group.display_name ?? input.animationName ?? input.actionDescription,
    frames
  });
  const frameCount = Object.values(frames).reduce((sum, f) => sum + f.length, 0);
  return { name: group.display_name ?? group.animation_type, directions: Object.keys(frames), frameCount };
}
async function generateUIForProject(client2, project, input, pollOpts) {
  const size = input.size ?? project.getStyle().defaultSize;
  const { images, usage } = await client2.generateUI(
    { description: input.description, width: size.width, height: size.height },
    pollOpts ?? {}
  );
  const img = images[0];
  if (!img) throw new Error("UI generation returned no images");
  return project.addAsset({
    bytes: base64ToBytes(img.base64),
    prompt: input.description,
    endpoint: "generate-ui-v2",
    params: {},
    usage,
    size
  });
}
async function editAssetForProject(client2, project, assetId, spec, pollOpts) {
  const src = project.getAsset(assetId);
  if (!src) throw new Error(`Asset not found: ${assetId}`);
  const base64 = Buffer.from(project.readAssetBytes(assetId)).toString("base64");
  const w = src.size.width;
  const h = src.size.height;
  let image = null;
  let usage = null;
  let endpoint = spec.op;
  let outSize = { width: w, height: h };
  switch (spec.op) {
    case "remove-background": {
      const r = await client2.removeBackground({ imageBase64: base64, width: w, height: h });
      image = r.image;
      usage = r.usage;
      endpoint = "remove-background";
      break;
    }
    case "image-to-pixelart": {
      outSize = { width: spec.outputWidth ?? w, height: spec.outputHeight ?? h };
      const r = await client2.imageToPixelart({
        imageBase64: base64,
        width: w,
        height: h,
        outputWidth: outSize.width,
        outputHeight: outSize.height
      });
      image = r.image;
      usage = r.usage;
      endpoint = "image-to-pixelart";
      break;
    }
    case "edit": {
      const r = await client2.editImage(
        { imageBase64: base64, width: w, height: h, description: spec.description },
        pollOpts ?? {}
      );
      image = r.image;
      usage = r.usage;
      endpoint = "edit-image";
      break;
    }
    case "rotate": {
      const r = await client2.rotate({
        imageBase64: base64,
        width: w,
        height: h,
        fromDirection: spec.fromDirection,
        toDirection: spec.toDirection
      });
      image = r.image;
      usage = r.usage;
      endpoint = "rotate";
      break;
    }
    case "resize": {
      outSize = { width: spec.targetWidth, height: spec.targetHeight };
      const r = await client2.resize({
        imageBase64: base64,
        width: w,
        height: h,
        targetWidth: spec.targetWidth,
        targetHeight: spec.targetHeight,
        description: spec.description ?? src.prompt
      });
      image = r.image;
      usage = r.usage;
      endpoint = "resize";
      break;
    }
  }
  if (!image) throw new Error(`${spec.op} returned no image`);
  return project.addAsset({
    bytes: base64ToBytes(image.base64),
    prompt: `${spec.op}: ${src.prompt}`,
    endpoint,
    params: { ...spec, sourceAssetId: assetId },
    usage,
    size: outSize,
    parentId: assetId
  });
}
async function createTilesetForProject(client2, project, input, pollOpts) {
  const sidescroller = input.kind === "sidescroller";
  const upperDescription = sidescroller ? "" : input.upperDescription ?? input.lowerDescription;
  const res = await client2.createTilesetAndWait(
    {
      lowerDescription: input.lowerDescription,
      ...sidescroller ? {} : { upperDescription },
      transitionDescription: input.transitionDescription,
      tileWidth: input.tileWidth ?? 16,
      tileHeight: input.tileHeight ?? 16,
      view: input.view,
      kind: input.kind ?? "top-down"
    },
    pollOpts ?? {}
  );
  return project.addTileset({
    id: res.tilesetId,
    lowerDescription: input.lowerDescription,
    upperDescription,
    tileSize: res.tileSize,
    totalTiles: res.totalTiles,
    terrainTypes: res.terrainTypes,
    tiles: res.tiles.map((t) => ({
      id: t.id,
      name: t.name,
      bytes: base64ToBytes(t.image.base64),
      description: t.description ?? void 0
    })),
    usage: res.usage
  });
}
async function createIsometricTileForProject(client2, project, input, pollOpts) {
  const style = project.getStyle();
  const size = input.size ?? 32;
  const description = style.styleDescription ? `${input.description}. Style: ${style.styleDescription}` : input.description;
  const res = await client2.createIsometricTileAndWait(
    { description, size, shape: input.shape, seed: input.seed },
    pollOpts ?? {}
  );
  if (!res.image) throw new Error("Isometric tile generation returned no image");
  return project.addAsset({
    bytes: base64ToBytes(res.image.base64),
    prompt: input.description,
    endpoint: "create-isometric-tile",
    params: { shape: input.shape ?? "block", isometric: true, ...input.seed !== void 0 ? { seed: input.seed } : {} },
    usage: res.usage,
    seed: input.seed,
    size: { width: size, height: size }
  });
}
async function inpaintAssetForProject(client2, project, input) {
  const src = project.getAsset(input.assetId);
  if (!src) throw new Error(`Asset not found: ${input.assetId}`);
  const style = project.getStyle();
  const base64 = Buffer.from(project.readAssetBytes(input.assetId)).toString("base64");
  const description = style.styleDescription ? `${input.description}. Style: ${style.styleDescription}` : input.description;
  const { image, usage } = await client2.inpaint({
    description,
    width: src.size.width,
    height: src.size.height,
    imageBase64: base64,
    maskBase64: input.maskBase64,
    noBackground: style.noBackground,
    seed: input.seed
  });
  if (!image) throw new Error("Inpaint returned no image");
  return project.addAsset({
    bytes: base64ToBytes(image.base64),
    prompt: `inpaint: ${input.description}`,
    endpoint: "inpaint",
    params: { sourceAssetId: input.assetId, ...input.seed !== void 0 ? { seed: input.seed } : {} },
    usage,
    seed: input.seed,
    size: src.size,
    parentId: input.assetId
  });
}
const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_TOKENS = 16e3;
function resolveApiKey(cfg = {}) {
  return cfg.apiKey ?? process.env.ANTHROPIC_API_KEY;
}
function createAnthropic(cfg = {}) {
  const apiKey = resolveApiKey(cfg);
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY missing — add it to .env to use the embedded Claude agent. (This is separate from your PixelLab token and bills to your Anthropic account.)"
    );
  }
  return new Anthropic({ apiKey });
}
function buildSystemPrompt(project) {
  const s = project.getStyle();
  const guide = project.readStyleGuide().trim();
  const assets = project.listAssets();
  const approved = assets.filter((a) => a.status === "approved").slice(0, 6);
  const rejected = assets.filter((a) => a.status === "rejected").slice(0, 4);
  const out = [];
  out.push(
    `You are the pixel-art art director for the project "${project.name}". You drive PixelLab to generate style-consistent pixel art and help the user iterate quickly.`
  );
  out.push("");
  out.push("## Style contract (auto-applied to every generation)");
  out.push(`- Description: ${s.styleDescription ?? "(none set)"}`);
  out.push(`- Default size: ${s.defaultSize.width}x${s.defaultSize.height}`);
  out.push(`- Transparent background: ${s.noBackground ?? false}`);
  if (s.view) out.push(`- Camera view: ${s.view} (applied to new characters/objects)`);
  if (s.negative) out.push(`- Avoid: ${s.negative}`);
  out.push(
    `- Active style references: ${s.refs.length}/4 ` + (s.refs.length ? "(generate uses generate-with-style-v2 → consistent, ~20 generations)" : "(none yet → generate uses pixflux → cheap drafts, ~1 generation)")
  );
  if (guide) {
    out.push("");
    out.push("## Style guide (your accumulated learnings)");
    out.push(guide);
  }
  if (approved.length) {
    out.push("");
    out.push("## Recently approved (what works)");
    for (const a of approved) out.push(`- "${a.prompt}"${a.rating ? ` (★${a.rating})` : ""}`);
  }
  if (rejected.length) {
    out.push("");
    out.push("## Recently rejected (steer away from these)");
    for (const a of rejected) out.push(`- "${a.prompt}"`);
  }
  out.push("");
  out.push("## How to work");
  out.push(
    "- Use `generate` to create images. After each one, look at the returned image and judge it against the style contract — give a concrete verdict and the next step."
  );
  out.push(
    "- Iterate cheaply first; confirm intent before expensive style-reference batches. Generations draw from the user's PixelLab subscription — call `get_balance` if unsure."
  );
  out.push(
    "- When the user approves/rejects or gives feedback, capture durable lessons with `update_style_guide` (read it first, then write the full updated content). Keep it concise — it is the project's memory."
  );
  out.push(
    "- To lock in a look, `promote` a strong asset to a style reference so future generations match it."
  );
  out.push(
    "- Full toolset: characters (+ multi-direction `animate_character`), objects (8-dir, or 1-dir which returns candidate frames to resolve via `select_object_frames`), tilesets (top-down or sidescroller), single isometric tiles, UI elements, image edits and `inpaint_asset` (masked repaint). Set a project `view` (e.g. 'side') so characters/objects share one camera."
  );
  out.push("- Be concise and action-oriented. Lead with the outcome.");
  return out.join("\n");
}
const TOOLS = [
  {
    name: "get_balance",
    description: "Get the PixelLab account balance (subscription generations remaining + USD credits). Free to call.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "get_style",
    description: "Read the project's style contract (description, default size, references, palette).",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "set_style",
    description: "Update fields of the project's style contract. Only pass fields you want to change.",
    input_schema: {
      type: "object",
      properties: {
        style_description: { type: "string", maxLength: 500 },
        default_width: { type: "integer", minimum: 16, maximum: 512 },
        default_height: { type: "integer", minimum: 16, maximum: 512 },
        no_background: { type: "boolean" },
        negative: { type: "string" },
        view: {
          type: "string",
          enum: ["side", "low top-down", "high top-down"],
          description: "Default camera view applied to new characters/objects. 'side' for sidescrollers/dioramas."
        }
      }
    }
  },
  {
    name: "generate",
    description: "Generate a pixel-art image for the project, applying its style contract automatically. With style references present this uses generate-with-style-v2 (~20 generations); without, pixflux (~1 generation). The generated image is returned so you can judge it. Saved as a draft asset. Be deliberate with cost — iterate cheaply, confirm before expensive batches.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What to generate, in the project's style" },
        width: { type: "integer", minimum: 16, maximum: 512 },
        height: { type: "integer", minimum: 16, maximum: 512 },
        seed: { type: "integer", minimum: 0 }
      },
      required: ["description"]
    }
  },
  {
    name: "list_assets",
    description: "List the project's library assets with id, status, endpoint, rating and prompt.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "create_character",
    description: "Create a persistent character with 8 directional rotations (create-character-v3) for the project, applying its style. EXPENSIVE and slow — it generates and downloads all rotations. Confirm with the user before using. Returns the south-facing rotation when done.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "The character to create" },
        width: { type: "integer", minimum: 16, maximum: 512 },
        height: { type: "integer", minimum: 16, maximum: 512 },
        view: {
          type: "string",
          enum: ["side", "low top-down", "high top-down"],
          description: "Camera view (defaults to the style contract's view)."
        },
        seed: { type: "integer", minimum: 0 }
      },
      required: ["description"]
    }
  },
  {
    name: "list_characters",
    description: "List the project's saved characters (id, name, directions).",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "create_object",
    description: "Create a persistent directional object (tree, barrel, item, building) with rotations (create-8/1-direction-object) for the project, applying its style. EXPENSIVE and slow. Confirm with the user first. Returns the south-facing rotation when done. NOTE: directions=1 with size ≤170 finishes in REVIEW — it returns several candidate frames; call select_object_frames with the object id and the indices to keep.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        directions: { type: "integer", enum: [1, 8], description: "1 or 8 (default 8)" },
        size: {
          type: "integer",
          minimum: 32,
          maximum: 256,
          description: "Square size px (default 64). For directions=1, use >170 for a single object."
        },
        view: {
          type: "string",
          enum: ["side", "low top-down", "high top-down"],
          description: "Camera view (defaults to the style contract's view)."
        }
      },
      required: ["description"]
    }
  },
  {
    name: "list_objects",
    description: "List the project's saved objects (id, name, directions).",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "list_object_reviews",
    description: "List 1-direction objects awaiting frame selection (id, prompt, candidate count). These came back in REVIEW status — pick frames with select_object_frames.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "select_object_frames",
    description: "Resolve an object review: keep the chosen candidate frames (by 0-based index). Each kept frame becomes its own finished object. Clears the review afterwards.",
    input_schema: {
      type: "object",
      properties: {
        object_id: { type: "string" },
        indices: {
          type: "array",
          items: { type: "integer", minimum: 0 },
          description: "0-based indices of the candidate frames to keep."
        }
      },
      required: ["object_id", "indices"]
    }
  },
  {
    name: "animate_character",
    description: "Add an animation to an existing character (animate-character). Provide the character id and an action like 'walking' or 'swinging a sword'. EXPENSIVE and slow (one job per direction, polled to completion). The frames are downloaded and saved to the character.",
    input_schema: {
      type: "object",
      properties: {
        character_id: { type: "string" },
        action_description: { type: "string" },
        animation_name: { type: "string" },
        frame_count: { type: "integer", minimum: 4, maximum: 16 },
        directions: {
          type: "array",
          items: {
            type: "string",
            enum: ["south", "north", "east", "west", "south-east", "north-east", "north-west", "south-west"]
          },
          description: "Which directions to animate (default: south only). More directions = proportionally more cost/time."
        }
      },
      required: ["character_id", "action_description"]
    }
  },
  {
    name: "generate_ui",
    description: "Generate a pixel-art UI element (button, health bar, panel, icon, frame) via generate-ui-v2 (Pro, async). Saves the result to the asset library.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "The UI element to generate" },
        width: { type: "integer", minimum: 16, maximum: 512 },
        height: { type: "integer", minimum: 16, maximum: 512 }
      },
      required: ["description"]
    }
  },
  {
    name: "edit_asset",
    description: "Apply an image operation to an existing project asset and save the result as a new asset. Ops: 'remove-background', 'image-to-pixelart' (convert an image to pixel art), 'edit' (apply a text-described change), 'rotate' (change facing direction), 'resize' (intelligent up/downscale).",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        op: {
          type: "string",
          enum: ["remove-background", "image-to-pixelart", "edit", "rotate", "resize"]
        },
        description: { type: "string", description: "For op=edit: the change to make" },
        target_width: { type: "integer", description: "For op=resize / image-to-pixelart" },
        target_height: { type: "integer", description: "For op=resize / image-to-pixelart" },
        to_direction: {
          type: "string",
          enum: ["south", "north", "east", "west", "south-east", "north-east", "north-west", "south-west"],
          description: "For op=rotate"
        }
      },
      required: ["asset_id", "op"]
    }
  },
  {
    name: "create_tileset",
    description: "Create a seamless terrain tileset (a scene building-block) via create-tileset (Pro, async, ~16-23 tiles). For kind='top-down': provide a lower/base terrain and an upper/elevated terrain (e.g. lower 'grass', upper 'water'). For kind='sidescroller': only lower_description is used (the platform/ground terrain). EXPENSIVE and slow. Saves all tiles; returns a couple as preview.",
    input_schema: {
      type: "object",
      properties: {
        lower_description: { type: "string", description: "Base/ground terrain, e.g. 'grass'" },
        upper_description: {
          type: "string",
          description: "Elevated terrain for top-down, e.g. 'water' (ignored for sidescroller)"
        },
        transition_description: { type: "string" },
        tile_size: { type: "integer", enum: [16, 32], description: "16 or 32 (default 16)" },
        kind: {
          type: "string",
          enum: ["top-down", "sidescroller"],
          description: "'top-down' (default) or 'sidescroller'."
        },
        view: {
          type: "string",
          enum: ["low top-down", "high top-down"],
          description: "Top-down camera height (top-down kind only)."
        }
      },
      required: ["lower_description"]
    }
  },
  {
    name: "create_isometric_tile",
    description: "Generate a single isometric ground/terrain tile (create-isometric-tile, async). Good for isometric game maps. Saves the tile to the asset library. shape controls thickness (thin/thick tile, block).",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "The isometric tile, e.g. 'grass block', 'stone path'" },
        size: { type: "integer", minimum: 16, maximum: 64, description: "Square size px (default 32)" },
        shape: {
          type: "string",
          enum: ["thin tile", "thick tile", "block"],
          description: "Tile thickness (default 'block')."
        },
        seed: { type: "integer", minimum: 0 }
      },
      required: ["description"]
    }
  },
  {
    name: "inpaint_asset",
    description: "Repaint a masked region of an existing asset from a text description (inpaint). Provide the asset id, a base64 PNG mask the same size as the asset (WHITE pixels = repaint, black = keep), and what to draw there. Saves the result as a new asset.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        mask_base64: { type: "string", description: "Base64 PNG mask, same size; white = region to repaint" },
        description: { type: "string", description: "What to paint in the masked region" },
        seed: { type: "integer", minimum: 0 }
      },
      required: ["asset_id", "mask_base64", "description"]
    }
  },
  {
    name: "list_tilesets",
    description: "List the project's saved tilesets (id, terrains, tile count).",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "review_asset",
    description: "Approve, reject, or promote a draft asset. 'promote' approves AND adds it to the style references so future generations match it. Optionally set a 1-5 rating.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        action: { type: "string", enum: ["approve", "reject", "promote"] },
        rating: { type: "integer", minimum: 1, maximum: 5 }
      },
      required: ["asset_id", "action"]
    }
  },
  {
    name: "read_style_guide",
    description: "Read the project's STYLE_GUIDE.md (accumulated do/don't, palette notes, winning patterns).",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "update_style_guide",
    description: "Overwrite the project's STYLE_GUIDE.md with refined learnings. Keep it concise and durable — this is the project's memory that shapes future generations. Read it first, then write the full updated content.",
    input_schema: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"]
    }
  }
];
async function executeTool(name, input, ctx) {
  const { project, pixel } = ctx;
  switch (name) {
    case "get_balance": {
      const b = await pixel.getBalance();
      const text = `Plan: ${b.subscription.plan} (${b.subscription.status}); generations ${b.subscription.generations}/${b.subscription.total}; USD $${b.credits.usd.toFixed(2)}`;
      return { content: text, summary: "checked balance" };
    }
    case "get_style": {
      const s = project.getStyle();
      const text = JSON.stringify(
        {
          styleDescription: s.styleDescription,
          defaultSize: s.defaultSize,
          noBackground: s.noBackground ?? false,
          negative: s.negative,
          view: s.view,
          referenceCount: s.refs.length
        },
        null,
        2
      );
      return { content: text, summary: "read style contract" };
    }
    case "set_style": {
      const patch = {};
      if (typeof input.style_description === "string") patch.styleDescription = input.style_description;
      if (typeof input.no_background === "boolean") patch.noBackground = input.no_background;
      if (typeof input.negative === "string") patch.negative = input.negative;
      if (typeof input.view === "string") patch.view = input.view;
      if (typeof input.default_width === "number" || typeof input.default_height === "number") {
        const cur = project.getStyle().defaultSize;
        patch.defaultSize = {
          width: input.default_width ?? cur.width,
          height: input.default_height ?? cur.height
        };
      }
      project.setStyle(patch);
      return { content: "Style updated.", summary: "updated style contract" };
    }
    case "generate": {
      const out = await generateForProject(pixel, project, {
        description: String(input.description ?? ""),
        size: input.width || input.height ? { width: input.width ?? 64, height: input.height ?? 64 } : void 0,
        seed: input.seed
      });
      const base64 = Buffer.from(project.readAssetBytes(out.asset.id)).toString("base64");
      return {
        content: [
          {
            type: "text",
            text: `Generated draft asset ${out.asset.id} via ${out.mode} (usage: ${formatUsage(out.asset.usage)}). Here is the result:`
          },
          { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } }
        ],
        summary: `generated ${out.mode} (${formatUsage(out.asset.usage)})`,
        assetId: out.asset.id
      };
    }
    case "list_assets": {
      const assets = project.listAssets();
      if (assets.length === 0) return { content: "Library is empty.", summary: "listed assets (0)" };
      const text = assets.map((a) => `${a.id} | ${a.status} | ${a.endpoint} | rating=${a.rating ?? "-"} | "${a.prompt}"`).join("\n");
      return { content: text, summary: `listed ${assets.length} assets` };
    }
    case "create_character": {
      const size = input.width || input.height ? { width: input.width ?? 64, height: input.height ?? 64 } : void 0;
      const out = await createCharacterForProject(pixel, project, {
        description: String(input.description ?? ""),
        size,
        view: input.view,
        seed: input.seed
      });
      const south = Buffer.from(project.readCharacterImage(out.character.id, "south")).toString("base64");
      return {
        content: [
          {
            type: "text",
            text: `Created character ${out.character.id} "${out.character.name}" with ${out.directionsDownloaded} rotations (usage: ${formatUsage(out.character.usage)}). South-facing rotation:`
          },
          { type: "image", source: { type: "base64", media_type: "image/png", data: south } }
        ],
        summary: `created character (${out.directionsDownloaded} dirs, ${formatUsage(out.character.usage)})`
      };
    }
    case "list_characters": {
      const chars = project.listCharacters();
      if (chars.length === 0) return { content: "No characters yet.", summary: "listed characters (0)" };
      const text = chars.map((c) => `${c.id} | "${c.name}" | ${c.directions} dirs | ${Object.keys(c.rotations).length} rotations`).join("\n");
      return { content: text, summary: `listed ${chars.length} characters` };
    }
    case "create_object": {
      const out = await createObjectForProject(pixel, project, {
        description: String(input.description ?? ""),
        directions: input.directions ?? 8,
        size: input.size,
        view: input.view
      });
      if (out.review) {
        const previews = [
          {
            type: "text",
            text: `Object ${out.review.id} finished in REVIEW with ${out.review.frames.length} candidate frames (indices 0-${out.review.frames.length - 1}). Pick the good ones with select_object_frames. Candidates:`
          },
          ...out.review.frames.map((_f, i) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: Buffer.from(project.readObjectReviewFrame(out.review.id, i)).toString("base64")
            }
          }))
        ];
        return {
          content: previews,
          summary: `object review (${out.review.frames.length} candidates)`
        };
      }
      const object = out.object;
      const south = Object.keys(object.rotations)[0];
      const img64 = south ? Buffer.from(project.readObjectImage(object.id, south)).toString("base64") : null;
      const content = img64 ? [
        {
          type: "text",
          text: `Created object ${object.id} "${object.name}" with ${out.directionsDownloaded} rotations:`
        },
        { type: "image", source: { type: "base64", media_type: "image/png", data: img64 } }
      ] : `Created object ${object.id} with ${out.directionsDownloaded} rotations.`;
      return { content, summary: `created object (${out.directionsDownloaded} dirs)`, assetId: void 0 };
    }
    case "list_objects": {
      const objects = project.listObjects();
      if (objects.length === 0) return { content: "No objects yet.", summary: "listed objects (0)" };
      return {
        content: objects.map((o) => `${o.id} | "${o.name}" | ${o.directions} dirs`).join("\n"),
        summary: `listed ${objects.length} objects`
      };
    }
    case "list_object_reviews": {
      const reviews = project.listObjectReviews();
      if (reviews.length === 0) return { content: "No objects awaiting review.", summary: "listed reviews (0)" };
      return {
        content: reviews.map((r) => `${r.id} | "${r.prompt}" | ${r.frames.length} candidate frames (indices 0-${r.frames.length - 1})`).join("\n"),
        summary: `listed ${reviews.length} object reviews`
      };
    }
    case "select_object_frames": {
      const objectId = String(input.object_id ?? "");
      const indices = Array.isArray(input.indices) ? input.indices.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0) : [];
      if (indices.length === 0) {
        return { content: "Provide at least one frame index to keep.", summary: "select-frames: no indices" };
      }
      const { objects } = await selectObjectFramesForProject(pixel, project, objectId, indices);
      const content = [
        { type: "text", text: `Kept ${objects.length} object(s): ${objects.map((o) => o.id).join(", ")}.` },
        ...objects.map((o) => {
          const dir = Object.keys(o.rotations)[0];
          if (!dir) return null;
          return {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: Buffer.from(project.readObjectImage(o.id, dir)).toString("base64")
            }
          };
        }).filter((x) => x !== null)
      ];
      return { content, summary: `selected ${objects.length} object frame(s)` };
    }
    case "animate_character": {
      const out = await animateCharacterForProject(pixel, project, {
        characterId: String(input.character_id ?? ""),
        actionDescription: String(input.action_description ?? ""),
        animationName: input.animation_name,
        frameCount: input.frame_count,
        directions: Array.isArray(input.directions) ? input.directions : void 0
      });
      return {
        content: `Created animation "${out.name}" — ${out.frameCount} frames across ${out.directions.length} directions, downloaded and saved to the character.`,
        summary: `animated character ("${out.name}", ${out.frameCount} frames)`
      };
    }
    case "generate_ui": {
      const size = input.width || input.height ? { width: input.width ?? 64, height: input.height ?? 64 } : void 0;
      const asset = await generateUIForProject(pixel, project, {
        description: String(input.description ?? ""),
        size
      });
      const b64 = Buffer.from(project.readAssetBytes(asset.id)).toString("base64");
      return {
        content: [
          { type: "text", text: `UI element generated (asset ${asset.id}):` },
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }
        ],
        summary: "generated UI element",
        assetId: asset.id
      };
    }
    case "edit_asset": {
      const op = String(input.op);
      let spec;
      if (op === "edit") spec = { op: "edit", description: String(input.description ?? "") };
      else if (op === "resize")
        spec = {
          op: "resize",
          targetWidth: input.target_width ?? 128,
          targetHeight: input.target_height ?? 128
        };
      else if (op === "rotate") spec = { op: "rotate", toDirection: input.to_direction };
      else if (op === "image-to-pixelart")
        spec = {
          op: "image-to-pixelart",
          outputWidth: input.target_width,
          outputHeight: input.target_height
        };
      else spec = { op: "remove-background" };
      const asset = await editAssetForProject(pixel, project, String(input.asset_id ?? ""), spec);
      const b64 = Buffer.from(project.readAssetBytes(asset.id)).toString("base64");
      return {
        content: [
          { type: "text", text: `${op} → new asset ${asset.id}:` },
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }
        ],
        summary: `${op} asset`,
        assetId: asset.id
      };
    }
    case "create_tileset": {
      const ts = await createTilesetForProject(pixel, project, {
        lowerDescription: String(input.lower_description ?? ""),
        upperDescription: input.upper_description,
        transitionDescription: input.transition_description,
        tileWidth: input.tile_size,
        tileHeight: input.tile_size,
        view: input.view,
        kind: input.kind === "sidescroller" ? "sidescroller" : "top-down"
      });
      const previews = ts.tiles.slice(0, 4).map((t) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: Buffer.from(project.readTileImage(ts.id, t.id)).toString("base64")
        }
      }));
      return {
        content: [
          {
            type: "text",
            text: `Tileset ${ts.id} created — ${ts.totalTiles} tiles (${ts.tileSize.width}x${ts.tileSize.height}), terrains: ${ts.terrainTypes.join("/")}. Sample tiles:`
          },
          ...previews
        ],
        summary: `created tileset (${ts.totalTiles} tiles)`
      };
    }
    case "create_isometric_tile": {
      const asset = await createIsometricTileForProject(pixel, project, {
        description: String(input.description ?? ""),
        size: input.size,
        shape: input.shape,
        seed: input.seed
      });
      const b64 = Buffer.from(project.readAssetBytes(asset.id)).toString("base64");
      return {
        content: [
          { type: "text", text: `Isometric tile generated (asset ${asset.id}):` },
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }
        ],
        summary: "generated isometric tile",
        assetId: asset.id
      };
    }
    case "inpaint_asset": {
      const asset = await inpaintAssetForProject(pixel, project, {
        assetId: String(input.asset_id ?? ""),
        maskBase64: String(input.mask_base64 ?? ""),
        description: String(input.description ?? ""),
        seed: input.seed
      });
      const b64 = Buffer.from(project.readAssetBytes(asset.id)).toString("base64");
      return {
        content: [
          { type: "text", text: `Inpainted → new asset ${asset.id}:` },
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }
        ],
        summary: "inpainted asset",
        assetId: asset.id
      };
    }
    case "list_tilesets": {
      const tilesets = project.listTilesets();
      if (tilesets.length === 0) return { content: "No tilesets yet.", summary: "listed tilesets (0)" };
      return {
        content: tilesets.map((t) => `${t.id} | ${t.lowerDescription} / ${t.upperDescription} | ${t.totalTiles} tiles`).join("\n"),
        summary: `listed ${tilesets.length} tilesets`
      };
    }
    case "review_asset": {
      const id = String(input.asset_id ?? "");
      const action = String(input.action ?? "");
      let summary;
      if (action === "promote") {
        project.promoteAssetToRef(id);
        summary = `promoted ${id} to style ref (now ${project.getStyle().refs.length}/4)`;
      } else if (action === "approve" || action === "reject") {
        project.setAssetStatus(id, action === "approve" ? "approved" : "rejected");
        summary = `${action}d ${id}`;
      } else {
        return { content: `Unknown action "${action}".`, summary: "review failed" };
      }
      if (typeof input.rating === "number") project.rateAsset(id, input.rating);
      return { content: summary, summary, assetId: id };
    }
    case "read_style_guide": {
      const text = project.readStyleGuide();
      return { content: text || "(empty)", summary: "read style guide" };
    }
    case "update_style_guide": {
      project.writeStyleGuide(String(input.content ?? ""));
      return { content: "Style guide updated.", summary: "updated style guide" };
    }
    default:
      return { content: `Unknown tool "${name}".`, summary: "unknown tool" };
  }
}
const MAX_STEPS = 12;
class PixelAgent {
  constructor(client2, ctx, opts = {}) {
    this.client = client2;
    this.ctx = ctx;
    this.opts = opts;
  }
  history = [];
  reset() {
    this.history = [];
  }
  /** Point the agent at a freshly-loaded Project (state changes from the UI). */
  setProject(project) {
    this.ctx = { ...this.ctx, project };
  }
  async send(userText, onEvent) {
    this.history.push({ role: "user", content: userText });
    const model = this.opts.model ?? DEFAULT_MODEL;
    const maxTokens = this.opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const system = buildSystemPrompt(this.ctx.project);
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const stream = this.client.messages.stream({
          model,
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          system,
          tools: TOOLS,
          messages: this.history
        });
        stream.on("text", (delta) => onEvent({ type: "text", text: delta }));
        const message = await stream.finalMessage();
        this.history.push({ role: "assistant", content: message.content });
        const toolUses = message.content.filter(
          (b) => b.type === "tool_use"
        );
        if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
          onEvent({ type: "done" });
          return;
        }
        const results = [];
        for (const tu of toolUses) {
          onEvent({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
          try {
            const outcome = await executeTool(
              tu.name,
              tu.input,
              this.ctx
            );
            if (outcome.assetId) onEvent({ type: "asset", assetId: outcome.assetId });
            onEvent({ type: "tool_result", name: tu.name, summary: outcome.summary });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: outcome.content });
          } catch (e) {
            const msg = e.message ?? String(e);
            onEvent({ type: "tool_result", name: tu.name, summary: `error: ${msg}` });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: msg, is_error: true });
          }
        }
        this.history.push({ role: "user", content: results });
      }
      onEvent({ type: "done" });
    } catch (e) {
      onEvent({ type: "error", message: e.message ?? String(e) });
    }
  }
}
let queryFnPromise = null;
function loadQuery() {
  if (!queryFnPromise) {
    const dynImport = new Function("s", "return import(s)");
    queryFnPromise = dynImport("@anthropic-ai/claude-agent-sdk").then((m) => m.query);
  }
  return queryFnPromise;
}
const MCP_SERVER_NAME = "pixellabrat";
const ALLOWED_TOOLS = [
  "pixellab_balance",
  "pixellab_project_list",
  "pixellab_project_create",
  "pixellab_project_style",
  "pixellab_project_add_ref",
  "pixellab_project_generate",
  "pixellab_project_library",
  "pixellab_project_review",
  "pixellab_project_create_character",
  "pixellab_project_characters",
  "pixellab_project_create_object",
  "pixellab_project_objects",
  "pixellab_project_animate_character",
  "pixellab_project_generate_ui",
  "pixellab_project_edit_asset",
  "pixellab_project_create_tileset",
  "pixellab_project_tilesets"
].map((t) => `mcp__${MCP_SERVER_NAME}__${t}`);
const MUTATING = ["generate", "style", "add_ref", "review", "create"];
function summarizeToolResult(content) {
  if (typeof content === "string") return content.slice(0, 80);
  if (Array.isArray(content)) {
    const parts = content.map((b) => {
      const block = b;
      if (block.type === "text") return String(block.text).slice(0, 80);
      if (block.type === "image") return "[image]";
      return "";
    });
    return parts.filter(Boolean).join(" ").slice(0, 80) || "ok";
  }
  return "ok";
}
class ClaudeCodeBackend {
  constructor(project, mcp, opts = {}) {
    this.project = project;
    this.mcp = mcp;
    this.opts = opts;
  }
  sessionId;
  toolNames = /* @__PURE__ */ new Map();
  setProject(project) {
    this.project = project;
  }
  reset() {
    this.sessionId = void 0;
    this.toolNames.clear();
  }
  async send(userText, onEvent) {
    const slug = this.project.slug;
    const system = buildSystemPrompt(this.project) + `

## Tooling
You act on this project through the "${MCP_SERVER_NAME}" MCP tools (named mcp__${MCP_SERVER_NAME}__pixellab_*). ALWAYS pass slug="${slug}" to the project tools. Use only these tools — no file, shell, or web tools.`;
    const options = {
      model: this.opts.model ?? DEFAULT_MODEL,
      systemPrompt: system,
      mcpServers: { [MCP_SERVER_NAME]: this.mcp },
      allowedTools: ALLOWED_TOOLS,
      permissionMode: "bypassPermissions"
    };
    if (this.sessionId) options.resume = this.sessionId;
    try {
      const query = await loadQuery();
      const q = query({ prompt: userText, options });
      for await (const raw of q) {
        const msg = raw;
        if (msg.session_id) this.sessionId = msg.session_id;
        if (msg.type === "assistant") {
          for (const block of msg.message?.content ?? []) {
            const b = block;
            if (b.type === "text" && typeof b.text === "string") {
              onEvent({ type: "text", text: b.text });
            } else if (b.type === "tool_use") {
              const id = String(b.id ?? "");
              const name = String(b.name ?? "tool");
              if (id) this.toolNames.set(id, name);
              onEvent({ type: "tool_use", id, name, input: b.input });
            }
          }
        } else if (msg.type === "user") {
          for (const block of msg.message?.content ?? []) {
            const b = block;
            if (b.type === "tool_result") {
              const name = this.toolNames.get(String(b.tool_use_id ?? "")) ?? "tool";
              onEvent({ type: "tool_result", name, summary: summarizeToolResult(b.content) });
              if (MUTATING.some((m) => name.includes(m))) onEvent({ type: "asset", assetId: "" });
            }
          }
        } else if (msg.type === "result") {
          if (msg.subtype && msg.subtype !== "success") {
            onEvent({ type: "error", message: `assistant ended: ${msg.subtype}` });
          }
          onEvent({ type: "done" });
          return;
        }
      }
      onEvent({ type: "done" });
    } catch (e) {
      onEvent({ type: "error", message: e.message ?? String(e) });
    }
  }
}
function detectAuthMode() {
  if (resolveApiKey()) return "api-key";
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return "subscription";
  return "none";
}
function createBackend(project, deps, opts = {}, mode = detectAuthMode()) {
  switch (mode) {
    case "api-key":
      return new PixelAgent(createAnthropic(opts), { project, pixel: deps.pixel }, opts);
    case "subscription":
      return new ClaudeCodeBackend(project, deps.mcp, opts);
    default:
      return null;
  }
}
function tokenFile() {
  return node_path.join(electron.app.getPath("userData"), "claude-oauth.bin");
}
function loadStoredToken() {
  const f = tokenFile();
  if (!node_fs.existsSync(f)) return null;
  try {
    const buf = node_fs.readFileSync(f);
    const kind = buf[0];
    const body = buf.subarray(1);
    if (kind === 1 && electron.safeStorage.isEncryptionAvailable()) return electron.safeStorage.decryptString(body);
    if (kind === 0) return body.toString("utf8");
    return null;
  } catch {
    return null;
  }
}
function saveToken(token) {
  node_fs.mkdirSync(electron.app.getPath("userData"), { recursive: true });
  const f = tokenFile();
  let out;
  if (electron.safeStorage.isEncryptionAvailable()) {
    out = Buffer.concat([Buffer.from([1]), electron.safeStorage.encryptString(token)]);
  } else {
    out = Buffer.concat([Buffer.from([0]), Buffer.from(token, "utf8")]);
  }
  node_fs.writeFileSync(f, out);
  try {
    node_fs.chmodSync(f, 384);
  } catch {
  }
}
function clearStoredToken() {
  const f = tokenFile();
  if (node_fs.existsSync(f)) node_fs.rmSync(f);
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
}
function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code) => {
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    };
    let child;
    try {
      child = node_child_process.spawn(cmd, args, { env: process.env });
    } catch {
      return finish(null);
    }
    child.stdout?.on("data", (d) => stdout += String(d));
    child.stderr?.on("data", (d) => stderr += String(d));
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
    const t = setTimeout(() => {
      try {
        child.kill();
      } catch {
      }
      finish(null);
    }, timeoutMs);
    child.on("close", () => clearTimeout(t));
  });
}
async function claudeLoggedIn() {
  const r = await run("claude", ["auth", "status"], 8e3);
  return r.code === 0;
}
async function computeAuthStatus() {
  let status;
  if (process.env.ANTHROPIC_API_KEY) {
    status = { mode: "api-key", via: "api-key", stored: false };
  } else {
    const stored = loadStoredToken();
    if (stored) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = stored;
      status = { mode: "subscription", via: "stored-token", stored: true };
    } else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      status = { mode: "subscription", via: "env-token", stored: false };
    } else if (await claudeLoggedIn()) {
      status = { mode: "subscription", via: "cli-login", stored: false };
    } else {
      status = { mode: "none", via: "none", stored: false };
    }
  }
  return status;
}
function extractToken(text) {
  const matches = text.match(/sk-ant-[A-Za-z0-9_\-]{20,}/g);
  if (matches?.length) return matches.sort((a, b) => b.length - a.length)[0];
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_\-.]{40,}$/.test(s));
  return lines.length ? lines[lines.length - 1] : null;
}
async function connectClaude() {
  const r = await run("claude", ["setup-token"], 5 * 6e4);
  if (r.code === null && !r.stdout) {
    return {
      ok: false,
      error: "Konnte `claude setup-token` nicht ausführen (ist Claude Code installiert & auf dem PATH?)."
    };
  }
  const token = extractToken(`${r.stdout}
${r.stderr}`);
  if (!token) {
    return { ok: false, error: "Kein Token im Output gefunden. Tipp: Token manuell einfügen." };
  }
  saveToken(token);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  await computeAuthStatus();
  return { ok: true };
}
async function setClaudeToken(token) {
  const t = token.trim();
  if (t.length < 20) return { ok: false, error: "Token sieht ungültig aus." };
  saveToken(t);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = t;
  await computeAuthStatus();
  return { ok: true };
}
async function disconnectClaude() {
  clearStoredToken();
  return computeAuthStatus();
}
let client = null;
function getClient() {
  if (!client) client = new PixelLab();
  return client;
}
function toDataUrl(bytes) {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}
function registerIpc(projectsRoot2, mcpServer2) {
  const store = openStore(projectsRoot2);
  electron.ipcMain.handle("balance:get", () => getClient().getBalance());
  electron.ipcMain.handle("project:list", () => store.list());
  electron.ipcMain.handle("project:create", (_e, name) => store.createProject(name).slug);
  electron.ipcMain.handle("project:get", (_e, slug) => {
    const p = store.open(slug);
    return {
      manifest: p.getManifest(),
      assets: p.listAssets(),
      characters: p.listCharacters(),
      objects: p.listObjects(),
      objectReviews: p.listObjectReviews(),
      tilesets: p.listTilesets()
    };
  });
  electron.ipcMain.handle("project:setStyle", (_e, slug, patch) => store.open(slug).setStyle(patch));
  electron.ipcMain.handle("project:addRef", async (_e, slug) => {
    const res = await electron.dialog.showOpenDialog({
      title: "Add style reference",
      filters: [{ name: "PNG", extensions: ["png"] }],
      properties: ["openFile", "multiSelections"]
    });
    if (res.canceled) return { added: 0 };
    const p = store.open(slug);
    let added = 0;
    for (const f of res.filePaths) {
      try {
        p.addRefFromBytes(new Uint8Array(node_fs.readFileSync(f)));
        added++;
      } catch {
      }
    }
    return { added };
  });
  electron.ipcMain.handle(
    "project:removeRef",
    (_e, slug, file) => store.open(slug).removeRef(file)
  );
  electron.ipcMain.handle("project:generate", async (e, slug, input) => {
    const p = store.open(slug);
    const out = await generateForProject(getClient(), p, input, {
      onProgress: (progress) => e.sender.send("project:generateProgress", progress)
    });
    return out.asset;
  });
  electron.ipcMain.handle(
    "project:generateUI",
    async (e, slug, input) => {
      const p = store.open(slug);
      return generateUIForProject(getClient(), p, input, {
        onProgress: (progress) => e.sender.send("project:generateProgress", progress)
      });
    }
  );
  electron.ipcMain.handle(
    "project:editAsset",
    async (e, slug, assetId, spec) => {
      const p = store.open(slug);
      return editAssetForProject(getClient(), p, assetId, spec, {
        onProgress: (progress) => e.sender.send("project:generateProgress", progress)
      });
    }
  );
  electron.ipcMain.handle(
    "project:assetImage",
    (_e, slug, id) => toDataUrl(store.open(slug).readAssetBytes(id))
  );
  electron.ipcMain.handle("project:refImage", (_e, slug, file) => {
    const p = store.open(slug);
    return toDataUrl(new Uint8Array(node_fs.readFileSync(node_path.join(p.dir, file))));
  });
  electron.ipcMain.handle(
    "project:review",
    (_e, slug, id, action, rating) => {
      const p = store.open(slug);
      if (action === "promote") p.promoteAssetToRef(id);
      else p.setAssetStatus(id, action === "approve" ? "approved" : "rejected");
      if (rating !== void 0) p.rateAsset(id, rating);
      return { manifest: p.getManifest(), assets: p.listAssets() };
    }
  );
  electron.ipcMain.handle(
    "project:characterImage",
    (_e, slug, id, direction) => toDataUrl(store.open(slug).readCharacterImage(id, direction))
  );
  electron.ipcMain.handle(
    "project:createCharacter",
    async (e, slug, input) => {
      const p = store.open(slug);
      const size = input.width || input.height ? { width: input.width ?? 64, height: input.height ?? 64 } : void 0;
      const out = await createCharacterForProject(
        getClient(),
        p,
        { description: input.description, size, view: input.view, seed: input.seed },
        { onProgress: (progress) => e.sender.send("project:characterProgress", progress) }
      );
      return out.character;
    }
  );
  electron.ipcMain.handle("project:deleteCharacter", (_e, slug, id) => {
    const p = store.open(slug);
    p.deleteCharacter(id);
    return p.listCharacters();
  });
  electron.ipcMain.handle(
    "project:animateCharacter",
    async (e, slug, input) => {
      const p = store.open(slug);
      await animateCharacterForProject(getClient(), p, input, {
        onProgress: (progress) => e.sender.send("project:animationProgress", progress)
      });
      return p.getCharacter(input.characterId);
    }
  );
  electron.ipcMain.handle(
    "project:animationFrame",
    (_e, slug, characterId, animType, direction, frameIndex) => toDataUrl(store.open(slug).readAnimationFrame(characterId, animType, direction, frameIndex))
  );
  electron.ipcMain.handle(
    "project:objectImage",
    (_e, slug, id, direction) => toDataUrl(store.open(slug).readObjectImage(id, direction))
  );
  electron.ipcMain.handle(
    "project:createObject",
    async (e, slug, input) => {
      const p = store.open(slug);
      const out = await createObjectForProject(getClient(), p, input, {
        onProgress: (progress) => e.sender.send("project:objectProgress", progress)
      });
      return { object: out.object, review: out.review };
    }
  );
  electron.ipcMain.handle("project:deleteObject", (_e, slug, id) => {
    const p = store.open(slug);
    p.deleteObject(id);
    return p.listObjects();
  });
  electron.ipcMain.handle(
    "project:objectReviewFrame",
    (_e, slug, objectId, frameIndex) => toDataUrl(store.open(slug).readObjectReviewFrame(objectId, frameIndex))
  );
  electron.ipcMain.handle(
    "project:selectObjectFrames",
    async (_e, slug, objectId, indices) => {
      const p = store.open(slug);
      const { objects } = await selectObjectFramesForProject(getClient(), p, objectId, indices);
      return objects;
    }
  );
  electron.ipcMain.handle("project:discardObjectReview", (_e, slug, objectId) => {
    const p = store.open(slug);
    p.deleteObjectReview(objectId);
    return p.listObjectReviews();
  });
  electron.ipcMain.handle(
    "project:tileImage",
    (_e, slug, tilesetId, tileId) => toDataUrl(store.open(slug).readTileImage(tilesetId, tileId))
  );
  electron.ipcMain.handle(
    "project:createTileset",
    async (e, slug, input) => {
      const p = store.open(slug);
      const ts = await createTilesetForProject(
        getClient(),
        p,
        {
          lowerDescription: input.lowerDescription,
          upperDescription: input.upperDescription,
          transitionDescription: input.transitionDescription,
          tileWidth: input.tileSize,
          tileHeight: input.tileSize,
          view: input.view,
          kind: input.kind ?? "top-down"
        },
        { onProgress: (progress) => e.sender.send("project:tilesetProgress", progress) }
      );
      return ts;
    }
  );
  electron.ipcMain.handle(
    "project:createIsometricTile",
    async (e, slug, input) => {
      const p = store.open(slug);
      return createIsometricTileForProject(getClient(), p, input, {
        onProgress: (progress) => e.sender.send("project:tilesetProgress", progress)
      });
    }
  );
  electron.ipcMain.handle("project:deleteTileset", (_e, slug, id) => {
    const p = store.open(slug);
    p.deleteTileset(id);
    return p.listTilesets();
  });
  electron.ipcMain.handle("project:inpaint", async (_e, slug, input) => {
    const p = store.open(slug);
    return inpaintAssetForProject(getClient(), p, input);
  });
  electron.ipcMain.handle("auth:status", () => computeAuthStatus());
  electron.ipcMain.handle("auth:connect", () => connectClaude());
  electron.ipcMain.handle("auth:setToken", (_e, token) => setClaudeToken(token));
  electron.ipcMain.handle("auth:disconnect", () => disconnectClaude());
  const agents = /* @__PURE__ */ new Map();
  electron.ipcMain.handle("agent:available", async () => (await computeAuthStatus()).mode !== "none");
  electron.ipcMain.handle("agent:reset", (_e, slug) => {
    agents.get(slug)?.reset();
  });
  electron.ipcMain.on("agent:send", async (e, slug, text) => {
    const status = await computeAuthStatus();
    if (status.mode === "none") {
      e.sender.send("agent:event", {
        type: "error",
        message: "Nicht verbunden — verbinde dich mit deinem Claude-Abo oder setze ANTHROPIC_API_KEY."
      });
      return;
    }
    try {
      let agent = agents.get(slug);
      if (!agent) {
        const created = createBackend(
          store.open(slug),
          { pixel: getClient(), mcp: mcpServer2 },
          {},
          status.mode
        );
        if (!created) {
          e.sender.send("agent:event", { type: "error", message: "Assistent nicht verfügbar." });
          return;
        }
        agent = created;
        agents.set(slug, agent);
      }
      agent.setProject(store.open(slug));
      await agent.send(text, (event) => e.sender.send("agent:event", event));
    } catch (err) {
      e.sender.send("agent:event", { type: "error", message: err.message ?? String(err) });
    }
  });
}
loadDotEnv(__dirname);
loadDotEnv(process.cwd());
function findRepoRoot() {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (node_fs.existsSync(node_path.join(dir, "packages", "mcp", "src", "server.ts"))) return dir;
    const parent = node_path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
const repoRoot = findRepoRoot();
const projectsRoot = process.env.PIXELLABRAT_PROJECTS_DIR ?? (electron.app.isPackaged || !repoRoot ? node_path.join(electron.app.getPath("userData"), "projects") : node_path.join(repoRoot, "projects"));
const mcpServer = {
  command: "bun",
  args: repoRoot ? ["run", node_path.join(repoRoot, "packages", "mcp", "src", "server.ts")] : [],
  env: { ...process.env, PIXELLABRAT_PROJECTS_DIR: projectsRoot }
};
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#0d0e12",
    title: "PixelLabRat",
    autoHideMenuBar: true,
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  registerIpc(projectsRoot, mcpServer);
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
