import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "../../common/src/env.js";
import { sha256 } from "../../common/src/hash.js";
import { StoredContent } from "../../common/src/types.js";
import { toMarkdown } from "./frontmatter.js";

async function writeAtomic(targetPath: string, content: string): Promise<void> {
  const directory = path.dirname(targetPath);
  await mkdir(directory, { recursive: true });

  const tempPath = `${targetPath}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, targetPath);
}

async function unchanged(targetPath: string, nextContent: string): Promise<boolean> {
  try {
    const existing = await readFile(targetPath, "utf8");
    return sha256(existing) === sha256(nextContent);
  } catch {
    return false;
  }
}

export async function writeMarkdown(
  article: StoredContent,
): Promise<{ filePath: string; changed: boolean }> {
  const env = getEnv();
  const filePath = path.resolve(process.cwd(), env.HUGO_CONTENT_DIR, `${article.slug}.md`);
  const markdown = toMarkdown(article);

  if (await unchanged(filePath, markdown)) {
    return { filePath, changed: false };
  }

  await writeAtomic(filePath, markdown);
  return { filePath, changed: true };
}

export async function cleanDirectory(): Promise<void> {
  const env = getEnv();
  const target = path.resolve(process.cwd(), env.HUGO_CONTENT_DIR);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}
