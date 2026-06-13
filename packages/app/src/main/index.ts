import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, BrowserWindow } from "electron";
import { loadDotEnv } from "@pixellabrat/core";
import type { McpServerSpec } from "@pixellabrat/agent";
import { registerIpc } from "./ipc";

// Load the repo .env (dev) so the PixelLab token resolves.
loadDotEnv(__dirname);
loadDotEnv(process.cwd());

/** Walk up to the repo root (dir containing packages/mcp/src/server.ts). */
function findRepoRoot(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "packages", "mcp", "src", "server.ts"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const repoRoot = findRepoRoot();

// In dev, app + MCP server + Claude Code all share <repo>/projects.
const projectsRoot =
  process.env.PIXELLABRAT_PROJECTS_DIR ??
  (app.isPackaged || !repoRoot
    ? join(app.getPath("userData"), "projects")
    : join(repoRoot, "projects"));

// stdio MCP server the subscription backend (Claude Agent SDK) spawns. Dev path (needs bun).
const mcpServer: McpServerSpec = {
  command: "bun",
  args: repoRoot ? ["run", join(repoRoot, "packages", "mcp", "src", "server.ts")] : [],
  env: { ...process.env, PIXELLABRAT_PROJECTS_DIR: projectsRoot } as Record<string, string>,
};

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#0d0e12",
    title: "PixelLabRat",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpc(projectsRoot, mcpServer);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
