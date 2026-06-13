/**
 * Seed a demo project (no API cost) using the slime PNGs from earlier tests,
 * so the app shows a populated library for a screenshot / first look.
 *
 *   bun run packages/app/scripts/seed-demo.ts
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openStore } from "@pixellabrat/store";

// repo-root /projects — shared by the app (dev), MCP server, and Claude Code
const root = join(import.meta.dir, "..", "..", "..", "projects");
if (existsSync(root)) rmSync(root, { recursive: true, force: true });

const store = openStore(root);
const p = store.createProject("Slime World");
p.setStyle({
  styleDescription: "flache, niedliche Slimes · dicke Outline · weißer Hintergrund",
  defaultSize: { width: 64, height: 64 },
});

const green = new Uint8Array(readFileSync("/tmp/pixflux.png"));
const red = new Uint8Array(readFileSync("/tmp/style_out.png"));

const a1 = p.addAsset({
  bytes: green,
  prompt: "cute green slime monster, simple, white background",
  endpoint: "create-image-pixflux",
  params: {},
  size: { width: 64, height: 64 },
  usage: { type: "generations", generations: 1 },
});
p.promoteAssetToRef(a1.id);
p.rateAsset(a1.id, 5);

p.addAsset({
  bytes: red,
  prompt: "cute red slime monster, same style",
  endpoint: "generate-with-style-v2",
  params: {},
  size: { width: 64, height: 64 },
  usage: { type: "generations", generations: 20 },
  status: "approved",
});

// Demo character (rotations are just the slime PNGs — illustrative).
p.addCharacter({
  id: "demo-slime-knight",
  name: "Slime Knight",
  prompt: "a cute slime knight in the project style",
  size: { width: 64, height: 64 },
  directions: 4,
  rotations: { south: green, north: red, east: green, west: red },
  usage: { type: "generations", generations: 80 },
});

console.log(`seeded "${p.name}" [${p.slug}] — assets: ${p.listAssets().length}, refs: ${p.getStyle().refs.length}`);
