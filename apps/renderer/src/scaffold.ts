import { access, constants, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "../../common/src/env.js";

const DEFAULT_CONFIG = `baseURL = "https://example.com/"
languageCode = "en-us"
title = "LocalProof Guides"
theme = "mainroad"

[taxonomies]
  category = "categories"
  tag = "tags"

[Params.Author]
  name = "LocalProof Editorial Team"
  bio = "People-first local operations and recycling guidance. Verify locally before action."
  avatar = "img/avatar.png"

[Params]
  description = "People-first local operations and recycling guides with practical verification steps."
  opengraph = true
  schema = true
  twitter_cards = true
  readmore = true
  authorbox = true
  pager = true
  toc = true
  post_meta = ["date", "categories"]
  mainSections = ["posts", "post", "docs"]
  dateformat = "2006-01-02"

[Params.logo]
  title = "LocalProof Guides"
  subtitle = "Verify before you act"

[Params.sidebar]
  home = "right"
  list = "right"
  single = "right"
  widgets = ["search", "recent", "categories", "taglist"]

[Params.widgets]
  recent_num = 8
  categories_counter = true
  tags_counter = true

[markup]
  [markup.tableOfContents]
    startLevel = 2
    endLevel = 3
    ordered = false

[services.disqus]
  shortname = ""

[services.googleAnalytics]
  ID = ""
`;

const DEFAULT_HOME = `---
title: "Home"
---
`;

const DEFAULT_POSTS_INDEX = `---
title: "Posts"
description: "Latest practical local guides"
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

  const postsIndexPath = path.join(workdir, "content", "posts", "_index.md");
  await ensureFile(postsIndexPath, DEFAULT_POSTS_INDEX);

  const themePath = path.join(workdir, "themes", env.HUGO_THEME);
  try {
    await access(themePath, constants.F_OK);
  } catch {
    throw new Error(
      `Hugo theme '${env.HUGO_THEME}' not found at ${themePath}. Please install it first (for Mainroad: git clone https://github.com/Vimux/Mainroad themes/mainroad).`,
    );
  }
}
