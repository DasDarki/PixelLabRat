import { resolveConfig, type PixelLabConfig } from "./config";

export interface RequestOptions {
  signal?: AbortSignal;
}

export class PixelLabError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "PixelLabError";
  }
}

/** Thin authenticated transport over the PixelLab v2 REST API. */
export class PixelLabClient {
  readonly config: PixelLabConfig;

  constructor(config?: Partial<PixelLabConfig>) {
    this.config = resolveConfig(config);
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<{ data: T; status: number }> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts.signal,
    });

    const text = await res.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const p = parsed as Record<string, unknown> | undefined;
      const detail = p?.detail ?? p?.error ?? res.statusText;
      throw new PixelLabError(
        `PixelLab ${method} ${path} failed (${res.status}): ${
          typeof detail === "string" ? detail : JSON.stringify(detail)
        }`,
        res.status,
        parsed,
      );
    }
    return { data: parsed as T, status: res.status };
  }
}
