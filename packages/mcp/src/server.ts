#!/usr/bin/env bun
/**
 * PixelLabRat MCP server — exposes the project-aware PixelLab core as MCP tools
 * so Claude Code (or any MCP client) can drive PixelLab directly.
 *
 * Run:  bun run packages/mcp/src/server.ts   (token from .env: API_KEY)
 *
 * Protocol uses stdout — all logging MUST go to stderr (console.error).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  PixelLab,
  base64ToBytes,
  formatUsage,
  loadDotEnv,
  pngSize,
  stripDataUrl,
  type StyleRef,
} from "@pixellabrat/core";
import {
  animateCharacterForProject,
  createCharacterForProject,
  createIsometricTileForProject,
  createObjectForProject,
  createTilesetForProject,
  editAssetForProject,
  generateForProject,
  generateUIForProject,
  inpaintAssetForProject,
  openStore,
  selectObjectFramesForProject,
  type EditOp,
} from "@pixellabrat/store";

// Find the repo .env relative to this file so the token resolves no matter
// what cwd the MCP client spawns us from.
loadDotEnv(import.meta.dir);

const repoRoot = join(import.meta.dir, "..", "..", "..");
const client = new PixelLab();
const store = openStore(process.env.PIXELLABRAT_PROJECTS_DIR ?? join(repoRoot, "projects"));

const server = new McpServer({ name: "pixellabrat", version: "0.0.0" });

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

const text = (t: string): Content => ({ type: "text", text: t });
const img = (base64: string): Content => ({
  type: "image",
  data: stripDataUrl(base64),
  mimeType: "image/png",
});

/** Load a local PNG file into a StyleRef (base64 + dimensions). */
function styleRefFromPath(path: string): StyleRef {
  const bytes = new Uint8Array(readFileSync(path));
  const dims = pngSize(bytes);
  if (!dims) throw new Error(`Not a readable PNG: ${path}`);
  return {
    base64: Buffer.from(bytes).toString("base64"),
    width: dims.width,
    height: dims.height,
  };
}

server.registerTool(
  "pixellab_balance",
  {
    title: "PixelLab balance",
    description:
      "Get the PixelLab account balance: subscription plan, generations remaining this period, and USD credits. Free — does not spend anything.",
    inputSchema: {},
  },
  async () => {
    const b = await client.getBalance();
    return {
      content: [
        text(
          `Plan: ${b.subscription.plan} (${b.subscription.status})\n` +
            `Generations: ${b.subscription.generations} / ${b.subscription.total}\n` +
            `USD credits: $${b.credits.usd.toFixed(2)}`,
        ),
      ],
    };
  },
);

server.registerTool(
  "pixellab_generate_pixflux",
  {
    title: "Generate pixel art (pixflux)",
    description:
      "Generate a pixel-art image from a text description (pixflux, synchronous). " +
      "Costs ~1 generation. Optionally saves the PNG to save_path so it can be reused " +
      "as a style reference for pixellab_generate_styled.",
    inputSchema: {
      description: z.string().describe("What to generate, e.g. 'cute green slime monster'"),
      width: z.number().int().min(16).max(400).default(64),
      height: z.number().int().min(16).max(400).default(64),
      no_background: z.boolean().optional().describe("Transparent background"),
      seed: z.number().int().min(0).optional(),
      save_path: z.string().optional().describe("Absolute path to write the resulting PNG"),
    },
  },
  async (a) => {
    const { image, usage } = await client.generatePixflux({
      description: a.description,
      width: a.width,
      height: a.height,
      noBackground: a.no_background,
      seed: a.seed,
    });
    const content: Content[] = [img(image.base64)];
    if (a.save_path) {
      writeFileSync(a.save_path, base64ToBytes(image.base64));
      content.push(text(`Saved to ${a.save_path}`));
    }
    content.push(text(`usage: ${formatUsage(usage)}`));
    return { content };
  },
);

