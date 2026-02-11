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
  listPublishedArticleSitemapEntries,
  listPublishedArticles,
  listPublishedArticlesByCategory,
  listPublishedArticlesByTag,
} from "../../common/src/repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface StaticPageSection {
  heading: string;
  paragraphs: string[];
}

interface StaticPageDefinition {
  path: string;
  title: string;
  description: string;
  heading: string;
  sections: StaticPageSection[];
}

const STATIC_PAGES: StaticPageDefinition[] = [
  {
    path: "/about",
    title: "About US Cycle Guides",
    description:
      "Learn how US Cycle Guides creates practical, city-specific recycling and waste-management content.",
    heading: "About US Cycle Guides",
    sections: [
      {
        heading: "Our Mission",
        paragraphs: [
          "US Cycle Guides publishes practical city-specific guides for recycling, hazardous waste handling, and local disposal workflows.",
          "Our goal is to reduce decision friction by giving readers clear next steps they can use immediately.",
        ],
      },
      {
        heading: "How Content Is Produced",
        paragraphs: [
          "Articles are produced through a structured pipeline with schema validation, quality scoring, and revision checks.",
          "We continuously improve editorial controls to raise originality, clarity, and local usefulness before monetization review.",
        ],
      },
      {
        heading: "Scope",
        paragraphs: [
          "Content on this site is informational and operational in nature. It is not legal, financial, or safety certification advice.",
        ],
      },
    ],
  },
  {
    path: "/contact",
    title: "Contact",
    description: "How to contact the US Cycle Guides site operator.",
    heading: "Contact",
    sections: [
      {
        heading: "Get in Touch",
        paragraphs: [
          "We welcome correction requests, content feedback, and policy inquiries.",
          "If you report an issue, include the page URL and what appears inaccurate so we can verify and update quickly.",
        ],
      },
    ],
  },
  {
    path: "/privacy",
    title: "Privacy Policy",
    description: "Privacy disclosures for analytics, advertising, and data handling on US Cycle Guides.",
    heading: "Privacy Policy",
    sections: [
      {
        heading: "Data and Logs",
        paragraphs: [
          "Like most websites, we may process technical request data such as IP address, user agent, and page access timestamps for security and operations.",
        ],
      },
      {
        heading: "Advertising and Analytics",
        paragraphs: [
          "This site may use Google services such as Analytics and AdSense. These services can use cookies or similar identifiers to measure usage and serve ads.",
          "Third parties may place and read cookies in your browser when ads are served on this site.",
        ],
      },
      {
        heading: "Your Choices",
        paragraphs: [
          "You can control cookies through browser settings and may review Google's data usage disclosures at https://www.google.com/policies/privacy/partners/.",
        ],
      },
    ],
  },
  {
    path: "/terms",
    title: "Terms of Use",
    description: "Terms governing use of US Cycle Guides.",
    heading: "Terms of Use",
    sections: [
      {
        heading: "Acceptance",
        paragraphs: ["By using this site, you agree to these terms and applicable laws."],
      },
      {
        heading: "Informational Use",
        paragraphs: [
          "Content is provided for general informational purposes. You are responsible for confirming local requirements with official sources before acting.",
        ],
      },
      {
        heading: "Updates",
        paragraphs: [
          "We may update site content and these terms at any time to improve accuracy, compliance, and user clarity.",
        ],
      },
    ],
  },
  {
    path: "/editorial-policy",
    title: "Editorial Policy",
    description: "Editorial standards, sourcing expectations, and correction workflow for US Cycle Guides.",
    heading: "Editorial Policy",
    sections: [
      {
        heading: "Editorial Standard",
        paragraphs: [
          "Each page should provide actionable, people-first guidance with clear structure and explicit verification steps.",
        ],
      },
      {
        heading: "Source and Verification",
        paragraphs: [
          "We prioritize verifiable references and call out points that readers should confirm locally when conditions change.",
        ],
      },
      {
        heading: "AI Assistance Disclosure",
        paragraphs: [
          "We use AI-assisted drafting in our production workflow and enforce schema and quality checks. We continuously improve human review coverage for monetized inventory.",
        ],
      },
      {
        heading: "Corrections",
        paragraphs: [
          "If a factual issue is identified, we revise the page and update publication metadata to reflect the correction cycle.",
        ],
      },
    ],
  },
];

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

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

