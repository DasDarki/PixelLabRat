import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Project } from "./project";
import { defaultProjectsRoot, slugify, uniqueSlug } from "./paths";
import { DEFAULT_SIZE, type ProjectManifest, type ProjectSummary } from "./types";

function now(): string {
  return new Date().toISOString();
}

/** Manages the root folder of all projects. */
export class Store {
  readonly root: string;

  constructor(root: string = defaultProjectsRoot()) {
    this.root = root;
    mkdirSync(this.root, { recursive: true });
  }

  private slugDirs(): string[] {
    return readdirSync(this.root).filter((name) => {
      const dir = join(this.root, name);
      return statSync(dir).isDirectory() && existsSync(join(dir, "project.json"));
    });
  }

  list(): ProjectSummary[] {
    return this.slugDirs()
      .map((slug) => {
        const p = Project.load(join(this.root, slug));
        const counts = p.summaryCounts();
        return {
          id: p.id,
          slug: p.slug,
          name: p.name,
          createdAt: p.createdAt,
          ...counts,
        };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  createProject(name: string): Project {
    const slug = uniqueSlug(this.root, slugify(name));
    const manifest: ProjectManifest = {
      id: crypto.randomUUID(),
      slug,
      name: name.trim() || slug,
      createdAt: now(),
      style: { refs: [], defaultSize: { ...DEFAULT_SIZE } },
    };
    return Project.create(join(this.root, slug), manifest);
  }

  open(slug: string): Project {
    const dir = join(this.root, slug);
    if (!existsSync(join(dir, "project.json"))) {
      throw new Error(`No project at slug "${slug}" under ${this.root}`);
    }
    return Project.load(dir);
  }

  openById(id: string): Project {
    for (const slug of this.slugDirs()) {
      const p = Project.load(join(this.root, slug));
      if (p.id === id) return p;
    }
    throw new Error(`No project with id ${id}`);
  }

  delete(slug: string): void {
    const dir = join(this.root, slug);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

export function openStore(root?: string): Store {
  return new Store(root);
}