server.registerTool(
  "pixellab_generate_styled",
  {
    title: "Generate in a reference style (Pro)",
    description:
      "Generate a new pixel-art image that matches the style of 1-4 reference PNGs " +
      "(generate-with-style-v2, async, polled to completion). This is the core " +
      "style-consistency tool. Costs ~20 generations. Provide style references as " +
      "local PNG file paths.",
    inputSchema: {
      description: z.string().describe("What to generate in the reference style"),
      style_image_paths: z
        .array(z.string())
        .min(1)
        .max(4)
        .describe("1-4 local PNG paths used as style references"),
      width: z.number().int().min(16).max(512).default(64),
      height: z.number().int().min(16).max(512).default(64),
      style_description: z.string().max(500).optional(),
      no_background: z.boolean().optional(),
      seed: z.number().int().min(0).optional(),
      save_path: z.string().optional().describe("Absolute path to write the resulting PNG"),
    },
  },
  async (a) => {
    const styleImages = a.style_image_paths.map(styleRefFromPath);
    const styled = await client.generateWithStyle({
      description: a.description,
      styleImages,
      width: a.width,
      height: a.height,
      styleDescription: a.style_description,
      noBackground: a.no_background,
      seed: a.seed,
    });
    const first = styled.images[0];
    if (!first) throw new Error("Style job completed but returned no images");
    const content: Content[] = [img(first.base64)];
    if (a.save_path) {
      writeFileSync(a.save_path, base64ToBytes(first.base64));
      content.push(text(`Saved to ${a.save_path}`));
    }
    content.push(
      text(
        `usage: ${formatUsage(styled.usage)}  |  candidates: ${styled.images.length}  |  seed: ${styled.seed}`,
      ),
    );
    return { content };
  },
);

// ---------------------------------------------------------------------------
// Project-aware tools — the P1 workflow: projects keep a style contract that is
// applied automatically to every generation.
// ---------------------------------------------------------------------------

