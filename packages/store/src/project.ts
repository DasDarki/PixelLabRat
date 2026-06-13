import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pngSize, type StyleRef } from "@pixellabrat/core";
import {
  type AssetRecord,
  type AssetStatus,
  type CharacterAnimationRecord,
  type CharacterRecord,
  type ImageSize,
  type ObjectRecord,
  type ObjectReviewRecord,
  type ProjectManifest,
  type StyleContract,
  type StyleRefMeta,
  type TilesetRecord,
  MAX_REFS,
} from "./types";

const MANIFEST = "project.json";
const LIBRARY = "library.json";
const CHARACTERS = "characters.json";
const OBJECTS = "objects.json";
const OBJECT_REVIEWS = "object-reviews.json";
const TILESETS = "tilesets.json";
const STYLE_GUIDE = "STYLE_GUIDE.md";

function now(): string {
  return new Date().toISOString();
}

/** A single project: manifest (style contract) + refs + asset library on disk. */
export class Project {
  readonly dir: string;
  private manifest: ProjectManifest;
  private library: AssetRecord[];
  private characters: CharacterRecord[];
  private objects: ObjectRecord[];
  private objectReviews: ObjectReviewRecord[];
  private tilesets: TilesetRecord[];

  private constructor(
    dir: string,
    manifest: ProjectManifest,
    library: AssetRecord[],
    characters: CharacterRecord[],
    objects: ObjectRecord[],
    objectReviews: ObjectReviewRecord[],
    tilesets: TilesetRecord[],
  ) {
    this.dir = dir;
    this.manifest = manifest;
    this.library = library;
    this.characters = characters;
    this.objects = objects;
    this.objectReviews = objectReviews;
    this.tilesets = tilesets;
  }

