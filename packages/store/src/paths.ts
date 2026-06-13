import { existsSync } from "node:fs";
import { join } from "node:path";

/** Root directory that holds all project folders. */
export function defaultProjectsRoot(): string {
  return process.env.PIXELLABRAT_PROJECTS_DIR ?? join(process.cwd(), "projects");
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

/** Append -2, -3, ... until the slug's folder does not exist under root. */
export function uniqueSlug(root: string, base: string): string {
  let slug = base;
  let n = 2;
  while (existsSync(join(root, slug))) {
    slug = `${base}-${n++}`;
  }
  return slug;
}
