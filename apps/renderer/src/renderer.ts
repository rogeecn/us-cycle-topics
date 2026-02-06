import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";
import {
  claimArticlesForRender,
  markArticleFailed,
  markBuildSuccess,
} from "../../common/src/repository.js";
import { RenderMode, RenderedResult } from "../../common/src/types.js";
import { runHugoBuild } from "./hugo.js";
import { cleanDirectory, writeMarkdown } from "./writer.js";

export async function renderFromDb(mode: RenderMode): Promise<RenderedResult> {
  const env = getEnv();
  const articles = await claimArticlesForRender(mode, env.RENDER_BATCH_SIZE);

  if (articles.length === 0) {
    return { renderedIds: [], writtenFiles: [], skippedFiles: [] };
  }

  if (mode === "full") {
    await cleanDirectory();
  }

  const renderedIds: number[] = [];
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const article of articles) {
    try {
      const result = await writeMarkdown(article);
      renderedIds.push(article.id);
      if (result.changed) {
        writtenFiles.push(result.filePath);
      } else {
        skippedFiles.push(result.filePath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markArticleFailed(article.id, `render failed: ${message}`);
      logger.error("render failed", { id: article.id, slug: article.slug, message });
    }
  }

  if (renderedIds.length === 0) {
    return { renderedIds, writtenFiles, skippedFiles };
  }

  const build = await runHugoBuild();
  if (!build.success) {
    for (const id of renderedIds) {
      await markArticleFailed(id, `hugo build failed: ${build.stderr || "unknown error"}`);
    }
    throw new Error(`hugo build failed: ${build.stderr || build.stdout}`);
  }

  await markBuildSuccess(renderedIds);

  logger.info("render completed", {
    mode,
    claimed: articles.length,
    rendered: renderedIds.length,
    written: writtenFiles.length,
    skipped: skippedFiles.length,
  });

  return { renderedIds, writtenFiles, skippedFiles };
}
