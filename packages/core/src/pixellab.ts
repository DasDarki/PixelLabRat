import { PixelLabClient, PixelLabError, type RequestOptions } from "./client";
import { sleep } from "./util";
import type {
  Balance,
  CharacterDetail,
  CharacterSummary,
  ObjectDetail,
  ObjectSummary,
  PixelImage,
  TilesetDetail,
  TilesetTile,
  Usage,
} from "./types";

export interface PixfluxInput {
  description: string;
  width?: number;
  height?: number;
  noBackground?: boolean;
  seed?: number;
}

/** A style reference image: base64 + its pixel dimensions (required by the API). */
export interface StyleRef {
  base64: string;
  width: number;
  height: number;
}

export interface GenerateWithStyleInput {
  description: string;
  /** 1-4 style reference images. */
  styleImages: StyleRef[];
  width?: number;
  height?: number;
  styleDescription?: string;
  noBackground?: boolean;
  seed?: number;
}

export interface JobResult {
  id: string;
  status: string;
  usage: Usage | null;
  lastResponse: Record<string, any> | null;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onProgress?: (progress: number, job: JobResult) => void;
  signal?: AbortSignal;
}

export interface StyledResult {
  images: PixelImage[];
  /** Palette-quantized variants the API returns alongside the raw images. */
  quantizedImages: PixelImage[];
  usage: Usage | null;
  jobId: string;
  seed?: number;
  raw: Record<string, any>;
}

export interface CreateCharacterInput {
  description: string;
  width?: number;
  height?: number;
  view?: string;
  templateId?: string;
  noBackground?: boolean;
  seed?: number;
  enhancePrompt?: boolean;
  /** Optional south-facing reference image (base64) the v3 model rotates into 8 directions. */
  referenceImageBase64?: string;
}

export interface CharacterJob {
  characterId: string;
  jobId: string;
  status: string;
  usage: Usage | null;
  enhancedPrompt?: string | null;
}

export interface CharacterResult {
  character: CharacterDetail;
  /** direction -> PNG bytes */
  rotations: Record<string, Uint8Array>;
  usage: Usage | null;
}

export interface CreateObjectInput {
  description: string;
  /** Square size in pixels (32-256). Default 64. NOTE: for 1-direction, size ≤170 yields
   * multiple candidates (review status); use >170 for a single object. */
  size?: number;
  view?: string;
  /** 1 or 8 directions. Default 8. */
  directions?: number;
  referenceImageBase64?: string;
  styleImageBase64?: string;
}

export interface ObjectResult {
  object: ObjectDetail;
  rotations: Record<string, Uint8Array>;
  /** When the object is in `review` status: the candidate frame images to pick from. */
  frames: Uint8Array[];
  /** Object status, e.g. "completed" or "review". */
  status: string | null;
  usage: Usage | null;
}

export interface AnimateCharacterInput {
  characterId: string;
  /** e.g. "walking", "swinging a sword" */
  actionDescription: string;
  animationName?: string;
  /** "template" (skeleton from a template) or "text" (v3 from description). */
  mode?: "template" | "text";
  templateAnimationId?: string;
  /** 4-16, even. */
  frameCount?: number;
  /** Which directions to animate. Default (omitted) animates only south. */
  directions?: string[];
  seed?: number;
  enhancePrompt?: boolean;
}

export interface AnimateResult {
  character: CharacterDetail;
  directions: string[];
  jobIds: string[];
}

export interface CreateTilesetInput {
  /** Base terrain (the only terrain for sidescroller). */
  lowerDescription: string;
  /** Upper/elevated terrain (top-down only). */
  upperDescription?: string;
  transitionDescription?: string;
  /** 16 or 32. */
  tileWidth?: number;
  tileHeight?: number;
  /** "low top-down" | "high top-down" (top-down only). */
  view?: string;
  /** "top-down" (default) or "sidescroller". */
  kind?: "top-down" | "sidescroller";
  seed?: number;
}

export interface TilesetResult {
  tilesetId: string;
  tiles: TilesetTile[];
  tileSize: { width: number; height: number };
  totalTiles: number;
  terrainTypes: string[];
  usage: Usage | null;
}

export interface CreateIsometricTileInput {
  description: string;
  /** 16-64, square. Default 32. */
  size?: number;
  /** "thin tile" | "thick tile" | "block". Default "block". */
  shape?: string;
  /** 16 or 32. */
  tileSize?: number;
  seed?: number;
}

