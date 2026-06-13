/**
 * Headless agent check.
 *   bun run packages/agent/scripts/check.ts          -> tools + system prompt (free, no network)
 *   bun run packages/agent/scripts/check.ts --live   -> one real Claude turn (needs ANTHROPIC_API_KEY;
 *                                                       prompt forbids tool calls, so ~no PixelLab cost)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PixelLab, loadDotEnv } from "@pixellabrat/core";
import { openStore } from "@pixellabrat/store";
import {
  PixelAgent,
  TOOLS,
  buildSystemPrompt,
  createAnthropic,
  resolveApiKey,
} from "../src/index";

loadDotEnv(import.meta.dir);

const root = mkdtempSync(join(tmpdir(), "pixellabrat-agent-"));
try {
  const store = openStore(root);
  const project = store.createProject("Agent Test");
  project.setStyle({
    styleDescription: "flat cute slimes, thick black outline, white background",
    defaultSize: { width: 64, height: 64 },
  });
  project.writeStyleGuide("# Style Guide — Agent Test\n\n- Thick outlines read best at 64px.\n");

  console.log("=== tools (" + TOOLS.length + ") ===");
  console.log(TOOLS.map((t) => t.name).join(", "));
  console.log("\n=== system prompt ===\n");
  console.log(buildSystemPrompt(project));

  const hasKey = !!resolveApiKey();
  console.log(`\nANTHROPIC_API_KEY present: ${hasKey}`);

  if (hasKey && process.argv.includes("--live")) {
    console.log("\n=== live turn (no tools requested) ===\n");
    const pixel = new PixelLab();
    const agent = new PixelAgent(createAnthropic(), { project, pixel });
    await agent.send(
      "In ONE sentence, what would you generate first for this project? Do not call any tools.",
      (e) => {
        if (e.type === "text") process.stdout.write(e.text);
        else if (e.type === "error") console.error(`\n[error] ${e.message}`);
        else if (e.type !== "done") console.log(`\n[${e.type}] ${JSON.stringify(e)}`);
      },
    );
    console.log();
  }

  console.log("\nAgent check OK.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
