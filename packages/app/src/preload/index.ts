import { contextBridge, ipcRenderer } from "electron";
import type { PixelApi } from "../shared/api";

const api: PixelApi = {
  getBalance: () => ipcRenderer.invoke("balance:get"),
  listProjects: () => ipcRenderer.invoke("project:list"),
  createProject: (name) => ipcRenderer.invoke("project:create", name),
  getProject: (slug) => ipcRenderer.invoke("project:get", slug),
  setStyle: (slug, patch) => ipcRenderer.invoke("project:setStyle", slug, patch),
  addRef: (slug) => ipcRenderer.invoke("project:addRef", slug),
  removeRef: (slug, file) => ipcRenderer.invoke("project:removeRef", slug, file),
  generate: (slug, input) => ipcRenderer.invoke("project:generate", slug, input),
  generateUI: (slug, input) => ipcRenderer.invoke("project:generateUI", slug, input),
  assetImage: (slug, id) => ipcRenderer.invoke("project:assetImage", slug, id),
  refImage: (slug, file) => ipcRenderer.invoke("project:refImage", slug, file),
  review: (slug, id, action, rating) =>
    ipcRenderer.invoke("project:review", slug, id, action, rating),
  inpaintAsset: (slug, input) => ipcRenderer.invoke("project:inpaint", slug, input),
  editAsset: (slug, assetId, spec) => ipcRenderer.invoke("project:editAsset", slug, assetId, spec),
  onGenerateProgress: (cb) => {
    const handler = (_e: unknown, progress: number) => cb(progress);
    ipcRenderer.on("project:generateProgress", handler);
    return () => ipcRenderer.off("project:generateProgress", handler);
  },

  characterImage: (slug, id, direction) =>
    ipcRenderer.invoke("project:characterImage", slug, id, direction),
  createCharacter: (slug, input) => ipcRenderer.invoke("project:createCharacter", slug, input),
  deleteCharacter: (slug, id) => ipcRenderer.invoke("project:deleteCharacter", slug, id),
  onCharacterProgress: (cb) => {
    const handler = (_e: unknown, progress: number) => cb(progress);
    ipcRenderer.on("project:characterProgress", handler);
    return () => ipcRenderer.off("project:characterProgress", handler);
  },

  animateCharacter: (slug, input) => ipcRenderer.invoke("project:animateCharacter", slug, input),
  animationFrame: (slug, characterId, animType, direction, frameIndex) =>
    ipcRenderer.invoke("project:animationFrame", slug, characterId, animType, direction, frameIndex),
  onAnimationProgress: (cb) => {
    const handler = (_e: unknown, progress: number) => cb(progress);
    ipcRenderer.on("project:animationProgress", handler);
    return () => ipcRenderer.off("project:animationProgress", handler);
  },

  objectImage: (slug, id, direction) => ipcRenderer.invoke("project:objectImage", slug, id, direction),
  createObject: (slug, input) => ipcRenderer.invoke("project:createObject", slug, input),
  deleteObject: (slug, id) => ipcRenderer.invoke("project:deleteObject", slug, id),
  onObjectProgress: (cb) => {
    const handler = (_e: unknown, progress: number) => cb(progress);
    ipcRenderer.on("project:objectProgress", handler);
    return () => ipcRenderer.off("project:objectProgress", handler);
  },

  objectReviewFrame: (slug, objectId, frameIndex) =>
    ipcRenderer.invoke("project:objectReviewFrame", slug, objectId, frameIndex),
  selectObjectFrames: (slug, objectId, indices) =>
    ipcRenderer.invoke("project:selectObjectFrames", slug, objectId, indices),
  discardObjectReview: (slug, objectId) =>
    ipcRenderer.invoke("project:discardObjectReview", slug, objectId),

  tileImage: (slug, tilesetId, tileId) =>
    ipcRenderer.invoke("project:tileImage", slug, tilesetId, tileId),
  createTileset: (slug, input) => ipcRenderer.invoke("project:createTileset", slug, input),
  createIsometricTile: (slug, input) => ipcRenderer.invoke("project:createIsometricTile", slug, input),
  deleteTileset: (slug, id) => ipcRenderer.invoke("project:deleteTileset", slug, id),
  onTilesetProgress: (cb) => {
    const handler = (_e: unknown, progress: number) => cb(progress);
    ipcRenderer.on("project:tilesetProgress", handler);
    return () => ipcRenderer.off("project:tilesetProgress", handler);
  },

  authStatus: () => ipcRenderer.invoke("auth:status"),
  connectClaude: () => ipcRenderer.invoke("auth:connect"),
  setClaudeToken: (token) => ipcRenderer.invoke("auth:setToken", token),
  disconnectClaude: () => ipcRenderer.invoke("auth:disconnect"),

  agentAvailable: () => ipcRenderer.invoke("agent:available"),
  agentSend: (slug, text) => ipcRenderer.send("agent:send", slug, text),
  agentReset: (slug) => ipcRenderer.invoke("agent:reset", slug),
  onAgentEvent: (cb) => {
    const handler = (_e: unknown, event: Parameters<typeof cb>[0]) => cb(event);
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.off("agent:event", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);