function buildSitemapXml(
  baseUrl: string,
  articleEntries: Array<{ slug: string; lastmod: Date }>,
): string {
  const generatedAtIso = new Date().toISOString();
  const staticEntries = [
    { path: "/", changefreq: "daily", priority: "0.8", lastmod: generatedAtIso },
    { path: "/about", changefreq: "monthly", priority: "0.4", lastmod: generatedAtIso },
    { path: "/contact", changefreq: "monthly", priority: "0.4", lastmod: generatedAtIso },
    { path: "/privacy", changefreq: "monthly", priority: "0.3", lastmod: generatedAtIso },
    { path: "/terms", changefreq: "monthly", priority: "0.3", lastmod: generatedAtIso },
    {
      path: "/editorial-policy",
      changefreq: "monthly",
      priority: "0.4",
      lastmod: generatedAtIso,
    },
  ];

  const staticUrlBlocks = staticEntries.map((entry) => {
    const loc = escapeXml(buildPageUrl(baseUrl, entry.path));
    return [
      "  <url>",
      `    <loc>${loc}</loc>`,
      `    <lastmod>${entry.lastmod}</lastmod>`,
      `    <changefreq>${entry.changefreq}</changefreq>`,
      `    <priority>${entry.priority}</priority>`,
      "  </url>",
    ].join("\n");
  });

  const articleUrlBlocks = articleEntries.map((entry) => {
    const loc = escapeXml(buildPageUrl(baseUrl, `/posts/${encodeURIComponent(entry.slug)}`));
    const lastmod = escapeXml(entry.lastmod.toISOString());
    return [
      "  <url>",
      `    <loc>${loc}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      "    <changefreq>weekly</changefreq>",
      "    <priority>0.7</priority>",
      "  </url>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...staticUrlBlocks,
    ...articleUrlBlocks,
    "</urlset>",
    "",
  ].join("\n");
}

export function createSsrApp(): express.Express {
  const env = getEnv();
  const app = express();

  app.use(expressLayouts);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../views"));
  app.set("layout", "layout");

  app.locals.googleAnalyticsId = env.GOOGLE_ANALYTICS_ID ?? null;
  app.locals.googleAdsenseClientId = env.GOOGLE_ADSENSE_CLIENT_ID ?? null;
  app.locals.allowAdsense = false;
  app.locals.robotsDirective = null;

  app.use(express.static(path.resolve(process.cwd(), env.STATIC_PUBLIC_DIR)));

  app.get("/robots.txt", (_req, res) => {
    const body = [
      "User-agent: *",
      "Allow: /",
      "Disallow: /404",
      `Sitemap: ${buildPageUrl(env.SITE_BASE_URL, "/sitemap.xml")}`,
      "",
    ].join("\n");

    res.type("text/plain").send(body);
  });

  app.get("/sitemap.xml", async (_req, res) => {
    const batchSize = 500;
    let offset = 0;
    const entries: Array<{ slug: string; lastmod: Date }> = [];

    while (true) {
      const chunk = await listPublishedArticleSitemapEntries(batchSize, offset);
      if (chunk.length === 0) {
        break;
      }

      entries.push(...chunk);
      if (chunk.length < batchSize) {
        break;
      }

      offset += batchSize;
    }

    res.type("application/xml").send(buildSitemapXml(env.SITE_BASE_URL, entries));
  });

  for (const page of STATIC_PAGES) {
    app.get(page.path, async (req, res) => {
      const sidebarData = await getSidebarData();

      return res.render("static-page", {
        title: page.title,
        description: page.description,
        canonicalUrl: buildPageUrl(env.SITE_BASE_URL, req.originalUrl),
        page,
        siteContactEmail: env.SITE_CONTACT_EMAIL ?? null,
        allowAdsense: false,
        ...withSidebarDefaults(sidebarData),
      });
    });
  }

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
      allowAdsense: pageItems.length > 0,
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
        robotsDirective: "noindex, nofollow",
        allowAdsense: false,
        ...withSidebarDefaults(sidebarData),
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
      allowAdsense: true,
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
      allowAdsense: pageItems.length > 0,
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
      allowAdsense: pageItems.length > 0,
      ...withSidebarDefaults(sidebarData),
    });
  });

  app.use(async (req, res) => {
    const sidebarData = await getSidebarData();

    res.status(404).render("404", {
      title: "404 Not Found",
      description: "The page you are looking for does not exist.",
      canonicalUrl: buildPageUrl(env.SITE_BASE_URL, req.originalUrl),
      robotsDirective: "noindex, nofollow",
      allowAdsense: false,
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
