export interface PixelLabConfig {
  /** Bearer token from https://pixellab.ai/account */
  token: string;
  /** API base URL, no trailing slash. Defaults to https://api.pixellab.ai/v2 */
  baseUrl: string;
}

/**
 * Resolve config from explicit overrides, then environment.
 * Token: PIXELLAB_API_KEY > API_KEY. Bun auto-loads .env, so a dev token in
 * the repo .env is picked up automatically.
 */
export function resolveConfig(overrides: Partial<PixelLabConfig> = {}): PixelLabConfig {
  const token = overrides.token ?? process.env.PIXELLAB_API_KEY ?? process.env.API_KEY;
  if (!token) {
    throw new Error(
      "PixelLab API token missing. Set PIXELLAB_API_KEY (or API_KEY) in your environment or .env file.",
    );
  }
  const baseUrl = (
    overrides.baseUrl ??
    process.env.PIXELLAB_BASE_URL ??
    "https://api.pixellab.ai/v2"
  ).replace(/\/+$/, "");
  return { token, baseUrl };
}
