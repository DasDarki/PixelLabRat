import type { Project } from "@pixellabrat/store";
import { DEFAULT_MODEL, type AgentConfig } from "./config";
import { buildSystemPrompt } from "./prompt";
import type { AgentBackend, AgentEvent } from "./agent";

// @anthropic-ai/claude-agent-sdk is ESM-only; the Electron main bundle is CJS.
// Load it lazily via a native dynamic import the bundler can't rewrite to require(),
// so (a) it doesn't crash at module load and (b) it's only pulled in when actually used.
type QueryFn = (arg: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<unknown>;
let queryFnPromise: Promise<QueryFn> | null = null;
function loadQuery(): Promise<QueryFn> {
  if (!queryFnPromise) {
    const dynImport = new Function("s", "return import(s)") as (
      s: string,
    ) => Promise<{ query: QueryFn }>;
    queryFnPromise = dynImport("@anthropic-ai/claude-agent-sdk").then((m) => m.query);
  }
  return queryFnPromise;
}

/** stdio MCP server spec the Agent SDK will spawn. */
export interface McpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const MCP_SERVER_NAME = "pixellabrat";
const ALLOWED_TOOLS = [
  "pixellab_balance",
  "pixellab_project_list",
  "pixellab_project_create",
  "pixellab_project_style",
  "pixellab_project_add_ref",
  "pixellab_project_generate",
  "pixellab_project_library",
  "pixellab_project_review",
  "pixellab_project_create_character",
  "pixellab_project_characters",
  "pixellab_project_create_object",
  "pixellab_project_objects",
  "pixellab_project_animate_character",
  "pixellab_project_generate_ui",
  "pixellab_project_edit_asset",
  "pixellab_project_create_tileset",
  "pixellab_project_tilesets",
].map((t) => `mcp__${MCP_SERVER_NAME}__${t}`);

/** Tool name fragments that mutate the project -> trigger a UI refresh. */
const MUTATING = ["generate", "style", "add_ref", "review", "create"];

/** Loose view of the Agent SDK message union (the .d.ts isn't introspectable offline). */
interface SdkMsg {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: Array<Record<string, unknown>> };
}

function summarizeToolResult(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 80);
  if (Array.isArray(content)) {
    const parts = content.map((b) => {
      const block = b as Record<string, unknown>;
      if (block.type === "text") return String(block.text).slice(0, 80);
      if (block.type === "image") return "[image]";
      return "";
    });
    return parts.filter(Boolean).join(" ").slice(0, 80) || "ok";
  }
  return "ok";
}

/**
 * Subscription-auth backend: drives Claude via the Claude Agent SDK pointed at
 * our stdio MCP server. Uses CLAUDE_CODE_OAUTH_TOKEN / the logged-in Claude
 * subscription — no ANTHROPIC_API_KEY. Reuses the MCP tools as the tool layer.
 */
export class ClaudeCodeBackend implements AgentBackend {
  private sessionId?: string;
  private readonly toolNames = new Map<string, string>();

  constructor(
    private project: Project,
    private readonly mcp: McpServerSpec,
    private readonly opts: AgentConfig = {},
  ) {}

  setProject(project: Project): void {
    this.project = project;
  }

  reset(): void {
    this.sessionId = undefined;
    this.toolNames.clear();
  }

  async send(userText: string, onEvent: (e: AgentEvent) => void): Promise<void> {
    const slug = this.project.slug;
    const system =
      buildSystemPrompt(this.project) +
      `\n\n## Tooling\nYou act on this project through the "${MCP_SERVER_NAME}" MCP tools ` +
      `(named mcp__${MCP_SERVER_NAME}__pixellab_*). ALWAYS pass slug="${slug}" to the project tools. ` +
      `Use only these tools — no file, shell, or web tools.`;

    const options: Record<string, unknown> = {
      model: this.opts.model ?? DEFAULT_MODEL,
      systemPrompt: system,
      mcpServers: { [MCP_SERVER_NAME]: this.mcp },
      allowedTools: ALLOWED_TOOLS,
      permissionMode: "bypassPermissions",
    };
    if (this.sessionId) options.resume = this.sessionId;

    try {
      const query = await loadQuery();
      const q = query({ prompt: userText, options });
      for await (const raw of q) {
        const msg = raw as unknown as SdkMsg;
        if (msg.session_id) this.sessionId = msg.session_id;

        if (msg.type === "assistant") {
          for (const block of msg.message?.content ?? []) {
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string") {
              onEvent({ type: "text", text: b.text });
            } else if (b.type === "tool_use") {
              const id = String(b.id ?? "");
              const name = String(b.name ?? "tool");
              if (id) this.toolNames.set(id, name);
              onEvent({ type: "tool_use", id, name, input: b.input });
            }
          }
        } else if (msg.type === "user") {
          for (const block of msg.message?.content ?? []) {
            const b = block as Record<string, unknown>;
            if (b.type === "tool_result") {
              const name = this.toolNames.get(String(b.tool_use_id ?? "")) ?? "tool";
              onEvent({ type: "tool_result", name, summary: summarizeToolResult(b.content) });
              if (MUTATING.some((m) => name.includes(m))) onEvent({ type: "asset", assetId: "" });
            }
          }
        } else if (msg.type === "result") {
          if (msg.subtype && msg.subtype !== "success") {
            onEvent({ type: "error", message: `assistant ended: ${msg.subtype}` });
          }
          onEvent({ type: "done" });
          return;
        }
      }
      onEvent({ type: "done" });
    } catch (e) {
      onEvent({ type: "error", message: (e as Error).message ?? String(e) });
    }
  }
}
