import {
  base64ToBytes,
  type PixelImage,
  type PixelLab,
  type PollOptions,
  type Usage,
} from "@pixellabrat/core";
import type { Project } from "./project";
import type {
  AssetRecord,
  CharacterRecord,
  ImageSize,
  ObjectRecord,
  ObjectReviewRecord,
  TilesetRecord,
} from "./types";

export interface GenerateInput {
  description: string;
  size?: ImageSize;
  seed?: number;
}

export interface GenerateOutput {
  asset: AssetRecord;
  /** Which path was taken given the project's style contract. */
  mode: "generate-with-style-v2" | "create-image-pixflux";
  candidates: number;
}

/**
 * Generate an image *for a project*, automatically applying its style contract.
 *
 * - If the project has style references -> generate-with-style-v2 (consistent).
 * - Otherwise -> pixflux with the style's soft hints (cheap drafts / anchors).
 *
 * The result is saved as a draft asset in the project's library.
 */
export async function generateForProject(
  client: PixelLab,
  project: Project,
  input: GenerateInput,
  pollOpts?: PollOptions,
): Promise<GenerateOutput> {
  const style = project.getStyle();
  const size = input.size ?? style.defaultSize;

  if (style.refs.length > 0) {
    const styleImages = project.loadRefs();
    const res = await client.generateWithStyle(
      {
        description: input.description,
        styleImages,
        width: size.width,
        height: size.height,
        styleDescription: style.styleDescription,
        noBackground: style.noBackground,
        seed: input.seed,
      },
      pollOpts ?? {},
    );
    const first = res.images[0];
    if (!first) throw new Error("Style generation returned no images");
    const asset = project.addAsset({
      bytes: base64ToBytes(first.base64),
      prompt: input.description,
      endpoint: "generate-with-style-v2",
      params: {
        styleRefs: style.refs.map((r) => r.file),
        styleDescription: style.styleDescription,
        noBackground: style.noBackground,
      },
      usage: res.usage,
      seed: res.seed ?? input.seed,
      size,
    });
    return { asset, mode: "generate-with-style-v2", candidates: res.images.length };
  }

  const res = await client.generatePixflux({
    description: input.description,
    width: size.width,
    height: size.height,
    noBackground: style.noBackground,
    seed: input.seed,
  });
  const asset = project.addAsset({
    bytes: base64ToBytes(res.image.base64),
    prompt: input.description,
    endpoint: "create-image-pixflux",
    params: { noBackground: style.noBackground },
    usage: res.usage,
    seed: input.seed,
    size,
  });
  return { asset, mode: "create-image-pixflux", candidates: 1 };
}

export interface CreateCharacterInput {
  description: string;
  size?: ImageSize;
  /** 4 or 8. Default 8. */
  directions?: number;
  view?: string;
  seed?: number;
}

export interface CreateCharacterOutput {
  character: CharacterRecord;
  directionsDownloaded: number;
}

/**
 * Create a v3 character for a project, applying the project's style description,
 * poll it to completion, download all rotations, and persist it. Costly (8 rotations).
 */
export async function createCharacterForProject(
  client: PixelLab,
  project: Project,
  input: CreateCharacterInput,
  pollOpts?: PollOptions,
): Promise<CreateCharacterOutput> {
  const style = project.getStyle();
  const size = input.size ?? style.defaultSize;
  const description = style.styleDescription
    ? `${input.description}. Style: ${style.styleDescription}`
    : input.description;

  const view = input.view ?? style.view;
  const res = await client.createCharacterAndWait(
    {
      description,
      width: size.width,
      height: size.height,
      ...(view ? { view } : {}),
      noBackground: style.noBackground,
      seed: input.seed,
      enhancePrompt: true,
    },
    pollOpts ?? {},
  );

  const character = project.addCharacter({
    id: res.character.id,
    name: res.character.name,
    prompt: res.character.prompt,
    size: res.character.size,
    directions: res.character.directions,
    view: res.character.view ?? undefined,
    rotations: res.rotations,
    usage: res.usage,
  });
  return { character, directionsDownloaded: Object.keys(res.rotations).length };
}

