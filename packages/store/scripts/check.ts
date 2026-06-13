/**
 * Headless store check — exercises project/style/asset CRUD with NO API spend.
 *
 *   bun run packages/store/scripts/check.ts
 *   bun run packages/store/scripts/check.ts --generate   # also does a real
 *       project-aware generation (pixflux draft -> promote to ref -> styled). ~21 gens.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { PixelLab, loadDotEnv } from "@pixellabrat/core";
import { generateForProject, openStore } from "../src/index";

// 1x1 transparent PNG
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function tree(dir: string, prefix = ""): void {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const isDir = statSync(abs).isDirectory();
    console.log(`${prefix}${name}${isDir ? "/" : ""}`);
    if (isDir) tree(abs, prefix + "  ");
  }
}

const root = join(import.meta.dir, "..", "..", "..", "tmp", "test-projects");
if (existsSync(root)) rmSync(root, { recursive: true, force: true });

const store = openStore(root);

console.log("create project...");
const project = store.createProject("Slime World");
project.setStyle({
  styleDescription: "flat cute slimes, thick outline, white background",
  defaultSize: { width: 64, height: 64 },
  noBackground: false,
});

console.log("add a style reference (from PNG bytes)...");
const ref = project.addRefFromBytes(new Uint8Array(TINY_PNG));
console.log(`  ref: ${ref.file} (${ref.width}x${ref.height})`);

console.log("add 2 draft assets...");
const a1 = project.addAsset({
  bytes: new Uint8Array(TINY_PNG),
  prompt: "green slime",
  endpoint: "create-image-pixflux",
  params: {},
  size: { width: 64, height: 64 },
  usage: { type: "generations", generations: 1 },
});
const a2 = project.addAsset({
  bytes: new Uint8Array(TINY_PNG),
  prompt: "red slime",
  endpoint: "generate-with-style-v2",
  params: {},
  size: { width: 64, height: 64 },
  usage: { type: "generations", generations: 20 },
});

console.log("review: approve a1 (+promote to ref), reject a2, rate a1...");
project.promoteAssetToRef(a1.id);
project.setAssetStatus(a2.id, "rejected");
project.rateAsset(a1.id, 5);

console.log("add a character (fake 4-dir rotations)...");
const char = project.addCharacter({
  id: "char-test-1",
  name: "Test Knight",
  prompt: "a small knight",
  size: { width: 64, height: 64 },
  directions: 4,
  rotations: {
    south: new Uint8Array(TINY_PNG),
    north: new Uint8Array(TINY_PNG),
    east: new Uint8Array(TINY_PNG),
    west: new Uint8Array(TINY_PNG),
  },
  usage: { type: "generations", generations: 80 },
});
console.log(`  character: ${char.id} "${char.name}" dirs=${Object.keys(char.rotations).join("/")}`);
console.log(`  read south rotation: ${project.readCharacterImage(char.id, "south").length} bytes`);

console.log("\nproject summaries:");
for (const s of store.list()) {
  console.log(
    `  ${s.name} [${s.slug}]  assets=${s.assetCount} refs=${s.refCount} characters=${s.characterCount}`,
  );
}

console.log("\nassets:");
for (const a of project.listAssets()) {
  console.log(`  ${a.status.padEnd(8)} ${a.endpoint.padEnd(24)} "${a.prompt}" rating=${a.rating ?? "-"}`);
}

console.log("\non-disk layout:");
tree(project.dir, "  ");

const doGenerate = process.argv.includes("--generate");
if (doGenerate) {
  console.log("\n--generate: real project-aware generation");
  loadDotEnv(import.meta.dir);
  const client = new PixelLab();

  const fresh = store.createProject("Gen Test");
  console.log("  1) no refs -> pixflux draft...");
  const draft = await generateForProject(client, fresh, {
    description: "cute green slime monster, simple, white background",
  });
  console.log(`     mode=${draft.mode} asset=${draft.asset.id} usage=${JSON.stringify(draft.asset.usage)}`);

  console.log("  2) promote draft to style ref...");
  fresh.promoteAssetToRef(draft.asset.id);

  console.log("  3) now WITH ref -> generate-with-style-v2...");
  const styled = await generateForProject(
    client,
    fresh,
    { description: "cute red slime monster, simple, white background" },
    { onProgress: (p) => process.stdout.write(`\r     progress ${Math.round(p * 100)}%   `) },
  );
  process.stdout.write("\n");
  console.log(
    `     mode=${styled.mode} candidates=${styled.candidates} usage=${JSON.stringify(styled.asset.usage)}`,
  );
  console.log(`     project dir: ${fresh.dir}`);
}

console.log("\nStore check OK.");
