/**
 * P0 smoke test for @pixellabrat/core.
 *
 *   bun run smoke              -> balance only (FREE)
 *   bun run smoke --generate   -> reproduces the green->red slime style-transfer
 *                                 flow end-to-end. Costs ~21 generations.
 *
 * Token is read from .env (API_KEY) automatically by Bun.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PixelLab, base64ToBytes, formatUsage } from "../src/index";

const client = new PixelLab();

const balance = await client.getBalance();
console.log("PixelLab balance");
console.log(`  plan:        ${balance.subscription.plan} (${balance.subscription.status})`);
console.log(`  generations: ${balance.subscription.generations} / ${balance.subscription.total}`);
console.log(`  usd credits: $${balance.credits.usd.toFixed(2)}`);

const doGenerate = process.argv.includes("--generate") || process.env.SMOKE_GENERATE === "1";
if (!doGenerate) {
  console.log("\n(balance only — free. Run with `--generate` for the real slime test, ~21 generations.)");
  process.exit(0);
}

const outDir = join(import.meta.dir, "..", "..", "..", "tmp");
mkdirSync(outDir, { recursive: true });

console.log("\n1) pixflux: green slime (sync, ~1 generation)...");
const { image, usage: u1 } = await client.generatePixflux({
  description: "cute green slime monster, simple, white background",
  width: 64,
  height: 64,
});
writeFileSync(join(outDir, "smoke-pixflux.png"), base64ToBytes(image.base64));
console.log(`   -> tmp/smoke-pixflux.png   usage: ${formatUsage(u1)}`);

console.log("2) generate-with-style-v2: red slime in the same style (async, ~20 generations)...");
const styled = await client.generateWithStyle(
  {
    description: "cute red slime monster, simple, white background",
    styleImages: [{ base64: image.base64, width: 64, height: 64 }],
    width: 64,
    height: 64,
  },
  {
    onProgress: (p) => process.stdout.write(`\r   progress ${Math.round(p * 100)}%   `),
  },
);
process.stdout.write("\n");
writeFileSync(join(outDir, "smoke-styled.png"), base64ToBytes(styled.images[0]!.base64));
console.log(
  `   -> tmp/smoke-styled.png    images: ${styled.images.length}   usage: ${formatUsage(styled.usage)}   seed: ${styled.seed}`,
);

console.log("\nDone — reproduced the validated style-transfer pipeline through @pixellabrat/core.");
