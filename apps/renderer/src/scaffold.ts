import { access, constants, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "../../common/src/env.js";

const DEFAULT_CONFIG = `baseURL = "https://example.com/"
languageCode = "en-us"
title = "US Cycle Topics"
`;

const DEFAULT_HOME = `---
title: "Home"
---
`;

async function ensureFile(filePath: string, content: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
    return;
  } catch {
    const directory = path.dirname(filePath);
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
}

export async function scaffoldHugoSite(): Promise<void> {
  const env = getEnv();
  const workdir = path.resolve(process.cwd(), env.HUGO_WORKDIR);
  const contentDir = path.resolve(process.cwd(), env.HUGO_CONTENT_DIR);
  const publicDir = path.resolve(process.cwd(), env.HUGO_PUBLIC_DIR);

  await mkdir(workdir, { recursive: true });
  await mkdir(contentDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  const configPath = path.join(workdir, "hugo.toml");
  await ensureFile(configPath, DEFAULT_CONFIG);

  const homePath = path.join(workdir, "content", "_index.md");
  await ensureFile(homePath, DEFAULT_HOME);
}
