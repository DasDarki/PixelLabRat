import { defineStore } from "pinia";
import type { Balance } from "@pixellabrat/core";
import type {
  AssetRecord,
  CharacterRecord,
  ObjectRecord,
  ObjectReviewRecord,
  ProjectManifest,
  ProjectSummary,
  StyleContract,
  TilesetRecord,
} from "@pixellabrat/store";
import type {
  AgentEvent,
  CreateCharacterRequest,
  CreateIsometricTileRequest,
  CreateObjectRequest,
  CreateTilesetRequest,
  EditOp,
  GenerateInput,
  InpaintRequest,
  ReviewAction,
} from "../shared/api";

interface ChatTool {
  name: string;
  summary?: string;
}
interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  tools: ChatTool[];
}

export type Lightbox =
  | { kind: "image"; title: string; src: string }
  | { kind: "animation"; title: string; frames: string[] };

interface State {
  projects: ProjectSummary[];
  balance: Balance | null;
  currentSlug: string | null;
  manifest: ProjectManifest | null;
  assets: AssetRecord[];
  characters: CharacterRecord[];
  objects: ObjectRecord[];
  objectReviews: ObjectReviewRecord[];
  tilesets: TilesetRecord[];
  generating: boolean;
  progress: number;
  creatingCharacter: boolean;
  characterProgress: number;
  creatingObject: boolean;
  objectProgress: number;
  creatingTileset: boolean;
  tilesetProgress: number;
  animatingCharacterId: string | null;
  animationProgress: number;
  error: string | null;
  // assistant
  chatOpen: boolean;
  agentAvailable: boolean;
  authVia: string;
  authStored: boolean;
  connecting: boolean;
  chatBusy: boolean;
  chat: ChatMessage[];
  lightbox: Lightbox | null;
}

