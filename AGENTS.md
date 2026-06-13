# Working on PixelLabRat

Guidance for AI agents (and humans) contributing to this repo. If you only want
to *use* PixelLabRat to generate art from Claude Code, read
[docs/using-with-claude-code.md](docs/using-with-claude-code.md) instead.

## Layout

A Bun workspace. TypeScript everywhere.

```
packages/
  core/    PixelLab API client + typed wrapper, auth, async job polling
  store/   project store (folders + JSON), the style contract, generation logic
  mcp/     the MCP server (Claude Code / any MCP client)
  agent/   the embedded Claude agent — tool defs + system prompt
  app/     Electron + Vue 3 desktop frontend
```

A project is a folder, not a database row: a manifest, a few JSON files
(`library.json`, `characters.json`, …), and the PNGs. The store reads and writes
those directly.

## Commands

```bash
bun run typecheck                    # core/store/mcp/agent
cd packages/app && bun run typecheck # the app (vue-tsc) — run separately
bun run store:check                  # store round-trip, offline
bun run mcp:check                    # MCP round-trip, offline
bun run agent:check                  # agent tools + prompt, offline
bun run app:dev / app:build          # the desktop app
```

The `*:check` scripts and the typechecks are offline and free — use them. Do
**not** call the real PixelLab API in tests; generations cost money. `bun run
smoke` (balance only) is the cheapest live sanity check.

## Adding a PixelLab capability

Generation features flow through the layers in this order, and the agent and MCP
surfaces are kept at parity:

1. **core** (`packages/core/src/pixellab.ts`) — add the method (submit + poll for
   async jobs, or a direct call for sync ones).
2. **store** (`packages/store/src/generate.ts`) — add the project-aware function
   that applies the style contract and persists results via `project.ts`.
3. **agent** (`packages/agent/src/tools.ts`) **and** **mcp**
   (`packages/mcp/src/server.ts`) — expose it as a tool in *both*. They should
   stay in sync; if you add a tool to one, add it to the other.
4. **app** — thread it through `shared/api.ts` → `main/ipc.ts` → `preload/index.ts`
   → `renderer/store.ts` → the relevant component.

## Conventions and gotchas

- PixelLab async jobs return a `background_job_id`; poll
  `GET /background-jobs/{id}` until the status leaves `processing`, then read the
  result. Real usage/cost only appears on the completed response — never trust the
  placeholder reported while processing.
- The style contract (description, perspective, transparency, references) is
  applied automatically in the store's `generate.ts`, not at the call site.
- 1-direction objects at small sizes finish in a `review` state with candidate
  frames; the caller picks which to keep (`select-frames`).
- The generated client (`packages/core/src/generated/`) is checked in. `API.json`
  is gitignored and only needed to regenerate it (`bun run gen:api`).
- The Claude Agent SDK is ESM-only and the Electron main process is CJS, so it's
  loaded with a lazy dynamic import in `packages/agent/src/claude-code.ts`. Don't
  convert that to a top-level `import`.
- If the app won't start with `…reading 'isPackaged'`, the shell has
  `ELECTRON_RUN_AS_NODE=1` set. Run with `env -u ELECTRON_RUN_AS_NODE`.

## Style

Match the surrounding code. Keep tool descriptions in `tools.ts` and `server.ts`
short and action-oriented — they're what the model reads to decide what to call.