export interface CreateObjectInput {
  description: string;
  /** Square size in pixels (32-256). */
  size?: number;
  directions?: number;
  view?: string;
}

export interface CreateObjectOutput {
  /** Set when the object completed directly (8-direction, or large 1-direction). */
  object?: ObjectRecord;
  directionsDownloaded: number;
  /** Set when a 1-direction object finished in `review`: candidates await selection. */
  review?: ObjectReviewRecord;
}

/** Create a directional object for a project (applies style description), poll + download + persist. */
export async function createObjectForProject(
  client: PixelLab,
  project: Project,
  input: CreateObjectInput,
  pollOpts?: PollOptions,
): Promise<CreateObjectOutput> {
  const style = project.getStyle();
  const size = input.size ?? style.defaultSize.width;
  const view = input.view ?? style.view;
  const description = style.styleDescription
    ? `${input.description}. Style: ${style.styleDescription}`
    : input.description;

  const res = await client.createObjectAndWait(
    {
      description,
      size,
      directions: input.directions ?? 8,
      ...(view ? { view } : {}),
    },
    pollOpts ?? {},
  );

  // 1-direction objects (small size) finish in `review` with candidate frames
  // instead of rotations — stash them for selectObjectFramesForProject.
  if (res.status === "review" && res.frames.length) {
    const review = project.addObjectReview({
      id: res.object.id,
      prompt: input.description,
      size,
      view: res.object.view ?? view ?? undefined,
      frames: res.frames,
    });
    return { directionsDownloaded: 0, review };
  }

  const object = project.addObject({
    id: res.object.id,
    name: res.object.name ?? input.description.slice(0, 50),
    prompt: res.object.prompt,
    size: res.object.size,
    directions: res.object.directions,
    view: res.object.view ?? undefined,
    rotations: res.rotations,
    usage: res.usage,
  });
  return { object, directionsDownloaded: Object.keys(res.rotations).length };
}

/**
 * Resolve an object review by keeping the chosen candidate frames. Each selected
 * index becomes its own completed object (downloaded + persisted). The review is
 * then cleared.
 */
export async function selectObjectFramesForProject(
  client: PixelLab,
  project: Project,
  objectId: string,
  indices: number[],
  pollOpts?: PollOptions,
): Promise<{ objects: ObjectRecord[] }> {
  const review = project.getObjectReview(objectId);
  if (!review) throw new Error(`No pending object review: ${objectId}`);

  const { createdObjectIds } = await client.selectObjectFrames(objectId, indices);

  const objects: ObjectRecord[] = [];
  for (const id of createdObjectIds) {
    // The new single objects may need a brief moment; getObject + download.
    const detail = await client.getObject(id, { signal: pollOpts?.signal });
    const sources: Record<string, string | null> = {
      ...(detail.rotation_urls as unknown as Record<string, string | null>),
      ...(detail.storage_urls ?? {}),
    };
    const rotations: Record<string, Uint8Array> = {};
    for (const [dir, url] of Object.entries(sources)) {
      if (typeof url === "string" && url) {
        rotations[dir] = await client.downloadUrl(url, { signal: pollOpts?.signal });
      }
    }
    objects.push(
      project.addObject({
        id: detail.id,
        name: detail.name ?? review.prompt.slice(0, 50),
        prompt: detail.prompt ?? review.prompt,
        size: detail.size ?? { width: review.size, height: review.size },
        directions: detail.directions ?? 1,
        view: detail.view ?? review.view ?? undefined,
        rotations,
      }),
    );
  }

  project.deleteObjectReview(objectId);
  return { objects };
}

export interface AnimateInput {
  characterId: string;
  actionDescription: string;
  animationName?: string;
  frameCount?: number;
  /** Which directions to animate. Omitted/empty = south only. */
  directions?: string[];
}

