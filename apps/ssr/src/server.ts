import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../../common/src/hash.js";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";
import {
  acquireProducerTriggerRequest,
  cleanupExpiredProducerTriggerRequests,
  getPublishedArticleBySlug,
  listPublishedArticles,
  markProducerTriggerRequestFailed,
  markProducerTriggerRequestSucceeded,
} from "../../common/src/repository.js";
import { produceArticle } from "../../producer/src/producer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildPageUrl(baseUrl: string, requestPath: string): string {
  return new URL(requestPath, baseUrl).toString();
}

function parseManualInput(body: unknown): {
  topic: string;
  city: string;
  keyword: string;
  language?: string;
} | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const payload = body as Record<string, unknown>;
  const topic = typeof payload.topic === "string" ? payload.topic.trim() : "";
  const city = typeof payload.city === "string" ? payload.city.trim() : "";
  const keyword = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
  const language = typeof payload.language === "string" ? payload.language.trim() : undefined;

  if (!topic || !city || !keyword) {
    return null;
  }

  return { topic, city, keyword, language };
}

function makeTriggerResponse(status: "accepted" | "deduplicated" | "failed", detail: string): {
  status: "accepted" | "deduplicated" | "failed";
  detail: string;
  at: string;
} {
  return {
    status,
    detail,
    at: new Date().toISOString(),
  };
}

export function createSsrApp(): express.Express {
  const env = getEnv();
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(expressLayouts);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../views"));
  app.set("layout", "layout");

  app.use(express.static(path.resolve(process.cwd(), env.STATIC_PUBLIC_DIR)));

  app.get("/", async (req, res) => {
    const pageParam = Number(req.query.page ?? "1");
    const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
    const pageSize = 10;
    const offset = (page - 1) * pageSize;

    const articles = await listPublishedArticles(pageSize + 1, offset);
    const hasNextPage = articles.length > pageSize;
    const pageItems = hasNextPage ? articles.slice(0, pageSize) : articles;

    res.render("index", {
      title: "US Cycle Topics",
      description: "Sustainable waste management and recycling solutions across the USA.",
      canonicalUrl: buildPageUrl(env.SITE_BASE_URL, req.originalUrl),
      articles: pageItems,
      page,
      hasNextPage,
      hasPrevPage: page > 1,
    });
  });

  app.get("/posts/:slug", async (req, res) => {
    const slug = String(req.params.slug);
    const article = await getPublishedArticleBySlug(slug);

    if (!article) {
      return res.status(404).render("404", {
        title: "404 Not Found",
        description: "The page you are looking for does not exist.",
        canonicalUrl: buildPageUrl(env.SITE_BASE_URL, req.originalUrl),
      });
    }

    return res.render("single", {
      title: article.title,
      description: article.description,
      canonicalUrl: buildPageUrl(env.SITE_BASE_URL, req.originalUrl),
      article,
    });
  });

  app.post("/api/producer/run", async (req, res) => {
    const authHeader = req.header("authorization");
    const expectedAuth = `Bearer ${env.PRODUCER_API_TOKEN}`;

    if (authHeader !== expectedAuth) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const idempotencyKey = req.header("x-idempotency-key");
    if (!idempotencyKey || idempotencyKey.trim() === "") {
      return res.status(400).json({ error: "missing x-idempotency-key" });
    }

    await cleanupExpiredProducerTriggerRequests(env.PRODUCER_REQUEST_IDEMPOTENCY_TTL_SECONDS);

    const manualInput = parseManualInput(req.body);
    if (!manualInput) {
      return res.status(400).json({
        error: "invalid payload: topic/city/keyword are required strings",
      });
    }

    const requestHash = sha256(JSON.stringify(manualInput));
    const acquired = await acquireProducerTriggerRequest(idempotencyKey, requestHash);
    if (!acquired.acquired) {
      const existingPayload = acquired.responseJson
        ? JSON.parse(acquired.responseJson)
        : makeTriggerResponse("deduplicated", "existing request in progress or completed");
      return res.status(200).json(existingPayload);
    }

    try {
      await produceArticle(manualInput);
      const responsePayload = makeTriggerResponse("accepted", "producer completed");
      await markProducerTriggerRequestSucceeded(
        idempotencyKey,
        JSON.stringify(responsePayload),
      );
      return res.status(200).json(responsePayload);
    } catch (error) {
      const responsePayload = makeTriggerResponse(
        "failed",
        error instanceof Error ? error.message : String(error),
      );
      await markProducerTriggerRequestFailed(
        idempotencyKey,
        JSON.stringify(responsePayload),
      );
      return res.status(500).json(responsePayload);
    }
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