  static load(dir: string): Project {
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), "utf8")) as ProjectManifest;
    const readJson = <T>(name: string, fallback: T): T => {
      const p = join(dir, name);
      return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
    };
    return new Project(
      dir,
      manifest,
      readJson<AssetRecord[]>(LIBRARY, []),
      readJson<CharacterRecord[]>(CHARACTERS, []),
      readJson<ObjectRecord[]>(OBJECTS, []),
      readJson<ObjectReviewRecord[]>(OBJECT_REVIEWS, []),
      readJson<TilesetRecord[]>(TILESETS, []),
    );
  }

  static create(dir: string, manifest: ProjectManifest): Project {
    mkdirSync(join(dir, "refs"), { recursive: true });
    mkdirSync(join(dir, "assets"), { recursive: true });
    mkdirSync(join(dir, "characters"), { recursive: true });
    mkdirSync(join(dir, "objects"), { recursive: true });
    mkdirSync(join(dir, "tilesets"), { recursive: true });
    const p = new Project(dir, manifest, [], [], [], [], []);
    p.saveManifest();
    p.saveLibrary();
    writeFileSync(
      join(dir, STYLE_GUIDE),
      `# Style Guide — ${manifest.name}\n\n_What works, what to avoid, palette notes. Grows as you approve/reject assets._\n`,
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

  getManifest(): ProjectManifest {
    return structuredClone(this.manifest);
  }

  getStyle(): StyleContract {
    return structuredClone(this.manifest.style);
  }

  setStyle(patch: Partial<StyleContract>): StyleContract {
    this.manifest.style = { ...this.manifest.style, ...patch };
    this.saveManifest();
    return this.getStyle();
  }

  get styleGuidePath(): string {
    return join(this.dir, STYLE_GUIDE);
  }

  readStyleGuide(): string {
    return existsSync(this.styleGuidePath) ? readFileSync(this.styleGuidePath, "utf8") : "";
  }

  writeStyleGuide(content: string): void {
    writeFileSync(this.styleGuidePath, content);
  }

  // ---- refs ----

  /** Add a style reference from raw PNG bytes. Enforces the 4-ref cap. */
  addRefFromBytes(bytes: Uint8Array, opts: { fromAssetId?: string } = {}): StyleRefMeta {
    if (this.manifest.style.refs.length >= MAX_REFS) {
      throw new Error(`Style contract already has the maximum of ${MAX_REFS} references`);
    }
    const dims = pngSize(bytes);
    if (!dims) throw new Error("Reference is not a readable PNG");
    const id = crypto.randomUUID();
    const file = join("refs", `${id}.png`);
    writeFileSync(join(this.dir, file), bytes);
    const meta: StyleRefMeta = {
      file,
      width: dims.width,
      height: dims.height,
      addedAt: now(),
      ...(opts.fromAssetId ? { fromAssetId: opts.fromAssetId } : {}),
    };
    this.manifest.style.refs.push(meta);
    this.saveManifest();
    return meta;
  }

  removeRef(file: string): void {
    const before = this.manifest.style.refs.length;
    this.manifest.style.refs = this.manifest.style.refs.filter((r) => r.file !== file);
    if (this.manifest.style.refs.length === before) return;
    const abs = join(this.dir, file);
    if (existsSync(abs)) rmSync(abs);
    this.saveManifest();
  }

  /** Load the active style references as base64 + dims for the API. */
  loadRefs(): StyleRef[] {
    return this.manifest.style.refs.map((r) => ({
      base64: readFileSync(join(this.dir, r.file)).toString("base64"),
      width: r.width,
      height: r.height,
    }));
  }

  // ---- assets ----

  listAssets(): AssetRecord[] {
    return this.library.map((a) => structuredClone(a));
  }

  getAsset(id: string): AssetRecord | undefined {
    const a = this.library.find((x) => x.id === id);
    return a ? structuredClone(a) : undefined;
  }

  readAssetBytes(id: string): Uint8Array {
    const a = this.requireAsset(id);
    return new Uint8Array(readFileSync(join(this.dir, a.file)));
  }

  /** Persist a generated image + its metadata as a draft asset. */
  addAsset(input: {
    bytes: Uint8Array;
    prompt: string;
    endpoint: string;
    params: Record<string, unknown>;
    size: AssetRecord["size"];
    usage?: AssetRecord["usage"];
    seed?: number;
    parentId?: string;
    status?: AssetStatus;
  }): AssetRecord {
    const id = crypto.randomUUID();
    const file = join("assets", `${id}.png`);
    writeFileSync(join(this.dir, file), input.bytes);
    const record: AssetRecord = {
      id,
      kind: "image",
      file,
      status: input.status ?? "draft",
      prompt: input.prompt,
      endpoint: input.endpoint,
      params: input.params,
      usage: input.usage ?? null,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      size: input.size,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      createdAt: now(),
    };
    this.library.unshift(record);
    this.saveLibrary();
    return structuredClone(record);
  }

  setAssetStatus(id: string, status: AssetStatus): AssetRecord {
    const a = this.requireAsset(id);
    a.status = status;
    this.saveLibrary();
    return structuredClone(a);
  }

  rateAsset(id: string, rating: number): AssetRecord {
    const a = this.requireAsset(id);
    a.rating = rating;
    this.saveLibrary();
    return structuredClone(a);
  }

  setAssetNote(id: string, note: string): AssetRecord {
    const a = this.requireAsset(id);
    a.note = note;
    this.saveLibrary();
    return structuredClone(a);
  }

  /** Approve an asset and add it to the style references in one step. */
  promoteAssetToRef(id: string): StyleRefMeta {
    const a = this.requireAsset(id);
    a.status = "approved";
    this.saveLibrary();
    return this.addRefFromBytes(this.readAssetBytes(id), { fromAssetId: id });
  }

  // ---- characters ----

  listCharacters(): CharacterRecord[] {
    return this.characters.map((c) => structuredClone(c));
  }

  getCharacter(id: string): CharacterRecord | undefined {
    const c = this.characters.find((x) => x.id === id);
    return c ? structuredClone(c) : undefined;
  }

  readCharacterImage(id: string, direction: string): Uint8Array {
    const c = this.characters.find((x) => x.id === id);
    const file = c?.rotations[direction];
    if (!file) throw new Error(`No "${direction}" rotation for character ${id}`);
    return new Uint8Array(readFileSync(join(this.dir, file)));
  }

  /** Persist a generated character + its rotation images. */
  addCharacter(input: {
    id: string;
    name: string;
    prompt: string;
    size: ImageSize;
    directions: number;
    view?: string;
    rotations: Record<string, Uint8Array>;
    usage?: CharacterRecord["usage"];
  }): CharacterRecord {
    const dir = join("characters", input.id);
    mkdirSync(join(this.dir, dir), { recursive: true });
    const rotations: Record<string, string> = {};
    for (const [d, bytes] of Object.entries(input.rotations)) {
      const file = join(dir, `${d}.png`);
      writeFileSync(join(this.dir, file), bytes);
      rotations[d] = file;
    }
    const record: CharacterRecord = {
      id: input.id,
      name: input.name,
      prompt: input.prompt,
      size: input.size,
      directions: input.directions,
      ...(input.view ? { view: input.view } : {}),
      rotations,
      usage: input.usage ?? null,
      createdAt: now(),
    };
    this.characters = this.characters.filter((c) => c.id !== record.id);
    this.characters.unshift(record);
    this.saveCharacters();
    return structuredClone(record);
  }

  deleteCharacter(id: string): void {
    const before = this.characters.length;
    this.characters = this.characters.filter((c) => c.id !== id);
    if (this.characters.length === before) return;
    const dir = join(this.dir, "characters", id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    this.saveCharacters();
  }

  /** Persist a character animation's downloaded frames (per direction). */
  addCharacterAnimation(
    characterId: string,
    anim: { type: string; displayName?: string; frames: Record<string, Uint8Array[]> },
  ): void {
    const c = this.characters.find((x) => x.id === characterId);
    if (!c) return;
    const baseDir = join("characters", characterId, "animations", anim.type);
    const frames: Record<string, string[]> = {};
    for (const [dir, frameList] of Object.entries(anim.frames)) {
      const dirRel = join(baseDir, dir);
      mkdirSync(join(this.dir, dirRel), { recursive: true });
      frames[dir] = frameList.map((bytes, i) => {
        const file = join(dirRel, `${i}.png`);
        writeFileSync(join(this.dir, file), bytes);
        return file;
      });
    }
    const record: CharacterAnimationRecord = {
      type: anim.type,
      ...(anim.displayName ? { displayName: anim.displayName } : {}),
      frames,
    };
    c.animations = [...(c.animations ?? []).filter((a) => a.type !== anim.type), record];
    this.saveCharacters();
  }

  readAnimationFrame(
    characterId: string,
    animType: string,
    direction: string,
    frameIndex: number,
  ): Uint8Array {
    const file = this.characters
      .find((x) => x.id === characterId)
      ?.animations?.find((a) => a.type === animType)?.frames[direction]?.[frameIndex];
    if (!file) {
      throw new Error(`No animation frame ${animType}/${direction}/${frameIndex} for ${characterId}`);
    }
    return new Uint8Array(readFileSync(join(this.dir, file)));
  }

  // ---- objects (mirror characters) ----

  listObjects(): ObjectRecord[] {
    return this.objects.map((o) => structuredClone(o));
  }

  getObject(id: string): ObjectRecord | undefined {
    const o = this.objects.find((x) => x.id === id);
    return o ? structuredClone(o) : undefined;
  }

  readObjectImage(id: string, direction: string): Uint8Array {
    const o = this.objects.find((x) => x.id === id);
    const file = o?.rotations[direction];
    if (!file) throw new Error(`No "${direction}" rotation for object ${id}`);
    return new Uint8Array(readFileSync(join(this.dir, file)));
  }

  addObject(input: {
    id: string;
    name: string;
    prompt: string;
    size: ImageSize;
    directions: number;
    view?: string;
    rotations: Record<string, Uint8Array>;
    usage?: ObjectRecord["usage"];
  }): ObjectRecord {
    const dir = join("objects", input.id);
    mkdirSync(join(this.dir, dir), { recursive: true });
    const rotations: Record<string, string> = {};
    for (const [d, bytes] of Object.entries(input.rotations)) {
      const file = join(dir, `${d}.png`);
      writeFileSync(join(this.dir, file), bytes);
      rotations[d] = file;
    }
    const record: ObjectRecord = {
      id: input.id,
      name: input.name,
      prompt: input.prompt,
      size: input.size,
      directions: input.directions,
      ...(input.view ? { view: input.view } : {}),
      rotations,
      usage: input.usage ?? null,
      createdAt: now(),
    };
    this.objects = this.objects.filter((o) => o.id !== record.id);
    this.objects.unshift(record);
    this.saveObjects();
    return structuredClone(record);
  }

  deleteObject(id: string): void {
    const before = this.objects.length;
    this.objects = this.objects.filter((o) => o.id !== id);
    if (this.objects.length === before) return;
    const dir = join(this.dir, "objects", id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    this.saveObjects();
  }

  // ---- object reviews (1-direction candidate frames awaiting selection) ----

  listObjectReviews(): ObjectReviewRecord[] {
    return this.objectReviews.map((r) => structuredClone(r));
  }

  getObjectReview(id: string): ObjectReviewRecord | undefined {
    const r = this.objectReviews.find((x) => x.id === id);
    return r ? structuredClone(r) : undefined;
  }

  readObjectReviewFrame(objectId: string, frameIndex: number): Uint8Array {
    const file = this.objectReviews.find((x) => x.id === objectId)?.frames[frameIndex];
    if (!file) throw new Error(`No review frame ${frameIndex} for object ${objectId}`);
    return new Uint8Array(readFileSync(join(this.dir, file)));
  }

  /** Persist the candidate frames of a review-status object for later selection. */
  addObjectReview(input: {
    id: string;
    prompt: string;
    size: number;
    view?: string;
    frames: Uint8Array[];
  }): ObjectReviewRecord {
    const dir = join("objects", "_reviews", input.id);
    mkdirSync(join(this.dir, dir), { recursive: true });
    const frames = input.frames.map((bytes, i) => {
      const file = join(dir, `${i}.png`);
      writeFileSync(join(this.dir, file), bytes);
      return file;
    });
    const record: ObjectReviewRecord = {
      id: input.id,
      prompt: input.prompt,
      size: input.size,
      ...(input.view ? { view: input.view } : {}),
      frames,
      createdAt: now(),
    };
    this.objectReviews = this.objectReviews.filter((r) => r.id !== record.id);
    this.objectReviews.unshift(record);
    this.saveObjectReviews();
    return structuredClone(record);
  }

  deleteObjectReview(id: string): void {
    const before = this.objectReviews.length;
    this.objectReviews = this.objectReviews.filter((r) => r.id !== id);
    if (this.objectReviews.length === before) return;
    const dir = join(this.dir, "objects", "_reviews", id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    this.saveObjectReviews();
  }

  // ---- tilesets ----

  listTilesets(): TilesetRecord[] {
    return this.tilesets.map((t) => structuredClone(t));
  }

  getTileset(id: string): TilesetRecord | undefined {
    const t = this.tilesets.find((x) => x.id === id);
    return t ? structuredClone(t) : undefined;
  }

  readTileImage(tilesetId: string, tileId: string): Uint8Array {
    const file = this.tilesets.find((x) => x.id === tilesetId)?.tiles.find((t) => t.id === tileId)?.file;
    if (!file) throw new Error(`No tile ${tileId} in tileset ${tilesetId}`);
    return new Uint8Array(readFileSync(join(this.dir, file)));
  }

  addTileset(input: {
    id: string;
    lowerDescription: string;
    upperDescription: string;
    tileSize: ImageSize;
    totalTiles: number;
    terrainTypes: string[];
    tiles: Array<{ id: string; name: string; bytes: Uint8Array; description?: string }>;
    usage?: TilesetRecord["usage"];
  }): TilesetRecord {
    const dir = join("tilesets", input.id);
    mkdirSync(join(this.dir, dir), { recursive: true });
    const tiles = input.tiles.map((t) => {
      const file = join(dir, `${t.id}.png`);
      writeFileSync(join(this.dir, file), t.bytes);
      return { id: t.id, name: t.name, file, ...(t.description ? { description: t.description } : {}) };
    });
    const record: TilesetRecord = {
      id: input.id,
      lowerDescription: input.lowerDescription,
      upperDescription: input.upperDescription,
      tileSize: input.tileSize,
      totalTiles: input.totalTiles,
      terrainTypes: input.terrainTypes,
      tiles,
      usage: input.usage ?? null,
      createdAt: now(),
    };
    this.tilesets = this.tilesets.filter((t) => t.id !== record.id);
    this.tilesets.unshift(record);
    this.saveTilesets();
    return structuredClone(record);
  }

  deleteTileset(id: string): void {
    const before = this.tilesets.length;
    this.tilesets = this.tilesets.filter((t) => t.id !== id);
    if (this.tilesets.length === before) return;
    const dir = join(this.dir, "tilesets", id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    this.saveTilesets();
  }

  // ---- internals ----

  private requireAsset(id: string): AssetRecord {
    const a = this.library.find((x) => x.id === id);
    if (!a) throw new Error(`Asset not found: ${id}`);
    return a;
  }

  private saveManifest(): void {
    writeFileSync(join(this.dir, MANIFEST), JSON.stringify(this.manifest, null, 2));
  }

  private saveLibrary(): void {
    writeFileSync(join(this.dir, LIBRARY), JSON.stringify(this.library, null, 2));
  }

  private saveCharacters(): void {
    writeFileSync(join(this.dir, CHARACTERS), JSON.stringify(this.characters, null, 2));
  }

  private saveObjects(): void {
    writeFileSync(join(this.dir, OBJECTS), JSON.stringify(this.objects, null, 2));
  }

  private saveObjectReviews(): void {
    writeFileSync(join(this.dir, OBJECT_REVIEWS), JSON.stringify(this.objectReviews, null, 2));
  }

  private saveTilesets(): void {
    writeFileSync(join(this.dir, TILESETS), JSON.stringify(this.tilesets, null, 2));
  }

  summaryCounts(): {
    assetCount: number;
    refCount: number;
    characterCount: number;
    objectCount: number;
    tilesetCount: number;
  } {
    return {
      assetCount: this.library.length,
      refCount: this.manifest.style.refs.length,
      characterCount: this.characters.length,
      objectCount: this.objects.length,
      tilesetCount: this.tilesets.length,
    };
  }
}

export function listRefPngs(dir: string): string[] {
  const refs = join(dir, "refs");
  if (!existsSync(refs)) return [];
  return readdirSync(refs).filter((f) => f.endsWith(".png"));
}
