import type { Usage } from "@pixellabrat/core";

export interface ImageSize {
  width: number;
  height: number;
}

/** A style reference image stored under the project's refs/ folder. */
export interface StyleRefMeta {
  file: string; // relative path within the project, e.g. "refs/<id>.png"
  width: number;
  height: number;
  addedAt: string;
  /** If this ref was promoted from a generated asset, its id. */
  fromAssetId?: string;
}

/**
 * The per-project style contract — appended to every follow-up generation so
 * results stay consistent. Refs drive generate-with-style-v2; palette / axes
 * are for the bitforge path (wired in a later step).
 */
export interface StyleContract {
  styleDescription?: string;
  /** Hex colors, e.g. "#aabbcc" — forced palette for bitforge (later). */
  palette?: string[];
  /** Up to 4 active style references. */
  refs: StyleRefMeta[];
  outline?: string;
  shading?: string;
  detail?: string;
  view?: string;
  isometric?: boolean;
  noBackground?: boolean;
  negative?: string;
  defaultSize: ImageSize;
}

export type AssetStatus = "draft" | "approved" | "rejected";

export interface AssetRecord {
  id: string;
  kind: "image";
  /** Relative path within the project, e.g. "assets/<id>.png". */
  file: string;
  status: AssetStatus;
  rating?: number;
  prompt: string;
  endpoint: string;
  params: Record<string, unknown>;
  usage?: Usage | null;
  seed?: number;
  size: ImageSize;
  /** If derived from another asset (e.g. an edit), its id. */
  parentId?: string;
  note?: string;
  createdAt: string;
}

export interface CharacterAnimationRecord {
  /** animation_type, e.g. "walk". */
  type: string;
  displayName?: string;
  /** direction -> ordered frame file paths (characters/<id>/animations/<type>/<dir>/<i>.png) */
  frames: Record<string, string[]>;
}

export interface CharacterRecord {
  /** PixelLab character_id (server-persisted). */
  id: string;
  name: string;
  prompt: string;
  size: ImageSize;
  directions: number;
  view?: string;
  /** direction -> relative path within the project (characters/<id>/<dir>.png) */
  rotations: Record<string, string>;
  animations?: CharacterAnimationRecord[];
  usage?: Usage | null;
  createdAt: string;
}

export interface ObjectRecord {
  /** PixelLab object_id (server-persisted). */
  id: string;
  name: string;
  prompt: string;
  size: ImageSize;
  directions: number;
  view?: string;
  /** direction -> relative path within the project (objects/<id>/<dir>.png) */
  rotations: Record<string, string>;
  usage?: Usage | null;
  createdAt: string;
}

/**
 * A 1-direction object that finished in `review` status: PixelLab returned
 * several candidate frames; the user (or agent) picks which to keep, each
 * becoming its own completed object. Held until select-frames is called.
 */
export interface ObjectReviewRecord {
  /** PixelLab object_id (the review group). */
  id: string;
  prompt: string;
  /** Square size in pixels. */
  size: number;
  view?: string;
  /** Candidate frame file paths (objects/_reviews/<id>/<i>.png), in order. */
  frames: string[];
  createdAt: string;
}

export interface TilesetTileRecord {
  id: string;
  name: string;
  /** relative path (tilesets/<id>/<tileId>.png) */
  file: string;
  description?: string;
}

export interface TilesetRecord {
  /** PixelLab tileset_id. */
  id: string;
  lowerDescription: string;
  upperDescription: string;
  tileSize: ImageSize;
  totalTiles: number;
  terrainTypes: string[];
  tiles: TilesetTileRecord[];
  usage?: Usage | null;
  createdAt: string;
}

export interface ProjectManifest {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  style: StyleContract;
}

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  assetCount: number;
  refCount: number;
  characterCount: number;
  objectCount: number;
  tilesetCount: number;
}

export const DEFAULT_SIZE: ImageSize = { width: 64, height: 64 };
export const MAX_REFS = 4;
