import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Reference guides (the harvested in-app copilot knowledge) live in <package>/guides/*.md
// and are loaded on demand via the get_guide tool, so they don't bloat every context.
function packageRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const GUIDES_DIR = path.join(packageRoot(path.dirname(fileURLToPath(import.meta.url))), "guides");

export const GUIDE_TOPICS = ["authoring", "domain", "quality", "evaluation", "knowledge", "multimodal", "integration", "workspace", "analytics", "billing", "testing"] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export function readGuide(topic: string): string | null {
  if (!(GUIDE_TOPICS as readonly string[]).includes(topic)) return null;
  try {
    return fs.readFileSync(path.join(GUIDES_DIR, `${topic}.md`), "utf8");
  } catch {
    return null;
  }
}
