import type { PixelLab } from "@pixellabrat/core";
import type { Project } from "@pixellabrat/store";
import { PixelAgent, type AgentBackend } from "./agent";
import { ClaudeCodeBackend, type McpServerSpec } from "./claude-code";
import { createAnthropic, resolveApiKey, type AgentConfig } from "./config";

export type AuthMode = "api-key" | "subscription" | "none";

/**
 * - api-key:      ANTHROPIC_API_KEY set  -> direct Anthropic SDK (pay per token)
 * - subscription: CLAUDE_CODE_OAUTH_TOKEN set -> Claude Agent SDK on your subscription
 * - none:         neither -> assistant unavailable
 */
export function detectAuthMode(): AuthMode {
  if (resolveApiKey()) return "api-key";
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return "subscription";
  return "none";
}

export interface BackendDeps {
  pixel: PixelLab;
  mcp: McpServerSpec;
}

/**
 * Pick the right backend. `mode` lets the host pass a richer resolution (e.g. an
 * existing Claude Code login that env-var detection alone can't see). Defaults to
 * env-var detection. Returns null for "none".
 */
export function createBackend(
  project: Project,
  deps: BackendDeps,
  opts: AgentConfig = {},
  mode: AuthMode = detectAuthMode(),
): AgentBackend | null {
  switch (mode) {
    case "api-key":
      return new PixelAgent(createAnthropic(opts), { project, pixel: deps.pixel }, opts);
    case "subscription":
      return new ClaudeCodeBackend(project, deps.mcp, opts);
    default:
      return null;
  }
}
