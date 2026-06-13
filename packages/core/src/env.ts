import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Walk up from `startDir` looking for a `.env` and load any keys not already
 * set in process.env. Makes token resolution work regardless of the process's
 * cwd (e.g. when an MCP client spawns the server from elsewhere). Existing env
 * vars always win, so this never overrides an explicitly-provided token.
 */
export function loadDotEnv(startDir: string = process.cwd(), maxDepth = 6): void {
  let dir = startDir;
  for (let i = 0; i < maxDepth; i++) {
    const file = join(dir, ".env");
    if (existsSync(file)) {
      for (const raw of readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
        if (!m) continue;
        const key = m[1]!;
        let val = m[2]!;
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
