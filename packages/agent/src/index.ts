export { PixelAgent, type AgentEvent, type AgentBackend } from "./agent";
export { ClaudeCodeBackend, type McpServerSpec } from "./claude-code";
export { createBackend, detectAuthMode, type AuthMode, type BackendDeps } from "./backend";
export { TOOLS, executeTool, type ToolContext, type ToolOutcome } from "./tools";
export { buildSystemPrompt } from "./prompt";
export {
  createAnthropic,
  resolveApiKey,
  DEFAULT_MODEL,
  DEFAULT_MAX_TOKENS,
  type AgentConfig,
} from "./config";
