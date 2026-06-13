import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dialog, ipcMain } from "electron";
import { PixelLab } from "@pixellabrat/core";
import {
  animateCharacterForProject,
  createCharacterForProject,
  createIsometricTileForProject,
  createObjectForProject,
  createTilesetForProject,
  editAssetForProject,
  generateForProject,
  generateUIForProject,
  inpaintAssetForProject,
  openStore,
  selectObjectFramesForProject,
  type EditOp,
  type Store,
} from "@pixellabrat/store";
import { createBackend, type AgentBackend, type McpServerSpec } from "@pixellabrat/agent";
import {
  computeAuthStatus,
  connectClaude,
  disconnectClaude,
  setClaudeToken,
} from "./auth";
import type {
  CreateCharacterRequest,
  CreateIsometricTileRequest,
  CreateObjectRequest,
  CreateTilesetRequest,
  GenerateInput,
  InpaintRequest,
  ReviewAction,
} from "../shared/api";

let client: PixelLab | null = null;
function getClient(): PixelLab {
  if (!client) client = new PixelLab();
  return client;
}

function toDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

export function registerIpc(projectsRoot: string, mcpServer: McpServerSpec): void {
  const store: Store = openStore(projectsRoot);

  ipcMain.handle("balance:get", () => getClient().getBalance());

  ipcMain.handle("project:list", () => store.list());

  ipcMain.handle("project:create", (_e, name: string) => store.createProject(name).slug);

  ipcMain.handle("project:get", (_e, slug: string) => {
    const p = store.open(slug);
    return {
      manifest: p.getManifest(),
      assets: p.listAssets(),
      characters: p.listCharacters(),
      objects: p.listObjects(),
      objectReviews: p.listObjectReviews(),
      tilesets: p.listTilesets(),
    };
  });

  ipcMain.handle("project:setStyle", (_e, slug: string, patch) => store.open(slug).setStyle(patch));

  ipcMain.handle("project:addRef", async (_e, slug: string) => {
    const res = await dialog.showOpenDialog({
      title: "Add style reference",
      filters: [{ name: "PNG", extensions: ["png"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (res.canceled) return { added: 0 };
    const p = store.open(slug);
    let added = 0;
    for (const f of res.filePaths) {
      try {
        p.addRefFromBytes(new Uint8Array(readFileSync(f)));
        added++;
      } catch {
        // skip non-PNG / over-cap
      }
    }
    return { added };
  });

  ipcMain.handle("project:removeRef", (_e, slug: string, file: string) =>
    store.open(slug).removeRef(file),
  );

  ipcMain.handle("project:generate", async (e, slug: string, input: GenerateInput) => {
    const p = store.open(slug);
    const out = await generateForProject(getClient(), p, input, {
      onProgress: (progress) => e.sender.send("project:generateProgress", progress),
    });
    return out.asset;
  });

  ipcMain.handle(
    "project:generateUI",
    async (e, slug: string, input: { description: string; size?: { width: number; height: number } }) => {
      const p = store.open(slug);
      return generateUIForProject(getClient(), p, input, {
        onProgress: (progress) => e.sender.send("project:generateProgress", progress),
      });
    },
  );

  ipcMain.handle(
    "project:editAsset",
    async (e, slug: string, assetId: string, spec: EditOp) => {
      const p = store.open(slug);
      return editAssetForProject(getClient(), p, assetId, spec, {
        onProgress: (progress) => e.sender.send("project:generateProgress", progress),
      });
    },
  );

  ipcMain.handle("project:assetImage", (_e, slug: string, id: string) =>
    toDataUrl(store.open(slug).readAssetBytes(id)),
  );

  ipcMain.handle("project:refImage", (_e, slug: string, file: string) => {
    const p = store.open(slug);
    return toDataUrl(new Uint8Array(readFileSync(join(p.dir, file))));
  });

  ipcMain.handle(
    "project:review",
    (_e, slug: string, id: string, action: ReviewAction, rating?: number) => {
      const p = store.open(slug);
      if (action === "promote") p.promoteAssetToRef(id);
      else p.setAssetStatus(id, action === "approve" ? "approved" : "rejected");
      if (rating !== undefined) p.rateAsset(id, rating);
      return { manifest: p.getManifest(), assets: p.listAssets() };
    },
  );

  // ---- characters ----
  ipcMain.handle("project:characterImage", (_e, slug: string, id: string, direction: string) =>
    toDataUrl(store.open(slug).readCharacterImage(id, direction)),
  );

  ipcMain.handle(
    "project:createCharacter",
    async (e, slug: string, input: CreateCharacterRequest) => {
      const p = store.open(slug);
      const size =
        input.width || input.height
          ? { width: input.width ?? 64, height: input.height ?? 64 }
          : undefined;
      const out = await createCharacterForProject(
        getClient(),
        p,
        { description: input.description, size, view: input.view, seed: input.seed },
        { onProgress: (progress) => e.sender.send("project:characterProgress", progress) },
      );
      return out.character;
    },
  );

  ipcMain.handle("project:deleteCharacter", (_e, slug: string, id: string) => {
    const p = store.open(slug);
    p.deleteCharacter(id);
    return p.listCharacters();
  });

  ipcMain.handle(
    "project:animateCharacter",
    async (
      e,
      slug: string,
      input: {
        characterId: string;
        actionDescription: string;
        animationName?: string;
        frameCount?: number;
        directions?: string[];
      },
    ) => {
      const p = store.open(slug);
      await animateCharacterForProject(getClient(), p, input, {
        onProgress: (progress) => e.sender.send("project:animationProgress", progress),
      });
      return p.getCharacter(input.characterId);
    },
  );

  ipcMain.handle(
    "project:animationFrame",
    (_e, slug: string, characterId: string, animType: string, direction: string, frameIndex: number) =>
      toDataUrl(store.open(slug).readAnimationFrame(characterId, animType, direction, frameIndex)),
  );

  // ---- objects ----
  ipcMain.handle("project:objectImage", (_e, slug: string, id: string, direction: string) =>
    toDataUrl(store.open(slug).readObjectImage(id, direction)),
  );

  ipcMain.handle(
    "project:createObject",
    async (e, slug: string, input: CreateObjectRequest) => {
      const p = store.open(slug);
      const out = await createObjectForProject(getClient(), p, input, {
        onProgress: (progress) => e.sender.send("project:objectProgress", progress),
      });
      return { object: out.object, review: out.review };
    },
  );

  ipcMain.handle("project:deleteObject", (_e, slug: string, id: string) => {
    const p = store.open(slug);
    p.deleteObject(id);
    return p.listObjects();
  });

  // ---- object reviews (1-direction candidate frames) ----
  ipcMain.handle(
    "project:objectReviewFrame",
    (_e, slug: string, objectId: string, frameIndex: number) =>
      toDataUrl(store.open(slug).readObjectReviewFrame(objectId, frameIndex)),
  );

  ipcMain.handle(
    "project:selectObjectFrames",
    async (_e, slug: string, objectId: string, indices: number[]) => {
      const p = store.open(slug);
      const { objects } = await selectObjectFramesForProject(getClient(), p, objectId, indices);
      return objects;
    },
  );

  ipcMain.handle("project:discardObjectReview", (_e, slug: string, objectId: string) => {
    const p = store.open(slug);
    p.deleteObjectReview(objectId);
    return p.listObjectReviews();
  });

  // ---- tilesets ----
  ipcMain.handle("project:tileImage", (_e, slug: string, tilesetId: string, tileId: string) =>
    toDataUrl(store.open(slug).readTileImage(tilesetId, tileId)),
  );

  ipcMain.handle(
    "project:createTileset",
    async (e, slug: string, input: CreateTilesetRequest) => {
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
          kind: input.kind ?? "top-down",
        },
        { onProgress: (progress) => e.sender.send("project:tilesetProgress", progress) },
      );
      return ts;
    },
  );

  ipcMain.handle(
    "project:createIsometricTile",
    async (e, slug: string, input: CreateIsometricTileRequest) => {
      const p = store.open(slug);
      return createIsometricTileForProject(getClient(), p, input, {
        onProgress: (progress) => e.sender.send("project:tilesetProgress", progress),
      });
    },
  );

  ipcMain.handle("project:deleteTileset", (_e, slug: string, id: string) => {
    const p = store.open(slug);
    p.deleteTileset(id);
    return p.listTilesets();
  });

  // ---- inpaint (asset region repaint) ----
  ipcMain.handle("project:inpaint", async (_e, slug: string, input: InpaintRequest) => {
    const p = store.open(slug);
    return inpaintAssetForProject(getClient(), p, input);
  });

  // ---- auth (switchable: API key, Claude subscription via login/token, or none) ----
  ipcMain.handle("auth:status", () => computeAuthStatus());
  ipcMain.handle("auth:connect", () => connectClaude());
  ipcMain.handle("auth:setToken", (_e, token: string) => setClaudeToken(token));
  ipcMain.handle("auth:disconnect", () => disconnectClaude());

  // ---- embedded Claude agent ----
  const agents = new Map<string, AgentBackend>();

  ipcMain.handle("agent:available", async () => (await computeAuthStatus()).mode !== "none");

  ipcMain.handle("agent:reset", (_e, slug: string) => {
    agents.get(slug)?.reset();
  });

  ipcMain.on("agent:send", async (e, slug: string, text: string) => {
    const status = await computeAuthStatus();
    if (status.mode === "none") {
      e.sender.send("agent:event", {
        type: "error",
        message: "Nicht verbunden — verbinde dich mit deinem Claude-Abo oder setze ANTHROPIC_API_KEY.",
      });
      return;
    }
    try {
      let agent = agents.get(slug);
      if (!agent) {
        const created = createBackend(
          store.open(slug),
          { pixel: getClient(), mcp: mcpServer },
          {},
          status.mode,
        );
        if (!created) {
          e.sender.send("agent:event", { type: "error", message: "Assistent nicht verfügbar." });
          return;
        }
        agent = created;
        agents.set(slug, agent);
      }
      agent.setProject(store.open(slug)); // freshest state from the UI
      await agent.send(text, (event) => e.sender.send("agent:event", event));
    } catch (err) {
      e.sender.send("agent:event", { type: "error", message: (err as Error).message ?? String(err) });
    }
  });
}
