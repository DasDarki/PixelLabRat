import type Anthropic from "@anthropic-ai/sdk";
import { formatUsage, type PixelLab } from "@pixellabrat/core";
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
  selectObjectFramesForProject,
  type EditOp,
  type Project,
} from "@pixellabrat/store";

export interface ToolContext {
  project: Project;
  pixel: PixelLab;
}

export type ToolResultContent = Anthropic.ToolResultBlockParam["content"];

export interface ToolOutcome {
  content: ToolResultContent;
  /** Short human-readable line for the UI / event log. */
  summary: string;
  /** Set when the tool produced a new asset, so the UI can refresh. */
  assetId?: string;
}

/** Anthropic tool definitions exposed to the agent. */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_balance",
    description:
      "Get the PixelLab account balance (subscription generations remaining + USD credits). Free to call.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_style",
    description: "Read the project's style contract (description, default size, references, palette).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "set_style",
    description: "Update fields of the project's style contract. Only pass fields you want to change.",
    input_schema: {
      type: "object",
      properties: {
        style_description: { type: "string", maxLength: 500 },
        default_width: { type: "integer", minimum: 16, maximum: 512 },
        default_height: { type: "integer", minimum: 16, maximum: 512 },
        no_background: { type: "boolean" },
        negative: { type: "string" },
        view: {
          type: "string",
          enum: ["side", "low top-down", "high top-down"],
          description:
            "Default camera view applied to new characters/objects. 'side' for sidescrollers/dioramas.",
        },
      },
    },
  },
  {
    name: "generate",
    description:
      "Generate a pixel-art image for the project, applying its style contract automatically. " +
      "With style references present this uses generate-with-style-v2 (~20 generations); without, " +
      "pixflux (~1 generation). The generated image is returned so you can judge it. Saved as a draft asset. " +
      "Be deliberate with cost — iterate cheaply, confirm before expensive batches.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What to generate, in the project's style" },
        width: { type: "integer", minimum: 16, maximum: 512 },
        height: { type: "integer", minimum: 16, maximum: 512 },
        seed: { type: "integer", minimum: 0 },
      },
      required: ["description"],
    },
  },
  {
    name: "list_assets",
    description: "List the project's library assets with id, status, endpoint, rating and prompt.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_character",
    description:
      "Create a persistent character with 8 directional rotations (create-character-v3) for the " +
      "project, applying its style. EXPENSIVE and slow — it generates and downloads all rotations. " +
      "Confirm with the user before using. Returns the south-facing rotation when done.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "The character to create" },
        width: { type: "integer", minimum: 16, maximum: 512 },
        height: { type: "integer", minimum: 16, maximum: 512 },
        view: {
          type: "string",
          enum: ["side", "low top-down", "high top-down"],
          description: "Camera view (defaults to the style contract's view).",
        },
        seed: { type: "integer", minimum: 0 },
      },
      required: ["description"],
    },
  },
  {
    name: "list_characters",
    description: "List the project's saved characters (id, name, directions).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_object",
    description:
      "Create a persistent directional object (tree, barrel, item, building) with rotations " +
      "(create-8/1-direction-object) for the project, applying its style. EXPENSIVE and slow. " +
      "Confirm with the user first. Returns the south-facing rotation when done. NOTE: directions=1 " +
      "with size ≤170 finishes in REVIEW — it returns several candidate frames; call " +
      "select_object_frames with the object id and the indices to keep.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        directions: { type: "integer", enum: [1, 8], description: "1 or 8 (default 8)" },
        size: {
          type: "integer",
          minimum: 32,
          maximum: 256,
          description: "Square size px (default 64). For directions=1, use >170 for a single object.",
        },
        view: {
          type: "string",
          enum: ["side", "low top-down", "high top-down"],
          description: "Camera view (defaults to the style contract's view).",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "list_objects",
    description: "List the project's saved objects (id, name, directions).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_object_reviews",
    description:
      "List 1-direction objects awaiting frame selection (id, prompt, candidate count). " +
      "These came back in REVIEW status — pick frames with select_object_frames.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "select_object_frames",
    description:
      "Resolve an object review: keep the chosen candidate frames (by 0-based index). Each kept " +
      "frame becomes its own finished object. Clears the review afterwards.",
    input_schema: {
      type: "object",
      properties: {
        object_id: { type: "string" },
        indices: {
          type: "array",
          items: { type: "integer", minimum: 0 },
          description: "0-based indices of the candidate frames to keep.",
        },
      },
      required: ["object_id", "indices"],
    },
  },
  {
    name: "animate_character",
    description:
      "Add an animation to an existing character (animate-character). Provide the character id and " +
      "an action like 'walking' or 'swinging a sword'. EXPENSIVE and slow (one job per direction, " +
      "polled to completion). The frames are downloaded and saved to the character.",
    input_schema: {
      type: "object",
      properties: {
        character_id: { type: "string" },
        action_description: { type: "string" },
        animation_name: { type: "string" },
        frame_count: { type: "integer", minimum: 4, maximum: 16 },
        directions: {
          type: "array",
          items: {
            type: "string",
            enum: ["south", "north", "east", "west", "south-east", "north-east", "north-west", "south-west"],
          },
          description:
            "Which directions to animate (default: south only). More directions = proportionally more cost/time.",
        },
      },
      required: ["character_id", "action_description"],
    },
  },
  {
    name: "generate_ui",
    description:
      "Generate a pixel-art UI element (button, health bar, panel, icon, frame) via generate-ui-v2 " +
      "(Pro, async). Saves the result to the asset library.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "The UI element to generate" },
        width: { type: "integer", minimum: 16, maximum: 512 },
        height: { type: "integer", minimum: 16, maximum: 512 },
      },
      required: ["description"],
    },
  },
  {
    name: "edit_asset",
    description:
      "Apply an image operation to an existing project asset and save the result as a new asset. " +
      "Ops: 'remove-background', 'image-to-pixelart' (convert an image to pixel art), 'edit' (apply a " +
      "text-described change), 'rotate' (change facing direction), 'resize' (intelligent up/downscale).",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        op: {
          type: "string",
          enum: ["remove-background", "image-to-pixelart", "edit", "rotate", "resize"],
        },
        description: { type: "string", description: "For op=edit: the change to make" },
        target_width: { type: "integer", description: "For op=resize / image-to-pixelart" },
        target_height: { type: "integer", description: "For op=resize / image-to-pixelart" },
        to_direction: {
          type: "string",
          enum: ["south", "north", "east", "west", "south-east", "north-east", "north-west", "south-west"],
          description: "For op=rotate",
        },
      },
      required: ["asset_id", "op"],
    },
  },
  {
    name: "create_tileset",
    description:
      "Create a seamless terrain tileset (a scene building-block) via create-tileset (Pro, async, " +
      "~16-23 tiles). For kind='top-down': provide a lower/base terrain and an upper/elevated terrain " +
      "(e.g. lower 'grass', upper 'water'). For kind='sidescroller': only lower_description is used " +
      "(the platform/ground terrain). EXPENSIVE and slow. Saves all tiles; returns a couple as preview.",
    input_schema: {
      type: "object",
      properties: {
        lower_description: { type: "string", description: "Base/ground terrain, e.g. 'grass'" },
        upper_description: {
          type: "string",
          description: "Elevated terrain for top-down, e.g. 'water' (ignored for sidescroller)",
        },
        transition_description: { type: "string" },
        tile_size: { type: "integer", enum: [16, 32], description: "16 or 32 (default 16)" },
        kind: {
          type: "string",
          enum: ["top-down", "sidescroller"],
          description: "'top-down' (default) or 'sidescroller'.",
        },
        view: {
          type: "string",
          enum: ["low top-down", "high top-down"],
          description: "Top-down camera height (top-down kind only).",
        },
      },
      required: ["lower_description"],
    },
  },
  {
    name: "create_isometric_tile",
    description:
      "Generate a single isometric ground/terrain tile (create-isometric-tile, async). Good for " +
      "isometric game maps. Saves the tile to the asset library. shape controls thickness " +
      "(thin/thick tile, block).",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "The isometric tile, e.g. 'grass block', 'stone path'" },
        size: { type: "integer", minimum: 16, maximum: 64, description: "Square size px (default 32)" },
        shape: {
          type: "string",
          enum: ["thin tile", "thick tile", "block"],
          description: "Tile thickness (default 'block').",
        },
        seed: { type: "integer", minimum: 0 },
      },
      required: ["description"],
    },
  },
  {
    name: "inpaint_asset",
    description:
      "Repaint a masked region of an existing asset from a text description (inpaint). Provide the " +
      "asset id, a base64 PNG mask the same size as the asset (WHITE pixels = repaint, black = keep), " +
      "and what to draw there. Saves the result as a new asset.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        mask_base64: { type: "string", description: "Base64 PNG mask, same size; white = region to repaint" },
        description: { type: "string", description: "What to paint in the masked region" },
        seed: { type: "integer", minimum: 0 },
      },
      required: ["asset_id", "mask_base64", "description"],
    },
  },
  {
    name: "list_tilesets",
    description: "List the project's saved tilesets (id, terrains, tile count).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "delete_character",
    description:
      "Permanently delete a saved character (with its rotations and animations) from the project. " +
      "Destructive — confirm with the user first.",
    input_schema: {
      type: "object",
      properties: { character_id: { type: "string" } },
      required: ["character_id"],
    },
  },
  {
    name: "delete_object",
    description: "Permanently delete a saved object from the project. Destructive — confirm first.",
    input_schema: {
      type: "object",
      properties: { object_id: { type: "string" } },
      required: ["object_id"],
    },
  },
  {
    name: "delete_tileset",
    description: "Permanently delete a saved tileset from the project. Destructive — confirm first.",
    input_schema: {
      type: "object",
      properties: { tileset_id: { type: "string" } },
      required: ["tileset_id"],
    },
  },
  {
    name: "remove_ref",
    description:
      "Remove a style reference from the project's style contract by its file path " +
      "(see get_style → references). Future generations no longer match it.",
    input_schema: {
      type: "object",
      properties: { file: { type: "string", description: "The ref's file path, e.g. 'refs/<id>.png'" } },
      required: ["file"],
    },
  },
  {
    name: "discard_object_review",
    description:
      "Discard a pending 1-direction object review — throw away all its candidate frames without " +
      "keeping any. Use when none of the candidates are good.",
    input_schema: {
      type: "object",
      properties: { object_id: { type: "string" } },
      required: ["object_id"],
    },
  },
  {
    name: "review_asset",
    description:
      "Approve, reject, or promote a draft asset. 'promote' approves AND adds it to the style " +
      "references so future generations match it. Optionally set a 1-5 rating.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        action: { type: "string", enum: ["approve", "reject", "promote"] },
        rating: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["asset_id", "action"],
    },
  },
  {
    name: "read_style_guide",
    description: "Read the project's STYLE_GUIDE.md (accumulated do/don't, palette notes, winning patterns).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_style_guide",
    description:
      "Overwrite the project's STYLE_GUIDE.md with refined learnings. Keep it concise and durable — " +
      "this is the project's memory that shapes future generations. Read it first, then write the full updated content.",
    input_schema: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const { project, pixel } = ctx;

  switch (name) {
    case "get_balance": {
      const b = await pixel.getBalance();
      const text =
        `Plan: ${b.subscription.plan} (${b.subscription.status}); ` +
        `generations ${b.subscription.generations}/${b.subscription.total}; ` +
        `USD $${b.credits.usd.toFixed(2)}`;
      return { content: text, summary: "checked balance" };
    }

    case "get_style": {
      const s = project.getStyle();
      const text = JSON.stringify(
        {
          styleDescription: s.styleDescription,
          defaultSize: s.defaultSize,
          noBackground: s.noBackground ?? false,
          negative: s.negative,
          view: s.view,
          referenceCount: s.refs.length,
          references: s.refs.map((r) => r.file),
        },
        null,
        2,
      );
      return { content: text, summary: "read style contract" };
    }

    case "set_style": {
      const patch: Record<string, unknown> = {};
      if (typeof input.style_description === "string") patch.styleDescription = input.style_description;
      if (typeof input.no_background === "boolean") patch.noBackground = input.no_background;
      if (typeof input.negative === "string") patch.negative = input.negative;
      if (typeof input.view === "string") patch.view = input.view;
      if (typeof input.default_width === "number" || typeof input.default_height === "number") {
        const cur = project.getStyle().defaultSize;
        patch.defaultSize = {
          width: (input.default_width as number) ?? cur.width,
          height: (input.default_height as number) ?? cur.height,
        };
      }
      project.setStyle(patch);
      return { content: "Style updated.", summary: "updated style contract" };
    }

    case "generate": {
      const out = await generateForProject(pixel, project, {
        description: String(input.description ?? ""),
        size:
          input.width || input.height
            ? { width: (input.width as number) ?? 64, height: (input.height as number) ?? 64 }
            : undefined,
        seed: input.seed as number | undefined,
      });
      const base64 = Buffer.from(project.readAssetBytes(out.asset.id)).toString("base64");
      return {
        content: [
          {
            type: "text",
            text: `Generated draft asset ${out.asset.id} via ${out.mode} (usage: ${formatUsage(out.asset.usage)}). Here is the result:`,
          },
          { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
        ],
        summary: `generated ${out.mode} (${formatUsage(out.asset.usage)})`,
        assetId: out.asset.id,
      };
    }

    case "list_assets": {
      const assets = project.listAssets();
      if (assets.length === 0) return { content: "Library is empty.", summary: "listed assets (0)" };
      const text = assets
        .map((a) => `${a.id} | ${a.status} | ${a.endpoint} | rating=${a.rating ?? "-"} | "${a.prompt}"`)
        .join("\n");
      return { content: text, summary: `listed ${assets.length} assets` };
    }

    case "create_character": {
      const size =
        input.width || input.height
          ? { width: (input.width as number) ?? 64, height: (input.height as number) ?? 64 }
          : undefined;
      const out = await createCharacterForProject(pixel, project, {
        description: String(input.description ?? ""),
        size,
        view: input.view as string | undefined,
        seed: input.seed as number | undefined,
      });
      const south = Buffer.from(project.readCharacterImage(out.character.id, "south")).toString("base64");
      return {
        content: [
          {
            type: "text",
            text: `Created character ${out.character.id} "${out.character.name}" with ${out.directionsDownloaded} rotations (usage: ${formatUsage(out.character.usage)}). South-facing rotation:`,
          },
          { type: "image", source: { type: "base64", media_type: "image/png", data: south } },
        ],
        summary: `created character (${out.directionsDownloaded} dirs, ${formatUsage(out.character.usage)})`,
      };
    }

    case "list_characters": {
      const chars = project.listCharacters();
      if (chars.length === 0) return { content: "No characters yet.", summary: "listed characters (0)" };
      const text = chars
        .map((c) => `${c.id} | "${c.name}" | ${c.directions} dirs | ${Object.keys(c.rotations).length} rotations`)
        .join("\n");
      return { content: text, summary: `listed ${chars.length} characters` };
    }

    case "create_object": {
      const out = await createObjectForProject(pixel, project, {
        description: String(input.description ?? ""),
        directions: (input.directions as number) ?? 8,
        size: input.size as number | undefined,
        view: input.view as string | undefined,
      });
      // 1-direction small objects return candidate frames for review.
      if (out.review) {
        const previews: ToolResultContent = [
          {
            type: "text",
            text:
              `Object ${out.review.id} finished in REVIEW with ${out.review.frames.length} candidate ` +
              `frames (indices 0-${out.review.frames.length - 1}). Pick the good ones with ` +
              `select_object_frames. Candidates:`,
          },
          ...out.review.frames.map((_f, i) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/png" as const,
              data: Buffer.from(project.readObjectReviewFrame(out.review!.id, i)).toString("base64"),
            },
          })),
        ];
        return {
          content: previews,
          summary: `object review (${out.review.frames.length} candidates)`,
        };
      }
      const object = out.object!;
      const south = Object.keys(object.rotations)[0];
      const img64 = south
        ? Buffer.from(project.readObjectImage(object.id, south)).toString("base64")
        : null;
      const content: ToolResultContent = img64
        ? [
            {
              type: "text",
              text: `Created object ${object.id} "${object.name}" with ${out.directionsDownloaded} rotations:`,
            },
            { type: "image", source: { type: "base64", media_type: "image/png", data: img64 } },
          ]
        : `Created object ${object.id} with ${out.directionsDownloaded} rotations.`;
      return { content, summary: `created object (${out.directionsDownloaded} dirs)`, assetId: undefined };
    }

    case "list_objects": {
      const objects = project.listObjects();
      if (objects.length === 0) return { content: "No objects yet.", summary: "listed objects (0)" };
      return {
        content: objects
          .map((o) => `${o.id} | "${o.name}" | ${o.directions} dirs`)
          .join("\n"),
        summary: `listed ${objects.length} objects`,
      };
    }

    case "list_object_reviews": {
      const reviews = project.listObjectReviews();
      if (reviews.length === 0) return { content: "No objects awaiting review.", summary: "listed reviews (0)" };
      return {
        content: reviews
          .map((r) => `${r.id} | "${r.prompt}" | ${r.frames.length} candidate frames (indices 0-${r.frames.length - 1})`)
          .join("\n"),
        summary: `listed ${reviews.length} object reviews`,
      };
    }

    case "select_object_frames": {
      const objectId = String(input.object_id ?? "");
      const indices = Array.isArray(input.indices)
        ? (input.indices as unknown[]).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0)
        : [];
      if (indices.length === 0) {
        return { content: "Provide at least one frame index to keep.", summary: "select-frames: no indices" };
      }
      const { objects } = await selectObjectFramesForProject(pixel, project, objectId, indices);
      const content: ToolResultContent = [
        { type: "text", text: `Kept ${objects.length} object(s): ${objects.map((o) => o.id).join(", ")}.` },
        ...objects
          .map((o) => {
            const dir = Object.keys(o.rotations)[0];
            if (!dir) return null;
            return {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/png" as const,
                data: Buffer.from(project.readObjectImage(o.id, dir)).toString("base64"),
              },
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null),
      ];
      return { content, summary: `selected ${objects.length} object frame(s)` };
    }

    case "animate_character": {
      const out = await animateCharacterForProject(pixel, project, {
        characterId: String(input.character_id ?? ""),
        actionDescription: String(input.action_description ?? ""),
        animationName: input.animation_name as string | undefined,
        frameCount: input.frame_count as number | undefined,
        directions: Array.isArray(input.directions) ? (input.directions as string[]) : undefined,
      });
      return {
        content: `Created animation "${out.name}" — ${out.frameCount} frames across ${out.directions.length} directions, downloaded and saved to the character.`,
        summary: `animated character ("${out.name}", ${out.frameCount} frames)`,
      };
    }

    case "generate_ui": {
      const size =
        input.width || input.height
          ? { width: (input.width as number) ?? 64, height: (input.height as number) ?? 64 }
          : undefined;
      const asset = await generateUIForProject(pixel, project, {
        description: String(input.description ?? ""),
        size,
      });
      const b64 = Buffer.from(project.readAssetBytes(asset.id)).toString("base64");
      return {
        content: [
          { type: "text", text: `UI element generated (asset ${asset.id}):` },
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
        ],
        summary: "generated UI element",
        assetId: asset.id,
      };
    }

    case "edit_asset": {
      const op = String(input.op);
      let spec: EditOp;
      if (op === "edit") spec = { op: "edit", description: String(input.description ?? "") };
      else if (op === "resize")
        spec = {
          op: "resize",
          targetWidth: (input.target_width as number) ?? 128,
          targetHeight: (input.target_height as number) ?? 128,
        };
      else if (op === "rotate") spec = { op: "rotate", toDirection: input.to_direction as string | undefined };
      else if (op === "image-to-pixelart")
        spec = {
          op: "image-to-pixelart",
          outputWidth: input.target_width as number | undefined,
          outputHeight: input.target_height as number | undefined,
        };
      else spec = { op: "remove-background" };

      const asset = await editAssetForProject(pixel, project, String(input.asset_id ?? ""), spec);
      const b64 = Buffer.from(project.readAssetBytes(asset.id)).toString("base64");
      return {
        content: [
          { type: "text", text: `${op} → new asset ${asset.id}:` },
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
        ],
        summary: `${op} asset`,
        assetId: asset.id,
      };
    }

    case "create_tileset": {
      const ts = await createTilesetForProject(pixel, project, {
        lowerDescription: String(input.lower_description ?? ""),
        upperDescription: input.upper_description as string | undefined,
        transitionDescription: input.transition_description as string | undefined,
        tileWidth: input.tile_size as number | undefined,
        tileHeight: input.tile_size as number | undefined,
        view: input.view as string | undefined,
        kind: input.kind === "sidescroller" ? "sidescroller" : "top-down",
      });
      const previews = ts.tiles.slice(0, 4).map((t) => ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: "image/png" as const,
          data: Buffer.from(project.readTileImage(ts.id, t.id)).toString("base64"),
        },
      }));
      return {
        content: [
          {
            type: "text",
            text: `Tileset ${ts.id} created — ${ts.totalTiles} tiles (${ts.tileSize.width}x${ts.tileSize.height}), terrains: ${ts.terrainTypes.join("/")}. Sample tiles:`,
          },
          ...previews,
        ],
        summary: `created tileset (${ts.totalTiles} tiles)`,
      };
    }

    case "create_isometric_tile": {
      const asset = await createIsometricTileForProject(pixel, project, {
        description: String(input.description ?? ""),
        size: input.size as number | undefined,
        shape: input.shape as string | undefined,
        seed: input.seed as number | undefined,
      });
      const b64 = Buffer.from(project.readAssetBytes(asset.id)).toString("base64");
      return {
        content: [
          { type: "text", text: `Isometric tile generated (asset ${asset.id}):` },
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
        ],
        summary: "generated isometric tile",
        assetId: asset.id,
      };
    }

    case "inpaint_asset": {
      const asset = await inpaintAssetForProject(pixel, project, {
        assetId: String(input.asset_id ?? ""),
        maskBase64: String(input.mask_base64 ?? ""),
        description: String(input.description ?? ""),
        seed: input.seed as number | undefined,
      });
      const b64 = Buffer.from(project.readAssetBytes(asset.id)).toString("base64");
      return {
        content: [
          { type: "text", text: `Inpainted → new asset ${asset.id}:` },
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
        ],
        summary: "inpainted asset",
        assetId: asset.id,
      };
    }

    case "list_tilesets": {
      const tilesets = project.listTilesets();
      if (tilesets.length === 0) return { content: "No tilesets yet.", summary: "listed tilesets (0)" };
      return {
        content: tilesets
          .map((t) => `${t.id} | ${t.lowerDescription} / ${t.upperDescription} | ${t.totalTiles} tiles`)
          .join("\n"),
        summary: `listed ${tilesets.length} tilesets`,
      };
    }

    case "delete_character": {
      const id = String(input.character_id ?? "");
      project.deleteCharacter(id);
      return { content: `Deleted character ${id}.`, summary: "deleted character" };
    }

    case "delete_object": {
      const id = String(input.object_id ?? "");
      project.deleteObject(id);
      return { content: `Deleted object ${id}.`, summary: "deleted object" };
    }

    case "delete_tileset": {
      const id = String(input.tileset_id ?? "");
      project.deleteTileset(id);
      return { content: `Deleted tileset ${id}.`, summary: "deleted tileset" };
    }

    case "remove_ref": {
      const file = String(input.file ?? "");
      project.removeRef(file);
      return {
        content: `Removed style reference ${file} (now ${project.getStyle().refs.length}/4).`,
        summary: "removed style ref",
      };
    }

    case "discard_object_review": {
      const id = String(input.object_id ?? "");
      project.deleteObjectReview(id);
      return { content: `Discarded object review ${id}.`, summary: "discarded object review" };
    }

    case "review_asset": {
      const id = String(input.asset_id ?? "");
      const action = String(input.action ?? "");
      let summary: string;
      if (action === "promote") {
        const ref = project.promoteAssetToRef(id);
        summary = `promoted ${id} to style ref (now ${project.getStyle().refs.length}/4)`;
      } else if (action === "approve" || action === "reject") {
        project.setAssetStatus(id, action === "approve" ? "approved" : "rejected");
        summary = `${action}d ${id}`;
      } else {
        return { content: `Unknown action "${action}".`, summary: "review failed" };
      }
      if (typeof input.rating === "number") project.rateAsset(id, input.rating);
      return { content: summary, summary, assetId: id };
    }

    case "read_style_guide": {
      const text = project.readStyleGuide();
      return { content: text || "(empty)", summary: "read style guide" };
    }

    case "update_style_guide": {
      project.writeStyleGuide(String(input.content ?? ""));
      return { content: "Style guide updated.", summary: "updated style guide" };
    }

    default:
      return { content: `Unknown tool "${name}".`, summary: "unknown tool" };
  }
}