/** High-level, project-friendly wrapper over the PixelLab endpoints we use. */
export class PixelLab extends PixelLabClient {
  /** Account balance: subscription generations + USD credits. Free to call. */
  async getBalance(opts?: RequestOptions): Promise<Balance> {
    const { data } = await this.request<Balance>("GET", "/balance", undefined, opts);
    return data;
  }

  /** Pixflux: text -> pixel art. Synchronous. Costs ~1 generation. */
  async generatePixflux(
    input: PixfluxInput,
    opts?: RequestOptions,
  ): Promise<{ image: PixelImage; usage: Usage | null }> {
    const body: Record<string, unknown> = {
      description: input.description,
      image_size: { width: input.width ?? 64, height: input.height ?? 64 },
    };
    if (input.noBackground !== undefined) body.no_background = input.noBackground;
    if (input.seed !== undefined) body.seed = input.seed;

    const { data } = await this.request<{ image: PixelImage; usage: Usage | null }>(
      "POST",
      "/create-image-pixflux",
      body,
      opts,
    );
    return { image: data.image, usage: data.usage ?? null };
  }

  async getJob(id: string, opts?: RequestOptions): Promise<JobResult> {
    const { data } = await this.request<{
      id: string;
      status: string;
      usage?: Usage | null;
      last_response?: Record<string, any> | null;
    }>("GET", `/background-jobs/${id}`, undefined, opts);
    return {
      id: data.id,
      status: data.status,
      usage: data.usage ?? null,
      lastResponse: data.last_response ?? null,
    };
  }

