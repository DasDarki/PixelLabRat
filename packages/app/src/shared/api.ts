import type { Balance } from "@pixellabrat/core";
import type { AgentEvent, AuthMode } from "@pixellabrat/agent";
import type {
  AssetRecord,
  CharacterRecord,
  EditOp,
  ImageSize,
  ObjectRecord,
  ObjectReviewRecord,
  ProjectManifest,
  ProjectSummary,
  StyleContract,
  TilesetRecord,
} from "@pixellabrat/store";

export type { AgentEvent, EditOp };

export interface ProjectData {
  manifest: ProjectManifest;
  assets: AssetRecord[];
  characters: CharacterRecord[];
  objects: ObjectRecord[];
  objectReviews: ObjectReviewRecord[];
  tilesets: TilesetRecord[];
}

export interface CreateCharacterRequest {
  description: string;
  width?: number;
  height?: number;
  view?: string;
  seed?: number;
}

export interface CreateObjectRequest {
  description: string;
  directions?: number;
  size?: number;
  view?: string;
}

/** A 1-direction object may finish in review (candidate frames) instead of completing. */
export interface CreateObjectResult {
  object?: ObjectRecord;
  review?: ObjectReviewRecord;
}

export interface CreateTilesetRequest {
  lowerDescription: string;
  upperDescription?: string;
  transitionDescription?: string;
  tileSize?: number;
  kind?: "top-down" | "sidescroller";
  view?: string;
}

export interface CreateIsometricTileRequest {
  description: string;
  size?: number;
  shape?: string;
  seed?: number;
}

export interface InpaintRequest {
  assetId: string;
  maskBase64: string;
  description: string;
  seed?: number;
}

export interface AnimateRequest {
  characterId: string;
  actionDescription: string;
  animationName?: string;
  frameCount?: number;
  directions?: string[];
}

export interface GenerateInput {
  description: string;
  size?: ImageSize;
  seed?: number;
}

export type ReviewAction = "approve" | "reject" | "promote";

export interface AuthStatus {
  mode: AuthMode;
  via: string;
  stored: boolean;
}

/** The surface exposed to the renderer via contextBridge (window.api). */
export interface PixelApi {
  getBalance(): Promise<Balance>;
  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<string>;
  getProject(slug: string): Promise<ProjectData>;
  setStyle(slug: string, patch: Partial<StyleContract>): Promise<StyleContract>;
  addRef(slug: string): Promise<{ added: number }>;
  removeRef(slug: string, file: string): Promise<void>;
  generate(slug: string, input: GenerateInput): Promise<AssetRecord>;
  generateUI(slug: string, input: { description: string; size?: ImageSize }): Promise<AssetRecord>;
  assetImage(slug: string, id: string): Promise<string>;
  refImage(slug: string, file: string): Promise<string>;
  review(slug: string, id: string, action: ReviewAction, rating?: number): Promise<ProjectData>;
  inpaintAsset(slug: string, input: InpaintRequest): Promise<AssetRecord>;
  editAsset(slug: string, assetId: string, spec: EditOp): Promise<AssetRecord>;
  onGenerateProgress(cb: (progress: number) => void): () => void;

  // Characters
  characterImage(slug: string, id: string, direction: string): Promise<string>;
  createCharacter(slug: string, input: CreateCharacterRequest): Promise<CharacterRecord>;
  deleteCharacter(slug: string, id: string): Promise<CharacterRecord[]>;
  onCharacterProgress(cb: (progress: number) => void): () => void;

  // Character animations
  animateCharacter(slug: string, input: AnimateRequest): Promise<CharacterRecord | undefined>;
  animationFrame(
    slug: string,
    characterId: string,
    animType: string,
    direction: string,
    frameIndex: number,
  ): Promise<string>;
  onAnimationProgress(cb: (progress: number) => void): () => void;

  // Objects
  objectImage(slug: string, id: string, direction: string): Promise<string>;
  createObject(slug: string, input: CreateObjectRequest): Promise<CreateObjectResult>;
  deleteObject(slug: string, id: string): Promise<ObjectRecord[]>;
  onObjectProgress(cb: (progress: number) => void): () => void;

  // Object reviews (1-direction candidate frames)
  objectReviewFrame(slug: string, objectId: string, frameIndex: number): Promise<string>;
  selectObjectFrames(slug: string, objectId: string, indices: number[]): Promise<ObjectRecord[]>;
  discardObjectReview(slug: string, objectId: string): Promise<ObjectReviewRecord[]>;

  // Tilesets
  tileImage(slug: string, tilesetId: string, tileId: string): Promise<string>;
  createTileset(slug: string, input: CreateTilesetRequest): Promise<TilesetRecord>;
  createIsometricTile(slug: string, input: CreateIsometricTileRequest): Promise<AssetRecord>;
  deleteTileset(slug: string, id: string): Promise<TilesetRecord[]>;
  onTilesetProgress(cb: (progress: number) => void): () => void;

  // Auth
  authStatus(): Promise<AuthStatus>;
  connectClaude(): Promise<{ ok: boolean; error?: string }>;
  setClaudeToken(token: string): Promise<{ ok: boolean; error?: string }>;
  disconnectClaude(): Promise<AuthStatus>;

  // Embedded Claude agent
  agentAvailable(): Promise<boolean>;
  agentSend(slug: string, text: string): void;
  agentReset(slug: string): Promise<void>;
  onAgentEvent(cb: (event: AgentEvent) => void): () => void;
}