/** Animate a character (poll all per-direction jobs), download + persist the frames. */
export async function animateCharacterForProject(
  client: PixelLab,
  project: Project,
  input: AnimateInput,
  pollOpts?: PollOptions,
): Promise<{ name: string; directions: string[]; frameCount: number }> {
  const res = await client.animateCharacterAndWait(
    {
      characterId: input.characterId,
      actionDescription: input.actionDescription,
      animationName: input.animationName,
      frameCount: input.frameCount,
      ...(input.directions?.length ? { directions: input.directions } : {}),
      enhancePrompt: true,
    },
    pollOpts ?? {},
  );

  const name = input.animationName ?? input.actionDescription;
  const groups = res.character.animations ?? [];
  const group =
    groups.find((g) => g.display_name === name) ??
    groups.find((g) => g.animation_type === name) ??
    groups[groups.length - 1];
  if (!group) return { name, directions: [], frameCount: 0 };

  const frames: Record<string, Uint8Array[]> = {};
  for (const d of group.directions) {
    const downloaded: Uint8Array[] = [];
    for (const url of d.frames) downloaded.push(await client.downloadUrl(url));
    frames[d.direction] = downloaded;
  }

  project.addCharacterAnimation(input.characterId, {
    type: group.animation_type,
    displayName: group.display_name ?? input.animationName ?? input.actionDescription,
    frames,
  });

  const frameCount = Object.values(frames).reduce((sum, f) => sum + f.length, 0);
  return { name: group.display_name ?? group.animation_type, directions: Object.keys(frames), frameCount };
}

// ---------------------------------------------------------------------------
// Single-image generation & editing (results land in the asset library)
// ---------------------------------------------------------------------------

/** Generate a pixel-art UI element for a project (generate-ui-v2) and save it. */
export async function generateUIForProject(
  client: PixelLab,
  project: Project,
  input: { description: string; size?: ImageSize },
  pollOpts?: PollOptions,
): Promise<AssetRecord> {
  const size = input.size ?? project.getStyle().defaultSize;
  const { images, usage } = await client.generateUI(
    { description: input.description, width: size.width, height: size.height },
    pollOpts ?? {},
  );
  const img = images[0];
  if (!img) throw new Error("UI generation returned no images");
  return project.addAsset({
    bytes: base64ToBytes(img.base64),
    prompt: input.description,
    endpoint: "generate-ui-v2",
    params: {},
    usage,
    size,
  });
}

export type EditOp =
  | { op: "remove-background" }
  | { op: "image-to-pixelart"; outputWidth?: number; outputHeight?: number }
  | { op: "edit"; description: string }
  | { op: "rotate"; fromDirection?: string; toDirection?: string }
  | { op: "resize"; targetWidth: number; targetHeight: number; description?: string };

/** Apply an image operation to an existing asset and save the result as a new asset. */
export async function editAssetForProject(
  client: PixelLab,
  project: Project,
  assetId: string,
  spec: EditOp,
  pollOpts?: PollOptions,
): Promise<AssetRecord> {
  const src = project.getAsset(assetId);
  if (!src) throw new Error(`Asset not found: ${assetId}`);
  const base64 = Buffer.from(project.readAssetBytes(assetId)).toString("base64");
  const w = src.size.width;
  const h = src.size.height;

  let image: PixelImage | null = null;
  let usage: Usage | null = null;
  let endpoint: string = spec.op;
  let outSize: ImageSize = { width: w, height: h };

  switch (spec.op) {
    case "remove-background": {
      const r = await client.removeBackground({ imageBase64: base64, width: w, height: h });
      image = r.image;
      usage = r.usage;
      endpoint = "remove-background";
      break;
    }
    case "image-to-pixelart": {
      outSize = { width: spec.outputWidth ?? w, height: spec.outputHeight ?? h };
      const r = await client.imageToPixelart({
        imageBase64: base64,
        width: w,
        height: h,
        outputWidth: outSize.width,
        outputHeight: outSize.height,
      });
      image = r.image;
      usage = r.usage;
      endpoint = "image-to-pixelart";
      break;
    }
    case "edit": {
      const r = await client.editImage(
        { imageBase64: base64, width: w, height: h, description: spec.description },
        pollOpts ?? {},
      );
      image = r.image;
      usage = r.usage;
      endpoint = "edit-image";
      break;
    }
    case "rotate": {
      const r = await client.rotate({
        imageBase64: base64,
        width: w,
        height: h,
        fromDirection: spec.fromDirection,
        toDirection: spec.toDirection,
      });
      image = r.image;
      usage = r.usage;
      endpoint = "rotate";
      break;
    }
    case "resize": {
      outSize = { width: spec.targetWidth, height: spec.targetHeight };
      const r = await client.resize({
        imageBase64: base64,
        width: w,
        height: h,
        targetWidth: spec.targetWidth,
        targetHeight: spec.targetHeight,
        description: spec.description ?? src.prompt,
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
    parentId: assetId,
  });
}

export interface CreateTilesetInput {
  lowerDescription: string;
  /** Required for top-down; ignored for sidescroller. */
  upperDescription?: string;
  transitionDescription?: string;
  tileWidth?: number;
  tileHeight?: number;
  view?: string;
  /** "top-down" (default) or "sidescroller". */
  kind?: "top-down" | "sidescroller";
}

/** Create a tileset (top-down or sidescroller scene terrain), poll it, download all tiles, and persist. */
export async function createTilesetForProject(
  client: PixelLab,
  project: Project,
  input: CreateTilesetInput,
  pollOpts?: PollOptions,
): Promise<TilesetRecord> {
  const sidescroller = input.kind === "sidescroller";
  const upperDescription = sidescroller ? "" : input.upperDescription ?? input.lowerDescription;
  const res = await client.createTilesetAndWait(
    {
      lowerDescription: input.lowerDescription,
      ...(sidescroller ? {} : { upperDescription }),
      transitionDescription: input.transitionDescription,
      tileWidth: input.tileWidth ?? 16,
      tileHeight: input.tileHeight ?? 16,
      view: input.view,
      kind: input.kind ?? "top-down",
    },
    pollOpts ?? {},
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
      description: t.description ?? undefined,
    })),
    usage: res.usage,
  });
}

