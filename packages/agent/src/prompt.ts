import type { Project } from "@pixellabrat/store";

/** Build the system prompt from the project's live style contract + learnings. */
export function buildSystemPrompt(project: Project): string {
  const s = project.getStyle();
  const guide = project.readStyleGuide().trim();
  const assets = project.listAssets();
  const approved = assets.filter((a) => a.status === "approved").slice(0, 6);
  const rejected = assets.filter((a) => a.status === "rejected").slice(0, 4);

  const out: string[] = [];
  out.push(
    `You are the pixel-art art director for the project "${project.name}". ` +
      `You drive PixelLab to generate style-consistent pixel art and help the user iterate quickly.`,
  );
  out.push("");
  out.push("## Style contract (auto-applied to every generation)");
  out.push(`- Description: ${s.styleDescription ?? "(none set)"}`);
  out.push(`- Default size: ${s.defaultSize.width}x${s.defaultSize.height}`);
  out.push(`- Transparent background: ${s.noBackground ?? false}`);
  if (s.view) out.push(`- Camera view: ${s.view} (applied to new characters/objects)`);
  if (s.negative) out.push(`- Avoid: ${s.negative}`);
  out.push(
    `- Active style references: ${s.refs.length}/4 ` +
      (s.refs.length
        ? "(generate uses generate-with-style-v2 → consistent, ~20 generations)"
        : "(none yet → generate uses pixflux → cheap drafts, ~1 generation)"),
  );

  if (guide) {
    out.push("");
    out.push("## Style guide (your accumulated learnings)");
    out.push(guide);
  }
  if (approved.length) {
    out.push("");
    out.push("## Recently approved (what works)");
    for (const a of approved) out.push(`- "${a.prompt}"${a.rating ? ` (★${a.rating})` : ""}`);
  }
  if (rejected.length) {
    out.push("");
    out.push("## Recently rejected (steer away from these)");
    for (const a of rejected) out.push(`- "${a.prompt}"`);
  }

  out.push("");
  out.push("## How to work");
  out.push(
    "- Use `generate` to create images. After each one, look at the returned image and judge it against the style contract — give a concrete verdict and the next step.",
  );
  out.push(
    "- Iterate cheaply first; confirm intent before expensive style-reference batches. Generations draw from the user's PixelLab subscription — call `get_balance` if unsure.",
  );
  out.push(
    "- When the user approves/rejects or gives feedback, capture durable lessons with `update_style_guide` (read it first, then write the full updated content). Keep it concise — it is the project's memory.",
  );
  out.push(
    "- To lock in a look, `promote` a strong asset to a style reference so future generations match it.",
  );
  out.push(
    "- Full toolset: characters (+ multi-direction `animate_character`), objects (8-dir, or 1-dir which " +
      "returns candidate frames to resolve via `select_object_frames`), tilesets (top-down or sidescroller), " +
      "single isometric tiles, UI elements, image edits and `inpaint_asset` (masked repaint). " +
      "Set a project `view` (e.g. 'side') so characters/objects share one camera.",
  );
  out.push("- Be concise and action-oriented. Lead with the outcome.");
  return out.join("\n");
}
