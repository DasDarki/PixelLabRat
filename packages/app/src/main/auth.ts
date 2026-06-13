import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import type { AuthMode } from "@pixellabrat/agent";
import type { AuthStatus } from "../shared/api";

function tokenFile(): string {
  return join(app.getPath("userData"), "claude-oauth.bin");
}

function loadStoredToken(): string | null {
  const f = tokenFile();
  if (!existsSync(f)) return null;
  try {
    const buf = readFileSync(f);
    const kind = buf[0];
    const body = buf.subarray(1);
    if (kind === 1 && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(body);
    if (kind === 0) return body.toString("utf8");
    return null;
  } catch {
    return null;
  }
}

function saveToken(token: string): void {
  mkdirSync(app.getPath("userData"), { recursive: true });
  const f = tokenFile();
  let out: Buffer;
  if (safeStorage.isEncryptionAvailable()) {
    out = Buffer.concat([Buffer.from([1]), safeStorage.encryptString(token)]);
  } else {
    out = Buffer.concat([Buffer.from([0]), Buffer.from(token, "utf8")]);
  }
  writeFileSync(f, out);
  try {
    chmodSync(f, 0o600);
  } catch {
    // best effort (Windows)
  }
}

export function clearStoredToken(): void {
  const f = tokenFile();
  if (existsSync(f)) rmSync(f);
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number | null) => {
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr });
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { env: process.env });
    } catch {
      return finish(null);
    }
    child.stdout?.on("data", (d) => (stdout += String(d)));
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
    const t = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(null);
    }, timeoutMs);
    child.on("close", () => clearTimeout(t));
  });
}

async function claudeLoggedIn(): Promise<boolean> {
  const r = await run("claude", ["auth", "status"], 8000);
  return r.code === 0;
}

let cached: AuthStatus | null = null;

/** Resolve auth. Side effect: injects a stored OAuth token into process.env. */
export async function computeAuthStatus(): Promise<AuthStatus> {
  let status: AuthStatus;
  if (process.env.ANTHROPIC_API_KEY) {
    status = { mode: "api-key", via: "api-key", stored: false };
  } else {
    const stored = loadStoredToken();
    if (stored) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = stored;
      status = { mode: "subscription", via: "stored-token", stored: true };
    } else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      status = { mode: "subscription", via: "env-token", stored: false };
    } else if (await claudeLoggedIn()) {
      status = { mode: "subscription", via: "cli-login", stored: false };
    } else {
      status = { mode: "none", via: "none", stored: false };
    }
  }
  cached = status;
  return status;
}

export function currentMode(): AuthMode {
  return cached?.mode ?? "none";
}

function extractToken(text: string): string | null {
  const matches = text.match(/sk-ant-[A-Za-z0-9_\-]{20,}/g);
  if (matches?.length) return matches.sort((a, b) => b.length - a.length)[0]!;
  // Fallback: a long opaque token-looking line.
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_\-.]{40,}$/.test(s));
  return lines.length ? lines[lines.length - 1]! : null;
}

/** Run `claude setup-token` (opens a browser), capture + store the token. */
export async function connectClaude(): Promise<{ ok: boolean; error?: string }> {
  const r = await run("claude", ["setup-token"], 5 * 60_000);
  if (r.code === null && !r.stdout) {
    return {
      ok: false,
      error: "Konnte `claude setup-token` nicht ausführen (ist Claude Code installiert & auf dem PATH?).",
    };
  }
  const token = extractToken(`${r.stdout}\n${r.stderr}`);
  if (!token) {
    return { ok: false, error: "Kein Token im Output gefunden. Tipp: Token manuell einfügen." };
  }
  saveToken(token);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  await computeAuthStatus();
  return { ok: true };
}

/** Store a token the user pasted (from `claude setup-token`). */
export async function setClaudeToken(token: string): Promise<{ ok: boolean; error?: string }> {
  const t = token.trim();
  if (t.length < 20) return { ok: false, error: "Token sieht ungültig aus." };
  saveToken(t);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = t;
  await computeAuthStatus();
  return { ok: true };
}

export async function disconnectClaude(): Promise<AuthStatus> {
  clearStoredToken();
  return computeAuthStatus();
}
