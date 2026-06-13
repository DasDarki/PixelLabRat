import type Anthropic from "@anthropic-ai/sdk";
import type { Project } from "@pixellabrat/store";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL, type AgentConfig } from "./config";
import { buildSystemPrompt } from "./prompt";
import { TOOLS, executeTool, type ToolContext } from "./tools";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; name: string; summary: string }
  | { type: "asset"; assetId: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** Common surface for both backends (direct Anthropic SDK and Claude Agent SDK). */
export interface AgentBackend {
  send(userText: string, onEvent: (e: AgentEvent) => void): Promise<void>;
  setProject(project: Project): void;
  reset(): void;
}

/** Safety bound on the tool-use loop within a single user turn. */
const MAX_STEPS = 12;

/**
 * Embedded Claude agent that drives the project via the PixelLab tools.
 * Manual streaming agentic loop (per the claude-api reference): stream text to
 * the UI, execute tool_use blocks, feed tool_result back, loop until end_turn.
 */
export class PixelAgent implements AgentBackend {
  private history: Anthropic.MessageParam[] = [];

  constructor(
    private readonly client: Anthropic,
    private ctx: ToolContext,
    private readonly opts: AgentConfig = {},
  ) {}

  reset(): void {
    this.history = [];
  }

  /** Point the agent at a freshly-loaded Project (state changes from the UI). */
  setProject(project: Project): void {
    this.ctx = { ...this.ctx, project };
  }

  async send(userText: string, onEvent: (e: AgentEvent) => void): Promise<void> {
    this.history.push({ role: "user", content: userText });
    const model = this.opts.model ?? DEFAULT_MODEL;
    const maxTokens = this.opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    // Rebuilt each turn so it reflects the latest style contract + learnings.
    const system = buildSystemPrompt(this.ctx.project);

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const stream = this.client.messages.stream({
          model,
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          system,
          tools: TOOLS,
          messages: this.history,
        });
        stream.on("text", (delta) => onEvent({ type: "text", text: delta }));
        const message = await stream.finalMessage();
        // Push the full content verbatim (incl. thinking blocks) so same-model replay is valid.
        this.history.push({ role: "assistant", content: message.content });

        const toolUses = message.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );
        if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
          onEvent({ type: "done" });
          return;
        }

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          onEvent({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
          try {
            const outcome = await executeTool(
              tu.name,
              tu.input as Record<string, unknown>,
              this.ctx,
            );
            if (outcome.assetId) onEvent({ type: "asset", assetId: outcome.assetId });
            onEvent({ type: "tool_result", name: tu.name, summary: outcome.summary });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: outcome.content });
          } catch (e) {
            const msg = (e as Error).message ?? String(e);
            onEvent({ type: "tool_result", name: tu.name, summary: `error: ${msg}` });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: msg, is_error: true });
          }
        }
        this.history.push({ role: "user", content: results });
      }
      onEvent({ type: "done" });
    } catch (e) {
      onEvent({ type: "error", message: (e as Error).message ?? String(e) });
    }
  }
}
