import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";
import { renderMarkdownToSafeHtml, stripLeadingTitleHeading } from "./markdown.js";
import {
  getPublishedArticleBySlug,
  getSidebarData,
  listPublishedArticles,
  listPublishedArticlesByCategory,
  listPublishedArticlesByTag,
} from "../../common/src/repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildPageUrl(baseUrl: string, requestPath: string): string {
  return new URL(requestPath, baseUrl).toString();
}

function withSidebarDefaults(sidebarData: Awaited<ReturnType<typeof getSidebarData>>) {
  return {
    sidebarRecentPosts: sidebarData.recentPosts,
    sidebarCategories: sidebarData.categories,
    sidebarTags: sidebarData.tags,
  };
}

export function createSsrApp(): express.Express {
  const env = getEnv();
  const app = express();

  app.use(expressLayouts);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../views"));
  app.set("layout", "layout");

  app.locals.googleAnalyticsId = env.GOOGLE_ANALYTICS_ID ?? null;

  app.use(express.static(path.resolve(process.cwd(), env.STATIC_PUBLIC_DIR)));

  app.get("/", async (req, res) => {
    const pageParam = Number(req.query.page ?? "1");
    const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
    const pageSize = 10;
    const offset = (page - 1) * pageSize;

    const [articles, sidebarData] = await Promise.all([
      listPublishedArticles(pageSize + 1, offset),
      getSidebarData(),
    ]);
    const hasNextPage = articles.length > pageSize;
    const pageItems = hasNextPage ? articles.slice(0, pageSize) : articles;

    res.render("index", {
      title: "US Cycle Guides",
      description: "Sustainable waste management and recycling solutions across the USA.",
      canonicalUrl: buildPageUrl(env.SITE_BASE_URL, req.originalUrl),
      articles: pageItems,
      page,
      hasNextPage,
      hasPrevPage: page > 1,
      ...withSidebarDefaults(sidebarData),
    });
  });

  app.get("/posts/:slug", async (req, res) => {
    const slug = String(req.params.slug);
    const [article, sidebarData] = await Promise.all([
      getPublishedArticleBySlug(slug),
      getSidebarData(),
    ]);

    if (!article) {
      return res.status(404).render("404", {
        title: "404 Not Found",
        description: "The page you are looking for does not exist.",
        canonicalUrl: buildPageUrl(env.SITE_BASE_URL, req.originalUrl),
      });
    }

    const articleMarkdown = stripLeadingTitleHeading(article.content, article.title);
    const articleHtml = renderMarkdownToSafeHtml(articleMarkdown);

    return res.render("single", {
      title: article.title,
      description: article.description,
      canonicalUrl: buildPageUrl(env.SITE_BASE_URL, req.originalUrl),
      article,
      articleHtml,
      ...withSidebarDefaults(sidebarData),
    });
  });

  app.get("/categories/:name", async (req, res) => {
    const categoryName = decodeURIComponent(String(req.params.name));
    const pageParam = Number(req.query.page ?? "1");
    const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
    const pageSize = 10;
    const offset = (page - 1) * pageSize;

    const [articles, sidebarData] = await Promise.all([
      listPublishedArticlesByCategory(categoryName, pageSize + 1, offset),
      getSidebarData(),
    ]);

    const hasNextPage = articles.length > pageSize;
    const pageItems = hasNextPage ? articles.slice(0, pageSize) : articles;

    return res.render("index", {
      title: `Category: ${categoryName}`,
      description: `Articles in category ${categoryName}`,
      canonicalUrl: buildPageUrl(env.SITE_BASE_URL, req.originalUrl),
      articles: pageItems,
      page,
      hasNextPage,
      hasPrevPage: page > 1,
      ...withSidebarDefaults(sidebarData),
    });
  });

  app.get("/tags/:name", async (req, res) => {
    const tagName = decodeURIComponent(String(req.params.name));
    const pageParam = Number(req.query.page ?? "1");
    const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
    const pageSize = 10;
    const offset = (page - 1) * pageSize;

    const [articles, sidebarData] = await Promise.all([
      listPublishedArticlesByTag(tagName, pageSize + 1, offset),
      getSidebarData(),
    ]);

    const hasNextPage = articles.length > pageSize;
    const pageItems = hasNextPage ? articles.slice(0, pageSize) : articles;

    return res.render("index", {
      title: `Tag: ${tagName}`,
      description: `Articles tagged with ${tagName}`,
      canonicalUrl: buildPageUrl(env.SITE_BASE_URL, req.originalUrl),
      articles: pageItems,
      page,
      hasNextPage,
      hasPrevPage: page > 1,
      ...withSidebarDefaults(sidebarData),
    });
  });

  return app;
}

export async function startSsrServer(): Promise<void> {
  const app = createSsrApp();
  const port = Number(process.env.PORT ?? 3000);

  app.listen(port, () => {
    logger.info("SSR Server started", { port });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startSsrServer().catch((error) => {
    logger.error("SSR Server failed to start", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
