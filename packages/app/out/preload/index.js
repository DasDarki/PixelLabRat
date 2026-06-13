"use strict";
const electron = require("electron");
const api = {
  getBalance: () => electron.ipcRenderer.invoke("balance:get"),
  listProjects: () => electron.ipcRenderer.invoke("project:list"),
  createProject: (name) => electron.ipcRenderer.invoke("project:create", name),
  getProject: (slug) => electron.ipcRenderer.invoke("project:get", slug),
  setStyle: (slug, patch) => electron.ipcRenderer.invoke("project:setStyle", slug, patch),
  addRef: (slug) => electron.ipcRenderer.invoke("project:addRef", slug),
  removeRef: (slug, file) => electron.ipcRenderer.invoke("project:removeRef", slug, file),
  generate: (slug, input) => electron.ipcRenderer.invoke("project:generate", slug, input),
  generateUI: (slug, input) => electron.ipcRenderer.invoke("project:generateUI", slug, input),
  assetImage: (slug, id) => electron.ipcRenderer.invoke("project:assetImage", slug, id),
  refImage: (slug, file) => electron.ipcRenderer.invoke("project:refImage", slug, file),
  review: (slug, id, action, rating) => electron.ipcRenderer.invoke("project:review", slug, id, action, rating),
  inpaintAsset: (slug, input) => electron.ipcRenderer.invoke("project:inpaint", slug, input),
  editAsset: (slug, assetId, spec) => electron.ipcRenderer.invoke("project:editAsset", slug, assetId, spec),
  onGenerateProgress: (cb) => {
    const handler = (_e, progress) => cb(progress);
    electron.ipcRenderer.on("project:generateProgress", handler);
    return () => electron.ipcRenderer.off("project:generateProgress", handler);
  },
  characterImage: (slug, id, direction) => electron.ipcRenderer.invoke("project:characterImage", slug, id, direction),
  createCharacter: (slug, input) => electron.ipcRenderer.invoke("project:createCharacter", slug, input),
  deleteCharacter: (slug, id) => electron.ipcRenderer.invoke("project:deleteCharacter", slug, id),
  onCharacterProgress: (cb) => {
    const handler = (_e, progress) => cb(progress);
    electron.ipcRenderer.on("project:characterProgress", handler);
    return () => electron.ipcRenderer.off("project:characterProgress", handler);
  },
  animateCharacter: (slug, input) => electron.ipcRenderer.invoke("project:animateCharacter", slug, input),
  animationFrame: (slug, characterId, animType, direction, frameIndex) => electron.ipcRenderer.invoke("project:animationFrame", slug, characterId, animType, direction, frameIndex),
  onAnimationProgress: (cb) => {
    const handler = (_e, progress) => cb(progress);
    electron.ipcRenderer.on("project:animationProgress", handler);
    return () => electron.ipcRenderer.off("project:animationProgress", handler);
  },
  objectImage: (slug, id, direction) => electron.ipcRenderer.invoke("project:objectImage", slug, id, direction),
  createObject: (slug, input) => electron.ipcRenderer.invoke("project:createObject", slug, input),
  deleteObject: (slug, id) => electron.ipcRenderer.invoke("project:deleteObject", slug, id),
  onObjectProgress: (cb) => {
    const handler = (_e, progress) => cb(progress);
    electron.ipcRenderer.on("project:objectProgress", handler);
    return () => electron.ipcRenderer.off("project:objectProgress", handler);
  },
  objectReviewFrame: (slug, objectId, frameIndex) => electron.ipcRenderer.invoke("project:objectReviewFrame", slug, objectId, frameIndex),
  selectObjectFrames: (slug, objectId, indices) => electron.ipcRenderer.invoke("project:selectObjectFrames", slug, objectId, indices),
  discardObjectReview: (slug, objectId) => electron.ipcRenderer.invoke("project:discardObjectReview", slug, objectId),
  tileImage: (slug, tilesetId, tileId) => electron.ipcRenderer.invoke("project:tileImage", slug, tilesetId, tileId),
  createTileset: (slug, input) => electron.ipcRenderer.invoke("project:createTileset", slug, input),
  createIsometricTile: (slug, input) => electron.ipcRenderer.invoke("project:createIsometricTile", slug, input),
  deleteTileset: (slug, id) => electron.ipcRenderer.invoke("project:deleteTileset", slug, id),
  onTilesetProgress: (cb) => {
    const handler = (_e, progress) => cb(progress);
    electron.ipcRenderer.on("project:tilesetProgress", handler);
    return () => electron.ipcRenderer.off("project:tilesetProgress", handler);
  },
  authStatus: () => electron.ipcRenderer.invoke("auth:status"),
  connectClaude: () => electron.ipcRenderer.invoke("auth:connect"),
  setClaudeToken: (token) => electron.ipcRenderer.invoke("auth:setToken", token),
  disconnectClaude: () => electron.ipcRenderer.invoke("auth:disconnect"),
  agentAvailable: () => electron.ipcRenderer.invoke("agent:available"),
  agentSend: (slug, text) => electron.ipcRenderer.send("agent:send", slug, text),
  agentReset: (slug) => electron.ipcRenderer.invoke("agent:reset", slug),
  onAgentEvent: (cb) => {
    const handler = (_e, event) => cb(event);
    electron.ipcRenderer.on("agent:event", handler);
    return () => electron.ipcRenderer.off("agent:event", handler);
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
