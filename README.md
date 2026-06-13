# PixelLabRat

A local, project-based desktop app and MCP server for generating style-consistent
pixel art with the [PixelLab](https://pixellab.ai) API.

Point it at a project, describe what you want, and it keeps every asset —
characters, objects, tilesets, UI, animations — on the same visual style. There's
an embedded Claude assistant for hands-off art direction, and the whole thing
doubles as an MCP server so you can drive it from Claude Code.

It's built for game dev, where you end up needing dozens of matching sprites and
don't want each one to look like it came from a different game.

## What it does

- **Per-project style contract.** A style description, perspective and
  transparency settings, and up to four reference images that get applied to every
  generation automatically. Generate until you like a look, promote it to a
  reference, and everything after that matches it.
- **The full PixelLab toolset**, wrapped so it's actually usable from one prompt:
  - Text-to-pixel-art (Pixflux) and style-matched generation
  - Characters with up to 8 directional rotations, and animations per direction
  - Objects (8-direction, or single-view with a candidate picker)
  - Tilesets — top-down and sidescroller — plus standalone isometric tiles
  - UI elements (buttons, bars, panels, icons)
  - Image ops: background removal, upscale-to-pixel-art, rotate, resize,
    text-described edits, and inpainting with a mask you paint by hand
- **Asset library with review.** Everything lands as a draft you can approve,
  reject, rate, or promote to a style reference. Click any thumbnail to see it
  big; animations play back full size.
- **An embedded assistant ("Art-Director").** A Claude agent that drives the same
  actions you do and keeps a per-project `STYLE_GUIDE.md` as memory. It uses your
  Claude Code login or subscription if you have one, so no separate API key is
  required.
- **MCP server.** The same project-aware actions exposed as MCP tools, so Claude
  Code or any MCP client can generate art directly.

A project is just a folder — a small manifest, a few JSON files, and the PNGs —
so there's no database to manage and you can check assets into git alongside your
game.

## Requirements

- [Bun](https://bun.sh) — the repo is a Bun workspace
- A PixelLab account and API token (https://pixellab.ai/account)
- Optional: Claude Code or a Claude API key, if you want the in-app assistant

## Getting started

```bash
bun install
cp .env.example .env     # put your PixelLab token in API_KEY
bun run gen:api          # generate the typed v2 client from API.json
```

Then run the desktop app:

```bash
bun run app:seed         # optional: creates a "Slime World" demo project
bun run app:dev
```

Projects live under `projects/` in dev, or the app's user-data directory when
packaged. Set `PIXELLABRAT_PROJECTS_DIR` to point the app and the MCP server at
the same folder.

> If the app fails to start with `Cannot read properties of undefined (reading
> 'isPackaged')`, your shell has `ELECTRON_RUN_AS_NODE=1` set (some IDE terminals
> do this). Start it with `env -u ELECTRON_RUN_AS_NODE bun run app:dev`.

## The embedded assistant

The chat panel (the ✨ Art-Director button) runs a Claude agent with tool access.
It can generate, review, manage the style contract, and check your balance — the
same things you'd do by hand — and it writes notes to the project's
`STYLE_GUIDE.md` so it stays more consistent over time.

Auth is picked automatically:

1. **Logged into Claude Code?** Nothing to do. The app detects it and uses your
   Claude subscription.
2. **Otherwise**, the "Connect Claude" button runs `claude setup-token` and stores
   the token encrypted in your OS keychain (Electron `safeStorage`), so there's no
   `.env` editing.
3. **API key:** set `ANTHROPIC_API_KEY` in `.env` for pay-per-token use. It takes
   precedence if both are present.

The subscription path goes through the Claude Agent SDK and is meant for personal
use — don't ship a multi-user app on a single subscription token.

## Using it from Claude Code (MCP)

The repo ships a `.mcp.json`, so Claude Code picks up the `pixellabrat` server
automatically when started from the project directory. To register it manually:

```bash
claude mcp add pixellabrat -- bun run /abs/path/to/PixelLabRat/packages/mcp/src/server.ts
```

The server exposes the full project-aware toolset (28 tools) — anything the app or
the in-app assistant can do, Claude Code can do too. A selection:

| Tool | What it does |
|---|---|
| `pixellab_balance` | subscription generations + USD credits |
| `pixellab_project_create` / `_list` / `_style` | manage projects and the style contract |
| `pixellab_project_generate` / `_generate_ui` | generate an image / UI element in the project style |
| `pixellab_project_create_character` / `_animate_character` | characters and per-direction animations |
| `pixellab_project_create_object` / `_select_object_frames` | objects, including the single-view candidate picker |
| `pixellab_project_create_tileset` / `_create_isometric_tile` | tilesets (top-down/sidescroller) and isometric tiles |
| `pixellab_project_edit_asset` / `_inpaint` | image edits and masked inpainting |
| `pixellab_project_review` | approve / reject / promote an asset |

## Project layout

A Bun monorepo, TypeScript throughout. The PixelLab v2 client is generated from
`API.json`.

```
packages/
  core/    HTTP client, auth, the typed PixelLab wrapper, async job polling
  store/   the project store (folders + JSON), style contract, generation logic
  mcp/     the MCP server
  agent/   the embedded Claude agent (tools + system prompt)
  app/     the Electron + Vue 3 desktop frontend
```

## A note on credits

Everything bills against PixelLab subscription generations, Pro endpoints
included, so you don't have to top up USD credits. As a rough guide, Pixflux is
about one generation and style-matched generation about twenty; characters and
tilesets are the expensive ones. While an async job is still processing the API
returns a placeholder usage value, so the app reads the real cost from the
completed response.

## Development

```bash
bun run typecheck      # core/store/mcp/agent
bun run store:check    # headless store test, no API calls
bun run mcp:check      # MCP round-trip, no API calls
bun run agent:check    # agent tools + prompt (add --live for one real turn)
bun run smoke          # show your balance (free); --generate runs a full transfer
bun run app:build      # production build
```

The `*:check` scripts run offline so you can iterate without spending generations.

## Contributing

Issues and pull requests are welcome. Please keep things typechecking
(`bun run typecheck`) and avoid spending real generations in tests.

## License

MIT — see [LICENSE](LICENSE).