export interface CreateIsometricTileInput {
  description: string;
  /** Square size in pixels (16-64). Default 32. */
  size?: number;
  /** "thin tile" | "thick tile" | "block". Default "block". */
  shape?: string;
  seed?: number;
}

/** Generate a single isometric tile and save it to the asset library. */
export async function createIsometricTileForProject(
  client: PixelLab,
  project: Project,
  input: CreateIsometricTileInput,
  pollOpts?: PollOptions,
): Promise<AssetRecord> {
  const style = project.getStyle();
  const size = input.size ?? 32;
  const description = style.styleDescription
    ? `${input.description}. Style: ${style.styleDescription}`
    : input.description;
  const res = await client.createIsometricTileAndWait(
    { description, size, shape: input.shape, seed: input.seed },
    pollOpts ?? {},
  );
  if (!res.image) throw new Error("Isometric tile generation returned no image");
  return project.addAsset({
    bytes: base64ToBytes(res.image.base64),
    prompt: input.description,
    endpoint: "create-isometric-tile",
    params: { shape: input.shape ?? "block", isometric: true, ...(input.seed !== undefined ? { seed: input.seed } : {}) },
    usage: res.usage,
    seed: input.seed,
    size: { width: size, height: size },
  });
}

/** Inpaint the masked region of an existing asset; save the result as a new asset. */
export async function inpaintAssetForProject(
  client: PixelLab,
  project: Project,
  input: { assetId: string; maskBase64: string; description: string; seed?: number },
): Promise<AssetRecord> {
  const src = project.getAsset(input.assetId);
  if (!src) throw new Error(`Asset not found: ${input.assetId}`);
  const style = project.getStyle();
  const base64 = Buffer.from(project.readAssetBytes(input.assetId)).toString("base64");
  const description = style.styleDescription
    ? `${input.description}. Style: ${style.styleDescription}`
    : input.description;
  const { image, usage } = await client.inpaint({
    description,
    width: src.size.width,
    height: src.size.height,
    imageBase64: base64,
    maskBase64: input.maskBase64,
    noBackground: style.noBackground,
    seed: input.seed,
  });
  if (!image) throw new Error("Inpaint returned no image");
  return project.addAsset({
    bytes: base64ToBytes(image.base64),
    prompt: `inpaint: ${input.description}`,
    endpoint: "inpaint",
    params: { sourceAssetId: input.assetId, ...(input.seed !== undefined ? { seed: input.seed } : {}) },
    usage,
    seed: input.seed,
    size: src.size,
    parentId: input.assetId,
  });
}
