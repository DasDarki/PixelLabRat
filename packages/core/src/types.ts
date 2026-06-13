/** How a call was billed. NOTE: while an async job is `processing`, the API
 * returns a PLACEHOLDER usage of {type:"usd", usd:0}. The real charge only
 * appears once the job is `completed`. Always read usage from the final job. */
export type UsageType = "generations" | "usd";

export interface Usage {
  type: UsageType;
  generations?: number | null;
  usd?: number | null;
}

export interface Balance {
  credits: { type?: string; usd: number };
  subscription: {
    type?: string;
    status: string;
    plan?: string | null;
    /** Generations remaining this billing period */
    generations: number;
    /** Total generations granted by the subscription */
    total: number;
  };
}

/** A base64-encoded image as returned by / sent to the API. */
export interface PixelImage {
  base64: string;
  format?: string;
  width?: number;
  height?: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export type Direction =
  | "south"
  | "north"
  | "east"
  | "west"
  | "south-east"
  | "north-east"
  | "north-west"
  | "south-west";

export const ALL_DIRECTIONS: Direction[] = [
  "south",
  "north",
  "east",
  "west",
  "south-east",
  "north-east",
  "north-west",
  "south-west",
];

export interface CharacterSize {
  width: number;
  height: number;
}

export interface CharacterRotationUrls {
  south: string;
  west: string;
  east: string;
  north: string;
  "south-east"?: string | null;
  "north-east"?: string | null;
  "north-west"?: string | null;
  "south-west"?: string | null;
}

export interface AnimationDirection {
  direction: string;
  frame_count: number;
  /** Public URLs for each frame, in order. */
  frames: string[];
}

export interface AnimationGroup {
  animation_type: string;
  display_name?: string | null;
  animation_group_id?: string | null;
  directions: AnimationDirection[];
}

export interface CharacterDetail {
  id: string;
  name: string;
  prompt: string;
  size: CharacterSize;
  directions: number;
  view?: string | null;
  created_at?: string;
  animation_count?: number;
  template_id?: string;
  rotation_urls: CharacterRotationUrls;
  animations?: AnimationGroup[];
}

export interface CharacterSummary {
  id: string;
  name: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Objects (structurally mirror characters)
// ---------------------------------------------------------------------------

export interface ObjectDetail {
  id: string;
  name?: string | null;
  prompt: string;
  size: CharacterSize;
  directions: number;
  view?: string | null;
  created_at?: string;
  rotation_urls: CharacterRotationUrls;
  /** Raw direction->url map. For 1-direction objects the single key is "unknown". */
  storage_urls?: Record<string, string | null>;
  /** Candidate frame URLs when status==="review". */
  frame_urls?: string[] | null;
  status?: string | null;
}

export interface ObjectSummary {
  id: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tilesets (scenes)
// ---------------------------------------------------------------------------

export interface TileSize {
  width: number;
  height: number;
}

export interface TilesetTile {
  id: string;
  /** Corner-based name, e.g. "NW+SE" or "none". */
  name: string;
  image: PixelImage;
  description?: string | null;
}

export interface TilesetData {
  total_tiles: number;
  tile_size: { width: number; height: number };
  terrain_types: string[];
  tiles: TilesetTile[];
}

export interface TilesetDetail {
  tileset: TilesetData;
  metadata?: unknown;
  usage?: Usage | null;
}

/** Human-readable one-liner for a usage object. */
export function formatUsage(usage: Usage | null | undefined): string {
  if (!usage) return "unknown";
  if (usage.type === "generations") return `${usage.generations ?? 0} generations`;
  return `$${(usage.usd ?? 0).toFixed(4)}`;
}
