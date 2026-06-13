import Anthropic from "@anthropic-ai/sdk";

/** Default to the most capable Opus-tier model (per the claude-api reference). */
export const DEFAULT_MODEL = "claude-opus-4-8";
/** Interactive chat: short outputs, but stream anyway. */
export const DEFAULT_MAX_TOKENS = 16000;

export interface AgentConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export function resolveApiKey(cfg: AgentConfig = {}): string | undefined {
  return cfg.apiKey ?? process.env.ANTHROPIC_API_KEY;
}

export function createAnthropic(cfg: AgentConfig = {}): Anthropic {
  const apiKey = resolveApiKey(cfg);
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY missing — add it to .env to use the embedded Claude agent. " +
        "(This is separate from your PixelLab token and bills to your Anthropic account.)",
    );
  }
  return new Anthropic({ apiKey });
}