server.registerTool(
  "pixellab_project_list",
  {
    title: "List projects",
    description: "List all PixelLabRat projects with their asset and style-reference counts.",
    inputSchema: {},
  },
  async () => {
    const projects = store.list();
    if (projects.length === 0) return { content: [text("No projects yet. Create one with pixellab_project_create.")] };
    return {
      content: [
        text(
          projects
            .map((p) => `${p.name} [${p.slug}]  assets=${p.assetCount}  refs=${p.refCount}`)
            .join("\n"),
        ),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_create",
  {
    title: "Create project",
    description: "Create a new project (a folder with its own style contract and asset library).",
    inputSchema: { name: z.string().describe("Display name, e.g. 'Slime World'") },
  },
  async (a) => {
    const p = store.createProject(a.name);
    return { content: [text(`Created project "${p.name}" [slug: ${p.slug}]`)] };
  },
);

server.registerTool(
  "pixellab_project_style",
  {
    title: "Get / set project style",
    description:
      "View the project's style contract, or update fields by passing them. The style is " +
      "applied automatically to every generation in this project.",
    inputSchema: {
      slug: z.string(),
      style_description: z.string().max(500).optional(),
      default_width: z.number().int().min(16).max(512).optional(),
      default_height: z.number().int().min(16).max(512).optional(),
      no_background: z.boolean().optional(),
      negative: z.string().optional(),
      view: z.enum(["side", "low top-down", "high top-down"]).optional(),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    const patch: Record<string, unknown> = {};
    if (a.style_description !== undefined) patch.styleDescription = a.style_description;
    if (a.no_background !== undefined) patch.noBackground = a.no_background;
    if (a.negative !== undefined) patch.negative = a.negative;
    if (a.view !== undefined) patch.view = a.view;
    if (a.default_width !== undefined || a.default_height !== undefined) {
      const cur = project.getStyle().defaultSize;
      patch.defaultSize = {
        width: a.default_width ?? cur.width,
        height: a.default_height ?? cur.height,
      };
    }
    const style = Object.keys(patch).length ? project.setStyle(patch) : project.getStyle();
    return {
      content: [
        text(
          `Style for ${project.name}:\n` +
            `  description: ${style.styleDescription ?? "(none)"}\n` +
            `  default size: ${style.defaultSize.width}x${style.defaultSize.height}\n` +
            `  no_background: ${style.noBackground ?? false}\n` +
            `  view: ${style.view ?? "(none)"}\n` +
            `  references: ${style.refs.length}/4` +
            (style.refs.length ? `\n${style.refs.map((r) => `    - ${r.file}`).join("\n")}` : ""),
        ),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_add_ref",
  {
    title: "Add style reference",
    description:
      "Add a local PNG as a style reference (max 4). References drive style-consistent generation.",
    inputSchema: { slug: z.string(), png_path: z.string() },
  },
  async (a) => {
    const project = store.open(a.slug);
    const bytes = new Uint8Array(readFileSync(a.png_path));
    const ref = project.addRefFromBytes(bytes);
    return { content: [text(`Added reference ${ref.file} (${ref.width}x${ref.height}). Now ${project.getStyle().refs.length}/4.`)] };
  },
);

server.registerTool(
  "pixellab_project_remove_ref",
  {
    title: "Remove style reference",
    description:
      "Remove a style reference from the project's style contract by its file path (see " +
      "pixellab_project_style for the list). Future generations no longer match it.",
    inputSchema: { slug: z.string(), file: z.string().describe("Ref file path, e.g. 'refs/<id>.png'") },
  },
  async (a) => {
    const project = store.open(a.slug);
    project.removeRef(a.file);
    return { content: [text(`Removed reference ${a.file}. Now ${project.getStyle().refs.length}/4.`)] };
  },
);

server.registerTool(
  "pixellab_project_generate",
  {
    title: "Generate in project style",
    description:
      "Generate an image for a project, applying its style contract automatically. With style " +
      "references this uses generate-with-style-v2 (~20 generations); without, pixflux (~1). " +
      "Saves the result as a draft asset and returns the image + asset id.",
    inputSchema: {
      slug: z.string(),
      description: z.string(),
      width: z.number().int().min(16).max(512).optional(),
      height: z.number().int().min(16).max(512).optional(),
      seed: z.number().int().min(0).optional(),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    const size = a.width || a.height ? { width: a.width ?? 64, height: a.height ?? 64 } : undefined;
    const out = await generateForProject(client, project, {
      description: a.description,
      size,
      seed: a.seed,
    });
    return {
      content: [
        img(Buffer.from(project.readAssetBytes(out.asset.id)).toString("base64")),
        text(
          `mode: ${out.mode}  |  asset: ${out.asset.id}  |  status: draft  |  usage: ${formatUsage(out.asset.usage)}`,
        ),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_library",
  {
    title: "List project assets",
    description: "List the assets in a project's library with status, endpoint and rating.",
    inputSchema: { slug: z.string() },
  },
  async (a) => {
    const project = store.open(a.slug);
    const assets = project.listAssets();
    if (assets.length === 0) return { content: [text("Library is empty.")] };
    return {
      content: [
        text(
          assets
            .map(
              (x) =>
                `${x.id}  ${x.status.padEnd(8)} ${x.endpoint.padEnd(24)} rating=${x.rating ?? "-"}  "${x.prompt}"`,
            )
            .join("\n"),
        ),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_review",
  {
    title: "Review an asset",
    description:
      "Approve, reject, or promote a draft asset. 'promote' approves it AND adds it to the " +
      "project's style references so future generations match it. Optionally set a rating.",
    inputSchema: {
      slug: z.string(),
      asset_id: z.string(),
      action: z.enum(["approve", "reject", "promote"]),
      rating: z.number().int().min(1).max(5).optional(),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    let msg: string;
    if (a.action === "promote") {
      const ref = project.promoteAssetToRef(a.asset_id);
      msg = `Promoted to style reference ${ref.file} (now ${project.getStyle().refs.length}/4) and approved.`;
    } else {
      const rec = project.setAssetStatus(a.asset_id, a.action === "approve" ? "approved" : "rejected");
      msg = `Asset ${rec.id} -> ${rec.status}.`;
    }
    if (a.rating !== undefined) project.rateAsset(a.asset_id, a.rating);
    return { content: [text(msg + (a.rating !== undefined ? ` Rated ${a.rating}/5.` : ""))] };
  },
);

server.registerTool(
  "pixellab_project_create_character",
  {
    title: "Create a character (rotations)",
    description:
      "Create a persistent character with directional rotations (create-character-v3) for a " +
      "project, applying its style. EXPENSIVE and slow — generates + downloads all rotations, " +
      "polled to completion. Saves it and returns the south-facing rotation.",
    inputSchema: {
      slug: z.string(),
      description: z.string(),
      width: z.number().int().min(16).max(512).optional(),
      height: z.number().int().min(16).max(512).optional(),
      view: z.enum(["side", "low top-down", "high top-down"]).optional(),
      seed: z.number().int().min(0).optional(),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    const size = a.width || a.height ? { width: a.width ?? 64, height: a.height ?? 64 } : undefined;
    const out = await createCharacterForProject(client, project, {
      description: a.description,
      size,
      view: a.view,
      seed: a.seed,
    });
    const south = Buffer.from(project.readCharacterImage(out.character.id, "south")).toString("base64");
    return {
      content: [
        img(south),
        text(
          `character ${out.character.id} "${out.character.name}" — ${out.directionsDownloaded} rotations, usage: ${formatUsage(out.character.usage)}`,
        ),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_characters",
  {
    title: "List project characters",
    description: "List a project's saved characters with id, name, directions and rotation count.",
    inputSchema: { slug: z.string() },
  },
  async (a) => {
    const chars = store.open(a.slug).listCharacters();
    if (chars.length === 0) return { content: [text("No characters yet.")] };
    return {
      content: [
        text(
          chars
            .map((c) => `${c.id}  "${c.name}"  ${c.directions} dirs  ${Object.keys(c.rotations).length} rotations`)
            .join("\n"),
        ),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_delete_character",
  {
    title: "Delete a character",
    description: "Permanently delete a saved character (rotations + animations) from the project.",
    inputSchema: { slug: z.string(), character_id: z.string() },
  },
  async (a) => {
    const project = store.open(a.slug);
    project.deleteCharacter(a.character_id);
    return { content: [text(`Deleted character ${a.character_id}.`)] };
  },
);

server.registerTool(
  "pixellab_project_create_object",
  {
    title: "Create a directional object",
    description:
      "Create a persistent directional object (tree, barrel, item, building) with rotations " +
      "(create-8/1-direction-object) for a project, applying its style. EXPENSIVE and slow. " +
      "Saves it and returns the first rotation. NOTE: directions=1 with size ≤170 finishes in " +
      "REVIEW — it returns candidate frames; resolve with pixellab_project_select_object_frames.",
    inputSchema: {
      slug: z.string(),
      description: z.string(),
      directions: z.number().int().optional(),
      size: z.number().int().min(32).max(256).optional(),
      view: z.enum(["side", "low top-down", "high top-down"]).optional(),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    const out = await createObjectForProject(client, project, {
      description: a.description,
      directions: a.directions ?? 8,
      size: a.size,
      view: a.view,
    });
    if (out.review) {
      const content: Content[] = [
        text(
          `Object ${out.review.id} finished in REVIEW with ${out.review.frames.length} candidate frames ` +
            `(indices 0-${out.review.frames.length - 1}). Pick frames with ` +
            `pixellab_project_select_object_frames. Candidates:`,
        ),
        ...out.review.frames.map((_f, i) =>
          img(Buffer.from(project.readObjectReviewFrame(out.review!.id, i)).toString("base64")),
        ),
      ];
      return { content };
    }
    const object = out.object!;
    const first = Object.keys(object.rotations)[0];
    const content: Content[] = [];
    if (first) content.push(img(Buffer.from(project.readObjectImage(object.id, first)).toString("base64")));
    content.push(text(`object ${object.id} "${object.name}" — ${out.directionsDownloaded} rotations`));
    return { content };
  },
);

server.registerTool(
  "pixellab_project_object_reviews",
  {
    title: "List object reviews",
    description:
      "List 1-direction objects awaiting frame selection (id, prompt, candidate count). These came " +
      "back in REVIEW — resolve with pixellab_project_select_object_frames.",
    inputSchema: { slug: z.string() },
  },
  async (a) => {
    const reviews = store.open(a.slug).listObjectReviews();
    if (reviews.length === 0) return { content: [text("No objects awaiting review.")] };
    return {
      content: [
        text(
          reviews
            .map((r) => `${r.id}  "${r.prompt}"  ${r.frames.length} candidates (indices 0-${r.frames.length - 1})`)
            .join("\n"),
        ),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_select_object_frames",
  {
    title: "Select object frames (resolve review)",
    description:
      "Resolve a 1-direction object review: keep the chosen candidate frames (0-based indices). Each " +
      "kept frame becomes its own finished object. Clears the review afterwards.",
    inputSchema: {
      slug: z.string(),
      object_id: z.string(),
      indices: z.array(z.number().int().min(0)).min(1),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    const { objects } = await selectObjectFramesForProject(client, project, a.object_id, a.indices);
    const content: Content[] = [text(`Kept ${objects.length} object(s): ${objects.map((o) => o.id).join(", ")}.`)];
    for (const o of objects) {
      const dir = Object.keys(o.rotations)[0];
      if (dir) content.push(img(Buffer.from(project.readObjectImage(o.id, dir)).toString("base64")));
    }
    return { content };
  },
);

server.registerTool(
  "pixellab_project_objects",
  {
    title: "List project objects",
    description: "List a project's saved objects with id, name and directions.",
    inputSchema: { slug: z.string() },
  },
  async (a) => {
    const objects = store.open(a.slug).listObjects();
    if (objects.length === 0) return { content: [text("No objects yet.")] };
    return {
      content: [text(objects.map((o) => `${o.id}  "${o.name}"  ${o.directions} dirs`).join("\n"))],
    };
  },
);

server.registerTool(
  "pixellab_project_delete_object",
  {
    title: "Delete an object",
    description: "Permanently delete a saved object from the project.",
    inputSchema: { slug: z.string(), object_id: z.string() },
  },
  async (a) => {
    const project = store.open(a.slug);
    project.deleteObject(a.object_id);
    return { content: [text(`Deleted object ${a.object_id}.`)] };
  },
);

server.registerTool(
  "pixellab_project_discard_object_review",
  {
    title: "Discard an object review",
    description:
      "Discard a pending 1-direction object review — throw away all its candidate frames without " +
      "keeping any (use when none are good).",
    inputSchema: { slug: z.string(), object_id: z.string() },
  },
  async (a) => {
    const project = store.open(a.slug);
    project.deleteObjectReview(a.object_id);
    return { content: [text(`Discarded object review ${a.object_id}.`)] };
  },
);

server.registerTool(
  "pixellab_project_animate_character",
  {
    title: "Animate a character",
    description:
      "Add an animation to a character (animate-character) — action like 'walking'. EXPENSIVE/slow " +
      "(one job per direction, polled). Frames are downloaded and saved to the character.",
    inputSchema: {
      slug: z.string(),
      character_id: z.string(),
      action_description: z.string(),
      animation_name: z.string().optional(),
      frame_count: z.number().int().min(4).max(16).optional(),
      directions: z
        .array(
          z.enum(["south", "north", "east", "west", "south-east", "north-east", "north-west", "south-west"]),
        )
        .optional()
        .describe("Which directions to animate (default south only). More = more cost/time."),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    const out = await animateCharacterForProject(client, project, {
      characterId: a.character_id,
      actionDescription: a.action_description,
      animationName: a.animation_name,
      frameCount: a.frame_count,
      directions: a.directions,
    });
    return {
      content: [
        text(`Created animation "${out.name}" — ${out.frameCount} frames across ${out.directions.length} directions, saved.`),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_generate_ui",
  {
    title: "Generate a UI element",
    description:
      "Generate a pixel-art UI element (button, health bar, panel, icon) via generate-ui-v2 (Pro, async). " +
      "Saves it to the project's asset library and returns it.",
    inputSchema: {
      slug: z.string(),
      description: z.string(),
      width: z.number().int().min(16).max(512).optional(),
      height: z.number().int().min(16).max(512).optional(),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    const size = a.width || a.height ? { width: a.width ?? 64, height: a.height ?? 64 } : undefined;
    const asset = await generateUIForProject(client, project, { description: a.description, size });
    return {
      content: [
        img(Buffer.from(project.readAssetBytes(asset.id)).toString("base64")),
        text(`UI element saved as asset ${asset.id} (${formatUsage(asset.usage)}).`),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_edit_asset",
  {
    title: "Edit an existing asset",
    description:
      "Apply an image operation to a project asset and save the result as a new asset. Ops: " +
      "remove-background, image-to-pixelart, edit (text-described change), rotate, resize.",
    inputSchema: {
      slug: z.string(),
      asset_id: z.string(),
      op: z.enum(["remove-background", "image-to-pixelart", "edit", "rotate", "resize"]),
      description: z.string().optional(),
      target_width: z.number().int().min(16).max(512).optional(),
      target_height: z.number().int().min(16).max(512).optional(),
      to_direction: z
        .enum(["south", "north", "east", "west", "south-east", "north-east", "north-west", "south-west"])
        .optional(),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    let spec: EditOp;
    if (a.op === "edit") spec = { op: "edit", description: a.description ?? "" };
    else if (a.op === "resize")
      spec = { op: "resize", targetWidth: a.target_width ?? 128, targetHeight: a.target_height ?? 128 };
    else if (a.op === "rotate") spec = { op: "rotate", toDirection: a.to_direction };
    else if (a.op === "image-to-pixelart")
      spec = { op: "image-to-pixelart", outputWidth: a.target_width, outputHeight: a.target_height };
    else spec = { op: "remove-background" };

    const asset = await editAssetForProject(client, project, a.asset_id, spec);
    return {
      content: [
        img(Buffer.from(project.readAssetBytes(asset.id)).toString("base64")),
        text(`${a.op} → new asset ${asset.id} (${formatUsage(asset.usage)}).`),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_create_tileset",
  {
    title: "Create a tileset (scene)",
    description:
      "Create a seamless terrain tileset (~16-23 tiles) via create-tileset (Pro, async). For " +
      "kind='top-down': provide lower/base + upper/elevated terrain. For kind='sidescroller': only " +
      "lower_description (the platform/ground). EXPENSIVE/slow. Saves all tiles.",
    inputSchema: {
      slug: z.string(),
      lower_description: z.string(),
      upper_description: z.string().optional().describe("Top-down only; ignored for sidescroller."),
      transition_description: z.string().optional(),
      tile_size: z.union([z.literal(16), z.literal(32)]).optional(),
      kind: z.enum(["top-down", "sidescroller"]).optional(),
      view: z.enum(["low top-down", "high top-down"]).optional().describe("Top-down only."),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    const ts = await createTilesetForProject(client, project, {
      lowerDescription: a.lower_description,
      upperDescription: a.upper_description,
      transitionDescription: a.transition_description,
      tileWidth: a.tile_size,
      tileHeight: a.tile_size,
      view: a.view,
      kind: a.kind ?? "top-down",
    });
    const previews: Content[] = ts.tiles
      .slice(0, 4)
      .map((t) => img(Buffer.from(project.readTileImage(ts.id, t.id)).toString("base64")));
    return {
      content: [
        text(
          `Tileset ${ts.id} — ${ts.totalTiles} tiles (${ts.tileSize.width}x${ts.tileSize.height}), terrains ${ts.terrainTypes.join("/")} (${formatUsage(ts.usage)}). Sample tiles:`,
        ),
        ...previews,
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_create_isometric_tile",
  {
    title: "Create an isometric tile",
    description:
      "Generate a single isometric ground/terrain tile (create-isometric-tile, async) for isometric " +
      "maps. Saves it to the project's asset library. shape controls thickness.",
    inputSchema: {
      slug: z.string(),
      description: z.string(),
      size: z.number().int().min(16).max(64).optional(),
      shape: z.enum(["thin tile", "thick tile", "block"]).optional(),
      seed: z.number().int().min(0).optional(),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    const asset = await createIsometricTileForProject(client, project, {
      description: a.description,
      size: a.size,
      shape: a.shape,
      seed: a.seed,
    });
    return {
      content: [
        img(Buffer.from(project.readAssetBytes(asset.id)).toString("base64")),
        text(`Isometric tile saved as asset ${asset.id} (${formatUsage(asset.usage)}).`),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_inpaint",
  {
    title: "Inpaint an asset region",
    description:
      "Repaint a masked region of a project asset from a text description (inpaint). Provide a base64 " +
      "PNG mask the same size as the asset (WHITE = repaint, black = keep). Saves a new asset.",
    inputSchema: {
      slug: z.string(),
      asset_id: z.string(),
      mask_base64: z.string().describe("Base64 PNG mask, same size; white = region to repaint"),
      description: z.string(),
      seed: z.number().int().min(0).optional(),
    },
  },
  async (a) => {
    const project = store.open(a.slug);
    const asset = await inpaintAssetForProject(client, project, {
      assetId: a.asset_id,
      maskBase64: stripDataUrl(a.mask_base64),
      description: a.description,
      seed: a.seed,
    });
    return {
      content: [
        img(Buffer.from(project.readAssetBytes(asset.id)).toString("base64")),
        text(`Inpainted → new asset ${asset.id} (${formatUsage(asset.usage)}).`),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_tilesets",
  {
    title: "List project tilesets",
    description: "List a project's saved tilesets (id, terrains, tile count).",
    inputSchema: { slug: z.string() },
  },
  async (a) => {
    const tilesets = store.open(a.slug).listTilesets();
    if (tilesets.length === 0) return { content: [text("No tilesets yet.")] };
    return {
      content: [
        text(
          tilesets
            .map((t) => `${t.id}  ${t.lowerDescription}/${t.upperDescription}  ${t.totalTiles} tiles`)
            .join("\n"),
        ),
      ],
    };
  },
);

server.registerTool(
  "pixellab_project_delete_tileset",
  {
    title: "Delete a tileset",
    description: "Permanently delete a saved tileset from the project.",
    inputSchema: { slug: z.string(), tileset_id: z.string() },
  },
  async (a) => {
    const project = store.open(a.slug);
    project.deleteTileset(a.tileset_id);
    return { content: [text(`Deleted tileset ${a.tileset_id}.`)] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[pixellabrat-mcp] ready on stdio");
