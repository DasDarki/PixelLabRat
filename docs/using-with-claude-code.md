# Generating pixel art from Claude Code

PixelLabRat ships an MCP server, so you can make game art entirely from a Claude
Code conversation — no desktop app required. You describe what you want, Claude
calls the PixelLab tools, and every asset stays on your project's style.

This is the fastest way to use it if you're already living in Claude Code.

## 1. One-time setup

Clone the repo, install, and add your PixelLab token:

```bash
git clone <your-fork-or-this-repo> pixellabrat
cd pixellabrat
bun install
cp .env.example .env        # set API_KEY to your PixelLab token
```

Your token is at https://pixellab.ai/account. The MCP server finds this `.env`
on its own (it looks next to its own source), so the token works no matter which
directory you start Claude Code from.

## 2. Register the MCP server

If you run Claude Code from inside the `pixellabrat` directory, it picks up the
bundled `.mcp.json` automatically — nothing to do.

To use it from anywhere else (e.g. your actual game repo), register it once with
an absolute path:

```bash
claude mcp add pixellabrat -- bun run /abs/path/to/pixellabrat/packages/mcp/src/server.ts
```

By default, projects are stored under `pixellabrat/projects/`. If you'd rather
keep the generated art inside your game repo, point the server at it:

```bash
PIXELLABRAT_PROJECTS_DIR=/abs/path/to/my-game/art claude
```

Confirm the tools are live by asking Claude: *"check my PixelLab balance"* — it
should call `pixellab_balance` and report your remaining generations.

## 3. The workflow

It's the same loop whether you use the app or Claude Code:

1. **Create a project** and give it a style. The style is a short description
   (plus optional perspective and reference images) that gets attached to every
   generation, which is what keeps things consistent.
2. **Generate** a character / object / tileset / UI element / image.
3. **Look at it, then iterate.** Cheap drafts first; lock in a look before
   spending on the expensive endpoints.
4. **Promote a good result to a reference** so everything after it matches even
   more closely.

A first conversation might go like this:

> **You:** Create a PixelLab project called "Mossgrove" for a cozy top-down
> farming game. Style: soft, warm 32×32 pixel art, limited pastel palette, gentle
> outlines, high top-down view. Then generate a draft of a wooden well so I can
> check the look.

Claude will call `pixellab_project_create`, set the style with
`pixellab_project_style`, and generate the well. From there:

> **You:** Good, but warmer and less saturated. Try again.
>
> **You:** That one's great — promote it to a style reference. Now make a
> character: a young farmer in dungarees, 8 directions.
>
> **You:** Add a "watering" animation for the south and east directions.
>
> **You:** Build a grass/water tileset for the pond area.

You stay in the loop the whole time — approving, rejecting, and steering.

## 4. What you can ask for

The server exposes the full toolset. In plain language, you can ask Claude to:

- **Generate images** in the project style, or from scratch (Pixflux).
- **Create characters** with up to 8 rotations, and **animate** them per
  direction ("walking", "attacking", …).
- **Create objects** — 8-direction props, or single-view items where you pick the
  best of several candidates.
- **Build tilesets** (top-down or sidescroller) and standalone **isometric tiles**.
- **Generate UI** — buttons, bars, panels, icons.
- **Edit existing assets** — remove background, convert to pixel art, rotate,
  resize, describe an edit, or inpaint a region.
- **Manage the library** — list, approve/reject, promote to reference, delete.

## 5. Things worth knowing

- **Generations cost money.** Characters and tilesets are the expensive ones
  (think tens of generations); a Pixflux draft is about one. Ask Claude to check
  the balance if you're unsure, and iterate on cheap drafts before committing.
- **Some jobs are slow.** Characters and animations run as background jobs and can
  take a minute or two; the tool waits for them.
- **Single-view objects come back as candidates.** When you ask for a 1-direction
  object at a small size, PixelLab returns several options. Claude will show them
  and you tell it which frame(s) to keep.
- **The desktop app and the MCP share projects.** Point both at the same
  `PIXELLABRAT_PROJECTS_DIR` and you can generate from Claude Code, then open the
  app to browse, review, and enlarge assets.

## A faster start

Want Claude to set up a whole project from a brief instead of step by step? Fill
in [art-brief-template.md](art-brief-template.md) and paste it into the
conversation — Claude will create the project, set the style, and start
generating the asset list.