  /** Poll a background job until it leaves `processing`. */
  async pollJob(id: string, opts: PollOptions = {}): Promise<JobResult> {
    const interval = opts.intervalMs ?? 3000;
    // PixelLab generation jobs (characters/objects/tilesets) can run several minutes.
    const timeout = opts.timeoutMs ?? 600_000;
    const start = Date.now();
    for (;;) {
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
  async generateWithStyle(
    input: GenerateWithStyleInput,
    opts: PollOptions = {},
  ): Promise<StyledResult> {
    if (input.styleImages.length < 1 || input.styleImages.length > 4) {
      throw new Error(
        `generateWithStyle requires 1-4 style images, got ${input.styleImages.length}`,
      );
    }
    const body: Record<string, unknown> = {
      description: input.description,
      image_size: { width: input.width ?? 64, height: input.height ?? 64 },
      style_images: input.styleImages.map((s) => ({
        image: { base64: s.base64 },
        width: s.width,
        height: s.height,
      })),
    };
    if (input.styleDescription) body.style_description = input.styleDescription;
    if (input.noBackground !== undefined) body.no_background = input.noBackground;
    if (input.seed !== undefined) body.seed = input.seed;

    const submit = await this.request<{
      background_job_id: string;
      status: string;
      usage: Usage | null;
    }>("POST", "/generate-with-style-v2", body, { signal: opts.signal });

    const jobId = submit.data.background_job_id;
    const job = await this.pollJob(jobId, opts);
    if (job.status !== "completed") {
      throw new Error(`generate-with-style job ${jobId} ended with status "${job.status}"`);
    }
    const lr = job.lastResponse ?? {};
    return {
      images: (lr.images as PixelImage[]) ?? [],
      quantizedImages: (lr.quantized_images as PixelImage[]) ?? [],
      usage: job.usage,
      jobId,
      seed: lr.seed as number | undefined,
      raw: lr,
    };
  }

  // ---- characters ----

  /** Submit a v3 character generation. Returns immediately with ids; poll the job. */
  async createCharacterV3(input: CreateCharacterInput, opts?: RequestOptions): Promise<CharacterJob> {
    const body: Record<string, unknown> = { description: input.description };
    if (input.width || input.height) {
      body.image_size = { width: input.width ?? 64, height: input.height ?? 64 };
    }
    if (input.view) body.view = input.view;
    if (input.templateId) body.template_id = input.templateId;
    if (input.noBackground !== undefined) body.no_background = input.noBackground;
    if (input.seed !== undefined) body.seed = input.seed;
    if (input.enhancePrompt !== undefined) body.enhance_prompt = input.enhancePrompt;
    if (input.referenceImageBase64) body.reference_image = { base64: input.referenceImageBase64 };

    const { data } = await this.request<{
      character_id: string;
      background_job_id: string;
      status: string;
      usage: Usage | null;
      enhanced_prompt?: string | null;
    }>("POST", "/create-character-v3", body, opts);
    return {
      characterId: data.character_id,
      jobId: data.background_job_id,
      status: data.status,
      usage: data.usage ?? null,
      enhancedPrompt: data.enhanced_prompt ?? null,
    };
  }

  async getCharacter(id: string, opts?: RequestOptions): Promise<CharacterDetail> {
    const { data } = await this.request<CharacterDetail>("GET", `/characters/${id}`, undefined, opts);
    return data;
  }

  async listCharacters(opts?: RequestOptions): Promise<CharacterSummary[]> {
    const { data } = await this.request<{ characters?: CharacterSummary[] }>(
      "GET",
      "/characters",
      undefined,
      opts,
    );
    return data.characters ?? [];
  }

  async deleteCharacter(id: string, opts?: RequestOptions): Promise<void> {
    await this.request("DELETE", `/characters/${id}`, undefined, opts);
  }

  /** Download a rotation/asset URL. Tries unauthenticated (signed URLs), then Bearer. */
  async downloadUrl(url: string, opts?: RequestOptions): Promise<Uint8Array> {
    const full = url.startsWith("http") ? url : new URL(url, `${this.config.baseUrl}/`).toString();
    let res = await fetch(full, { signal: opts?.signal });
    if (res.status === 401 || res.status === 403) {
      res = await fetch(full, {
        headers: { Authorization: `Bearer ${this.config.token}` },
        signal: opts?.signal,
      });
    }
    if (!res.ok) {
      throw new PixelLabError(
        `Download failed (${res.status}) for ${full}`,
        res.status,
        await res.text().catch(() => ""),
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Create a character, poll to completion, and download all rotation images. */
  async createCharacterAndWait(
    input: CreateCharacterInput,
    opts: PollOptions = {},
  ): Promise<CharacterResult> {
    const sub = await this.createCharacterV3(input, { signal: opts.signal });
    const job = await this.pollJob(sub.jobId, opts);
    if (job.status !== "completed") {
      throw new Error(`Character job ${sub.jobId} ended with status "${job.status}"`);
    }
    const character = await this.getCharacter(sub.characterId, { signal: opts.signal });
    const rotations: Record<string, Uint8Array> = {};
    for (const [dir, url] of Object.entries(character.rotation_urls)) {
      if (typeof url === "string" && url) {
        rotations[dir] = await this.downloadUrl(url, { signal: opts.signal });
      }
    }
    return { character, rotations, usage: sub.usage };
  }

  // ---- objects (mirror characters) ----

  async createObject(
    input: CreateObjectInput,
    opts?: RequestOptions,
  ): Promise<{ objectId: string; jobId: string; status: string; usage: Usage | null }> {
    const endpoint =
      input.directions === 1 ? "/create-1-direction-object" : "/create-8-direction-object";
    const body: Record<string, unknown> = { description: input.description };
    // Both object endpoints take `size` as a single square integer (not {width,height}).
    if (input.size) body.size = input.size;
    if (input.view) body.view = input.view;
    if (input.referenceImageBase64) body.reference_image = { base64: input.referenceImageBase64 };
    if (input.styleImageBase64) body.style_image = { base64: input.styleImageBase64 };

    const { data } = await this.request<{
      object_id: string;
      background_job_id: string;
      status: string;
      usage: Usage | null;
    }>("POST", endpoint, body, opts);
    return {
      objectId: data.object_id,
      jobId: data.background_job_id,
      status: data.status,
      usage: data.usage ?? null,
    };
  }

  async getObject(id: string, opts?: RequestOptions): Promise<ObjectDetail> {
    const { data } = await this.request<ObjectDetail>("GET", `/objects/${id}`, undefined, opts);
    return data;
  }

  async listObjects(opts?: RequestOptions): Promise<ObjectSummary[]> {
    const { data } = await this.request<{ objects?: ObjectSummary[] }>(
      "GET",
      "/objects",
      undefined,
      opts,
    );
    return data.objects ?? [];
  }

  async deleteObject(id: string, opts?: RequestOptions): Promise<void> {
    await this.request("DELETE", `/objects/${id}`, undefined, opts);
  }

  async createObjectAndWait(input: CreateObjectInput, opts: PollOptions = {}): Promise<ObjectResult> {
    const sub = await this.createObject(input, { signal: opts.signal });
    const job = await this.pollJob(sub.jobId, opts);
    if (job.status !== "completed") {
      throw new Error(`Object job ${sub.jobId} ended with status "${job.status}"`);
    }
    const object = await this.getObject(sub.objectId, { signal: opts.signal });
    const rotations: Record<string, Uint8Array> = {};
    // Objects deliver via rotation_urls (8-dir) and/or storage_urls (1-dir uses "unknown").
    const sources: Record<string, string | null> = {
      ...(object.rotation_urls as unknown as Record<string, string | null>),
      ...(object.storage_urls ?? {}),
    };
    for (const [dir, url] of Object.entries(sources)) {
      if (typeof url === "string" && url) {
        rotations[dir] = await this.downloadUrl(url, { signal: opts.signal });
      }
    }
    // 1-direction objects (small size) finish in `review`: download the candidate
    // frames so the caller can present them and call selectObjectFrames.
    const frames: Uint8Array[] = [];
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
  async selectObjectFrames(
    objectId: string,
    indices: number[],
    commonTag?: string,
    opts?: RequestOptions,
  ): Promise<{ createdObjectIds: string[]; usage: Usage | null }> {
    const body: Record<string, unknown> = { indices };
    if (commonTag) body.common_tag = commonTag;
    const { data } = await this.request<{
      created_object_ids?: string[];
      usage?: Usage | null;
    }>("POST", `/objects/${objectId}/select-frames`, body, opts);
    return { createdObjectIds: data.created_object_ids ?? [], usage: data.usage ?? null };
  }

  // ---- character animations (async, one job per direction) ----

  async animateCharacter(
    input: AnimateCharacterInput,
    opts?: RequestOptions,
  ): Promise<{ jobIds: string[]; directions: string[]; status: string; usage: Usage | null }> {
    const body: Record<string, unknown> = {
      character_id: input.characterId,
      action_description: input.actionDescription,
      enhance_prompt: input.enhancePrompt ?? true,
    };
    if (input.animationName) body.animation_name = input.animationName;
    if (input.mode) body.mode = input.mode;
    if (input.templateAnimationId) body.template_animation_id = input.templateAnimationId;
    if (input.frameCount !== undefined) body.frame_count = input.frameCount;
    if (input.directions && input.directions.length) body.directions = input.directions;
    if (input.seed !== undefined) body.seed = input.seed;

    const { data } = await this.request<{
      background_job_ids?: string[];
      directions?: string[];
      status: string;
      usage?: Usage | null;
    }>("POST", "/animate-character", body, opts);
    return {
      jobIds: data.background_job_ids ?? [],
      directions: data.directions ?? [],
      status: data.status,
      usage: data.usage ?? null,
    };
  }

  /** Submit an animation and poll every per-direction job to completion. */
  async animateCharacterAndWait(
    input: AnimateCharacterInput,
    opts: PollOptions = {},
  ): Promise<AnimateResult> {
    const sub = await this.animateCharacter(input, { signal: opts.signal });
    await Promise.all(sub.jobIds.map((id) => this.pollJob(id, opts)));
    const character = await this.getCharacter(input.characterId, { signal: opts.signal });
    return { character, directions: sub.directions, jobIds: sub.jobIds };
  }

  // ---- single-image generation & editing ----

  /** Submit an async image job, poll it, and collect the resulting image(s). */
  private async runImageJob(
    endpoint: string,
    body: Record<string, unknown>,
    opts: PollOptions,
  ): Promise<{ images: PixelImage[]; usage: Usage | null }> {
    const submit = await this.request<{
      background_job_id: string;
      status: string;
      usage: Usage | null;
    }>("POST", endpoint, body, { signal: opts.signal });
    const job = await this.pollJob(submit.data.background_job_id, opts);
    if (job.status !== "completed") {
      throw new Error(`${endpoint} job ${submit.data.background_job_id} ended with status "${job.status}"`);
    }
    const lr = job.lastResponse ?? {};
    const images =
      (lr.images as PixelImage[]) ?? (lr.image ? [lr.image as PixelImage] : []);
    return { images, usage: job.usage };
  }

  /** Pixen text->image (synchronous). */
  async generatePixen(
    input: { description: string; width?: number; height?: number; noBackground?: boolean; seed?: number },
    opts?: RequestOptions,
  ): Promise<{ image: PixelImage; usage: Usage | null }> {
    const body: Record<string, unknown> = {
      description: input.description,
      image_size: { width: input.width ?? 64, height: input.height ?? 64 },
    };
    if (input.noBackground !== undefined) body.no_background = input.noBackground;
    if (input.seed !== undefined) body.seed = input.seed;
    const { data } = await this.request<{ image: PixelImage; usage: Usage | null }>(
      "POST",
      "/create-image-pixen",
      body,
      opts,
    );
    return { image: data.image, usage: data.usage ?? null };
  }

  /** Convert an image to pixel art (synchronous). */
  async imageToPixelart(
    input: { imageBase64: string; width: number; height: number; outputWidth?: number; outputHeight?: number },
    opts?: RequestOptions,
  ): Promise<{ image: PixelImage; usage: Usage | null }> {
    const body = {
      image: { base64: input.imageBase64 },
      image_size: { width: input.width, height: input.height },
      output_size: { width: input.outputWidth ?? input.width, height: input.outputHeight ?? input.height },
    };
    const { data } = await this.request<{ image: PixelImage; usage: Usage | null }>(
      "POST",
      "/image-to-pixelart",
      body,
      opts,
    );
    return { image: data.image, usage: data.usage ?? null };
  }

  /** Remove background (synchronous). */
  async removeBackground(
    input: { imageBase64: string; width: number; height: number },
    opts?: RequestOptions,
  ): Promise<{ image: PixelImage; usage: Usage | null }> {
    const body = { image: { base64: input.imageBase64 }, image_size: { width: input.width, height: input.height } };
    const { data } = await this.request<{ image: PixelImage; usage: Usage | null }>(
      "POST",
      "/remove-background",
      body,
      opts,
    );
    return { image: data.image, usage: data.usage ?? null };
  }

  /** Rotate an object/character image (synchronous). */
  async rotate(
    input: { imageBase64: string; width: number; height: number; fromDirection?: string; toDirection?: string },
    opts?: RequestOptions,
  ): Promise<{ image: PixelImage; usage: Usage | null }> {
    const body: Record<string, unknown> = {
      from_image: { base64: input.imageBase64 },
      image_size: { width: input.width, height: input.height },
    };
    if (input.fromDirection) body.from_direction = input.fromDirection;
    if (input.toDirection) body.to_direction = input.toDirection;
    const { data } = await this.request<{ image: PixelImage; usage: Usage | null }>(
      "POST",
      "/rotate",
      body,
      opts,
    );
    return { image: data.image, usage: data.usage ?? null };
  }

  /** Intelligently resize pixel art (synchronous). */
  async resize(
    input: {
      imageBase64: string;
      width: number;
      height: number;
      targetWidth: number;
      targetHeight: number;
      description: string;
    },
    opts?: RequestOptions,
  ): Promise<{ image: PixelImage; usage: Usage | null }> {
    const body = {
      description: input.description,
      reference_image: { base64: input.imageBase64 },
      reference_image_size: { width: input.width, height: input.height },
      target_size: { width: input.targetWidth, height: input.targetHeight },
    };
    const { data } = await this.request<{ image: PixelImage; usage: Usage | null }>(
      "POST",
      "/resize",
      body,
      opts,
    );
    return { image: data.image, usage: data.usage ?? null };
  }

  /** Edit an image from a text description (async, Pro). */
  async editImage(
    input: { imageBase64: string; width: number; height: number; description: string },
    opts: PollOptions = {},
  ): Promise<{ image: PixelImage | null; usage: Usage | null }> {
    const body = {
      image: { base64: input.imageBase64 },
      image_size: { width: input.width, height: input.height },
      description: input.description,
      width: input.width,
      height: input.height,
    };
    const { images, usage } = await this.runImageJob("/edit-image", body, opts);
    return { image: images[0] ?? null, usage };
  }

  /** Generate pixel-art UI elements (async, Pro). */
  async generateUI(
    input: { description: string; width?: number; height?: number },
    opts: PollOptions = {},
  ): Promise<{ images: PixelImage[]; usage: Usage | null }> {
    const body: Record<string, unknown> = { description: input.description };
    if (input.width || input.height) {
      body.image_size = { width: input.width ?? 64, height: input.height ?? 64 };
    }
    return this.runImageJob("/generate-ui-v2", body, opts);
  }

  /**
   * Inpaint: regenerate the masked region of an image from a description (synchronous).
   * `maskImageBase64` is a black/white mask — white pixels are repainted.
   */
  async inpaint(
    input: {
      description: string;
      width: number;
      height: number;
      imageBase64: string;
      maskBase64: string;
      noBackground?: boolean;
      seed?: number;
    },
    opts?: RequestOptions,
  ): Promise<{ image: PixelImage | null; usage: Usage | null }> {
    const body: Record<string, unknown> = {
      description: input.description,
      image_size: { width: input.width, height: input.height },
      inpainting_image: { base64: input.imageBase64 },
      mask_image: { base64: input.maskBase64 },
    };
    if (input.noBackground !== undefined) body.no_background = input.noBackground;
    if (input.seed !== undefined) body.seed = input.seed;
    const { data } = await this.request<{ image: PixelImage | null; usage: Usage | null }>(
      "POST",
      "/inpaint",
      body,
      opts,
    );
    return { image: data.image ?? null, usage: data.usage ?? null };
  }

  // ---- tilesets (scenes) ----

  async createTileset(
    input: CreateTilesetInput,
    opts?: RequestOptions,
  ): Promise<{ tilesetId: string; jobId: string; status: string; usage: Usage | null }> {
    const sidescroller = input.kind === "sidescroller";
    const body: Record<string, unknown> = {
      lower_description: input.lowerDescription,
      tile_size: { width: input.tileWidth ?? 16, height: input.tileHeight ?? 16 },
    };
    if (!sidescroller) {
      body.upper_description = input.upperDescription ?? input.lowerDescription;
      if (input.view) body.view = input.view;
    }
    if (input.transitionDescription) body.transition_description = input.transitionDescription;
    if (input.seed !== undefined) body.seed = input.seed;

    const endpoint = sidescroller ? "/create-tileset-sidescroller" : "/create-tileset";
    const { data } = await this.request<{
      background_job_id: string;
      tileset_id: string;
      status: string;
      usage: Usage | null;
    }>("POST", endpoint, body, opts);
    return {
      tilesetId: data.tileset_id,
      jobId: data.background_job_id,
      status: data.status,
      usage: data.usage ?? null,
    };
  }

  async getTileset(id: string, opts?: RequestOptions): Promise<TilesetDetail> {
    const { data } = await this.request<TilesetDetail>("GET", `/tilesets/${id}`, undefined, opts);
    return data;
  }

  async listTilesets(opts?: RequestOptions): Promise<Array<Record<string, unknown>>> {
    const { data } = await this.request<{ tilesets?: Array<Record<string, unknown>> }>(
      "GET",
      "/tilesets",
      undefined,
      opts,
    );
    return data.tilesets ?? [];
  }

  async createTilesetAndWait(input: CreateTilesetInput, opts: PollOptions = {}): Promise<TilesetResult> {
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
      usage: sub.usage,
    };
  }

  // ---- isometric tiles (async, single image) ----

  async createIsometricTile(
    input: CreateIsometricTileInput,
    opts?: RequestOptions,
  ): Promise<{ tileId: string; jobId: string; status: string; usage: Usage | null }> {
    const size = input.size ?? 32;
    const body: Record<string, unknown> = {
      description: input.description,
      image_size: { width: size, height: size },
    };
    if (input.shape) body.isometric_tile_shape = input.shape;
    if (input.tileSize) body.isometric_tile_size = input.tileSize;
    if (input.seed !== undefined) body.seed = input.seed;

    const { data } = await this.request<{
      background_job_id: string;
      tile_id: string;
      status: string;
      usage: Usage | null;
    }>("POST", "/create-isometric-tile", body, opts);
    return {
      tileId: data.tile_id,
      jobId: data.background_job_id,
      status: data.status,
      usage: data.usage ?? null,
    };
  }

  async getIsometricTile(id: string, opts?: RequestOptions): Promise<{ image: PixelImage | null; usage: Usage | null }> {
    const { data } = await this.request<{ image: PixelImage | null; usage: Usage | null }>(
      "GET",
      `/isometric-tiles/${id}`,
      undefined,
      opts,
    );
    return { image: data.image ?? null, usage: data.usage ?? null };
  }

  async createIsometricTileAndWait(
    input: CreateIsometricTileInput,
    opts: PollOptions = {},
  ): Promise<{ tileId: string; image: PixelImage | null; usage: Usage | null }> {
    const sub = await this.createIsometricTile(input, { signal: opts.signal });
    const job = await this.pollJob(sub.jobId, opts);
    if (job.status !== "completed") {
      throw new Error(`Isometric tile job ${sub.jobId} ended with status "${job.status}"`);
    }
    const { image, usage } = await this.getIsometricTile(sub.tileId, { signal: opts.signal });
    return { tileId: sub.tileId, image, usage: usage ?? sub.usage };
  }
}