export const useApp = defineStore("app", {
  state: (): State => ({
    projects: [],
    balance: null,
    currentSlug: null,
    manifest: null,
    assets: [],
    characters: [],
    objects: [],
    objectReviews: [],
    tilesets: [],
    generating: false,
    progress: 0,
    creatingCharacter: false,
    characterProgress: 0,
    creatingObject: false,
    objectProgress: 0,
    creatingTileset: false,
    tilesetProgress: 0,
    animatingCharacterId: null,
    animationProgress: 0,
    error: null,
    chatOpen: false,
    agentAvailable: false,
    authVia: "none",
    authStored: false,
    connecting: false,
    chatBusy: false,
    chat: [],
    lightbox: null,
  }),
  getters: {
    style: (s): StyleContract | null => s.manifest?.style ?? null,
    refCount: (s): number => s.manifest?.style.refs.length ?? 0,
  },
  actions: {
    async init() {
      window.api.onGenerateProgress((p) => {
        this.progress = p;
      });
      window.api.onCharacterProgress((p) => {
        this.characterProgress = p;
      });
      window.api.onObjectProgress((p) => {
        this.objectProgress = p;
      });
      window.api.onTilesetProgress((p) => {
        this.tilesetProgress = p;
      });
      window.api.onAnimationProgress((p) => {
        this.animationProgress = p;
      });
      window.api.onAgentEvent((e) => this.onAgentEvent(e));
      await this.loadAuth();
      await Promise.all([this.refreshProjects(), this.refreshBalance()]);
      if (!this.currentSlug && this.projects.length) await this.open(this.projects[0]!.slug);
    },
    async refreshBalance() {
      try {
        this.balance = await window.api.getBalance();
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
      }
    },
    async refreshProjects() {
      this.projects = await window.api.listProjects();
    },
    async createProject(name: string) {
      const slug = await window.api.createProject(name);
      await this.refreshProjects();
      await this.open(slug);
    },
    async open(slug: string) {
      if (slug !== this.currentSlug) this.chat = [];
      this.currentSlug = slug;
      const data = await window.api.getProject(slug);
      this.manifest = data.manifest;
      this.assets = data.assets;
      this.characters = data.characters;
      this.objects = data.objects;
      this.objectReviews = data.objectReviews;
      this.tilesets = data.tilesets;
    },
    async saveStyle(patch: Partial<StyleContract>) {
      if (!this.currentSlug) return;
      const style = await window.api.setStyle(this.currentSlug, patch);
      if (this.manifest) this.manifest.style = style;
    },
    async addRef() {
      if (!this.currentSlug) return;
      await window.api.addRef(this.currentSlug);
      await this.open(this.currentSlug);
      await this.refreshProjects();
    },
    async removeRef(file: string) {
      if (!this.currentSlug) return;
      await window.api.removeRef(this.currentSlug, file);
      await this.open(this.currentSlug);
      await this.refreshProjects();
    },
    async generate(input: GenerateInput) {
      if (!this.currentSlug || this.generating) return;
      this.generating = true;
      this.progress = 0;
      this.error = null;
      try {
        await window.api.generate(this.currentSlug, input);
        await this.open(this.currentSlug);
        await this.refreshProjects();
        await this.refreshBalance();
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
      } finally {
        this.generating = false;
        this.progress = 0;
      }
    },
    async generateUI(input: { description: string; size?: { width: number; height: number } }) {
      if (!this.currentSlug || this.generating) return;
      this.generating = true;
      this.progress = 0;
      this.error = null;
      try {
        await window.api.generateUI(this.currentSlug, input);
        await this.open(this.currentSlug);
        await this.refreshProjects();
        await this.refreshBalance();
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
      } finally {
        this.generating = false;
        this.progress = 0;
      }
    },

    async editAsset(assetId: string, spec: EditOp): Promise<boolean> {
      if (!this.currentSlug || this.generating) return false;
      this.generating = true;
      this.progress = 0;
      this.error = null;
      try {
        await window.api.editAsset(this.currentSlug, assetId, spec);
        await this.open(this.currentSlug);
        await this.refreshProjects();
        await this.refreshBalance();
        return true;
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
        return false;
      } finally {
        this.generating = false;
        this.progress = 0;
      }
    },

    async review(id: string, action: ReviewAction, rating?: number) {
      if (!this.currentSlug) return;
      const data = await window.api.review(this.currentSlug, id, action, rating);
      this.manifest = data.manifest;
      this.assets = data.assets;
      await this.refreshProjects();
      await this.refreshBalance();
    },

    async createCharacter(input: CreateCharacterRequest) {
      if (!this.currentSlug || this.creatingCharacter) return;
      this.creatingCharacter = true;
      this.characterProgress = 0;
      this.error = null;
      try {
        await window.api.createCharacter(this.currentSlug, input);
        await this.open(this.currentSlug);
        await this.refreshProjects();
        await this.refreshBalance();
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
      } finally {
        this.creatingCharacter = false;
        this.characterProgress = 0;
      }
    },

    async deleteCharacter(id: string) {
      if (!this.currentSlug) return;
      this.characters = await window.api.deleteCharacter(this.currentSlug, id);
      await this.refreshProjects();
    },

    async animateCharacter(
      characterId: string,
      actionDescription: string,
      opts: { frameCount?: number; directions?: string[] } = {},
    ) {
      if (!this.currentSlug || this.animatingCharacterId) return;
      this.animatingCharacterId = characterId;
      this.animationProgress = 0;
      this.error = null;
      try {
        await window.api.animateCharacter(this.currentSlug, {
          characterId,
          actionDescription,
          frameCount: opts.frameCount,
          directions: opts.directions,
        });
        await this.open(this.currentSlug);
        await this.refreshBalance();
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
      } finally {
        this.animatingCharacterId = null;
        this.animationProgress = 0;
      }
    },

    async createObject(input: CreateObjectRequest) {
      if (!this.currentSlug || this.creatingObject) return;
      this.creatingObject = true;
      this.objectProgress = 0;
      this.error = null;
      try {
        await window.api.createObject(this.currentSlug, input);
        await this.open(this.currentSlug);
        await this.refreshProjects();
        await this.refreshBalance();
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
      } finally {
        this.creatingObject = false;
        this.objectProgress = 0;
      }
    },

    async deleteObject(id: string) {
      if (!this.currentSlug) return;
      this.objects = await window.api.deleteObject(this.currentSlug, id);
      await this.refreshProjects();
    },

    async selectObjectFrames(objectId: string, indices: number[]) {
      if (!this.currentSlug || indices.length === 0) return;
      this.error = null;
      try {
        await window.api.selectObjectFrames(this.currentSlug, objectId, indices);
        await this.open(this.currentSlug);
        await this.refreshProjects();
        await this.refreshBalance();
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
      }
    },

    async discardObjectReview(objectId: string) {
      if (!this.currentSlug) return;
      this.objectReviews = await window.api.discardObjectReview(this.currentSlug, objectId);
    },

    async createIsometricTile(input: CreateIsometricTileRequest) {
      // Iso tiles land in the image library, so they share the `generating` busy state.
      if (!this.currentSlug || this.generating) return;
      this.generating = true;
      this.progress = 0;
      this.error = null;
      try {
        await window.api.createIsometricTile(this.currentSlug, input);
        await this.open(this.currentSlug);
        await this.refreshProjects();
        await this.refreshBalance();
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
      } finally {
        this.generating = false;
        this.progress = 0;
      }
    },

    async inpaintAsset(input: InpaintRequest): Promise<boolean> {
      if (!this.currentSlug) return false;
      this.error = null;
      try {
        await window.api.inpaintAsset(this.currentSlug, input);
        await this.open(this.currentSlug);
        await this.refreshProjects();
        await this.refreshBalance();
        return true;
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
        return false;
      }
    },

    async createTileset(input: CreateTilesetRequest) {
      if (!this.currentSlug || this.creatingTileset) return;
      this.creatingTileset = true;
      this.tilesetProgress = 0;
      this.error = null;
      try {
        await window.api.createTileset(this.currentSlug, input);
        await this.open(this.currentSlug);
        await this.refreshProjects();
        await this.refreshBalance();
      } catch (e) {
        this.error = (e as Error).message ?? String(e);
      } finally {
        this.creatingTileset = false;
        this.tilesetProgress = 0;
      }
    },

    async deleteTileset(id: string) {
      if (!this.currentSlug) return;
      this.tilesets = await window.api.deleteTileset(this.currentSlug, id);
      await this.refreshProjects();
    },

    async loadAuth() {
      const s = await window.api.authStatus();
      this.agentAvailable = s.mode !== "none";
      this.authVia = s.via;
      this.authStored = s.stored;
    },
    async connectClaude() {
      this.connecting = true;
      this.error = null;
      try {
        const r = await window.api.connectClaude();
        if (!r.ok) this.error = r.error ?? "Verbindung fehlgeschlagen.";
      } finally {
        this.connecting = false;
        await this.loadAuth();
      }
    },
    async setClaudeToken(token: string): Promise<boolean> {
      const r = await window.api.setClaudeToken(token);
      if (!r.ok) {
        this.error = r.error ?? "Token ungültig.";
        return false;
      }
      await this.loadAuth();
      return true;
    },
    async disconnectClaude() {
      await window.api.disconnectClaude();
      await this.loadAuth();
    },

    toggleChat() {
      this.chatOpen = !this.chatOpen;
    },

    viewImage(src: string, title: string) {
      if (src) this.lightbox = { kind: "image", title, src };
    },
    viewAnimation(frames: string[], title: string) {
      if (frames.length) this.lightbox = { kind: "animation", title, frames };
    },
    closeLightbox() {
      this.lightbox = null;
    },

    sendChat(text: string) {
      const t = text.trim();
      if (!t || !this.currentSlug || this.chatBusy) return;
      this.chat.push({ role: "user", text: t, tools: [] });
      this.chat.push({ role: "assistant", text: "", tools: [] });
      this.chatBusy = true;
      window.api.agentSend(this.currentSlug, t);
    },

    async resetChat() {
      if (this.currentSlug) await window.api.agentReset(this.currentSlug);
      this.chat = [];
      this.chatBusy = false;
    },

    onAgentEvent(e: AgentEvent) {
      const cur = this.chat[this.chat.length - 1];
      if (!cur || cur.role !== "assistant") return;
      switch (e.type) {
        case "text":
          cur.text += e.text;
          break;
        case "tool_use":
          cur.tools.push({ name: e.name });
          break;
        case "tool_result": {
          const last = cur.tools[cur.tools.length - 1];
          if (last && !last.summary) last.summary = e.summary;
          break;
        }
        case "asset":
          if (this.currentSlug) {
            void this.open(this.currentSlug);
            void this.refreshProjects();
            void this.refreshBalance();
          }
          break;
        case "done":
          this.chatBusy = false;
          break;
        case "error":
          cur.text += `${cur.text ? "\n\n" : ""}⚠️ ${e.message}`;
          this.chatBusy = false;
          break;
      }
    },
  },
});
