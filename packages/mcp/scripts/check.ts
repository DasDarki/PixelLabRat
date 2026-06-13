/**
 * MCP roundtrip check: spawn the server over stdio, list tools, and exercise the
 * FREE project tools (create/style/list) + balance. No generations are spent.
 * Uses an isolated temp projects dir so it leaves no clutter.
 *
 *   bun run packages/mcp/scripts/check.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = join(import.meta.dir, "..", "src", "server.ts");
const projectsDir = mkdtempSync(join(tmpdir(), "pixellabrat-mcp-"));

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", serverPath],
  env: { ...process.env, PIXELLABRAT_PROJECTS_DIR: projectsDir } as Record<string, string>,
});

const client = new Client({ name: "pixellabrat-check", version: "0.0.0" });
await client.connect(transport);

type TextContent = Array<{ type: string; text?: string }>;
const sayText = (content: unknown) =>
  (content as TextContent)
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join(" | ");

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  return sayText(res.content);
}

try {
  const { tools } = await client.listTools();
  console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);

  console.log("\nbalance        ->", (await call("pixellab_balance")).replace(/\n/g, " "));

  const created = await call("pixellab_project_create", { name: "MCP Test" });
  console.log("project_create ->", created);
  const slug = /\[slug: ([^\]]+)\]/.exec(created)?.[1] ?? "mcp-test";

  console.log(
    "project_style  ->",
    (await call("pixellab_project_style", { slug, style_description: "flat cute slimes", default_width: 64, default_height: 64 }))
      .replace(/\n/g, " "),
  );
  console.log("project_list   ->", await call("pixellab_project_list"));

  console.log("\nMCP project-tools roundtrip OK.");
} finally {
  await client.close();
  rmSync(projectsDir, { recursive: true, force: true });
}
