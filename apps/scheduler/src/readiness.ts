import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { normalizeError } from "../../common/src/errors.js";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";
import {
  getPublishedQualitySummary,
  samplePublishedForReadiness,
} from "../../common/src/repository.js";
import { createSsrApp } from "../../ssr/src/server.js";
import { runPreflight } from "./preflight.js";

type ReadinessStatus = "ok" | "warn" | "fail";

interface ReadinessCheck {
  name: string;
  status: ReadinessStatus;
  details: string;
}

const MIN_PUBLISHED_COUNT = 20;
const SAMPLE_SIZE = 50;

function render(check: ReadinessCheck): string {
  return `${check.status.toUpperCase().padEnd(4)} ${check.name} - ${check.details}`;
}

function summarizeTop<T>(items: T[], formatter: (item: T) => string, limit: number = 5): string {
  if (items.length === 0) {
    return "none";
  }
  return items.slice(0, limit).map(formatter).join("; ");
}

async function withTempSsrServer<T>(handler: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createSsrApp();
  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(0, () => resolve(instance));
    instance.on("error", reject);
  });

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;
    return await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function checkPreflightReadiness(): Promise<ReadinessCheck> {
  try {
    const preflight = await runPreflight();
    const ok = preflight.database === "ok" && preflight.staticAssets === "ok";
    return {
      name: "preflight",
      status: ok ? "ok" : "fail",
      details: `database=${preflight.database}, staticAssets=${preflight.staticAssets}`,
    };
  } catch (error) {
    return {
      name: "preflight",
      status: "fail",
      details: normalizeError(error),
    };
  }
}

async function checkPublishedVolume(): Promise<ReadinessCheck> {
  const summary = await getPublishedQualitySummary();

  if (summary.publishedCount < MIN_PUBLISHED_COUNT) {
    return {
      name: "published volume",
      status: "fail",
      details: `published=${String(summary.publishedCount)} < required ${String(MIN_PUBLISHED_COUNT)}`,
    };
  }

  return {
    name: "published volume",
    status: "ok",
    details: `published=${String(summary.publishedCount)}, avgScore=${summary.averageScore?.toFixed(2) ?? "n/a"}`,
  };
}

async function checkSourceLinksAndQuality(): Promise<ReadinessCheck> {
  const env = getEnv();
  const sample = await samplePublishedForReadiness(SAMPLE_SIZE);

  if (sample.length === 0) {
    return {
      name: "sample quality",
      status: "fail",
      details: "no published pages available for readiness sampling",
    };
  }

  const lowSource = sample.filter((row) => row.sourceLinksCount < env.QUALITY_MIN_SOURCE_LINKS);
  const lowScore = sample.filter((row) => (row.qualityScore ?? 0) < env.QUALITY_MIN_SCORE);
  const missingVerify = sample.filter((row) => !row.hasVerifySection);

  if (lowSource.length > 0 || lowScore.length > 0) {
    const sourcePreview = summarizeTop(lowSource, (row) => `${row.slug}(sources=${String(row.sourceLinksCount)})`);
    const scorePreview = summarizeTop(lowScore, (row) => `${row.slug}(score=${String(row.qualityScore ?? 0)})`);
    return {
      name: "sample quality",
      status: "fail",
      details: `lowSource=${String(lowSource.length)} [${sourcePreview}] | lowScore=${String(lowScore.length)} [${scorePreview}]`,
    };
  }

  if (missingVerify.length > 0) {
    const verifyPreview = summarizeTop(missingVerify, (row) => row.slug);
    return {
      name: "sample quality",
      status: "warn",
      details: `missingVerifySection=${String(missingVerify.length)} [${verifyPreview}]`,
    };
  }

  return {
    name: "sample quality",
    status: "ok",
    details: `checked=${String(sample.length)} pages, minSourceLinks=${String(env.QUALITY_MIN_SOURCE_LINKS)}, minScore=${String(env.QUALITY_MIN_SCORE)}`,
  };
}

async function checkTemplateDuplication(): Promise<ReadinessCheck> {
  const env = getEnv();
  const sample = await samplePublishedForReadiness(SAMPLE_SIZE);
  const signatureCounts = new Map<string, number>();

  for (const row of sample) {
    const signature = row.structureSignature;
    if (!signature) {
      continue;
    }
    signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1);
  }

  const overused = Array.from(signatureCounts.entries()).filter(
    ([, count]) => count > env.QUALITY_MAX_PUBLISHED_SAME_STRUCTURE,
  );

  if (overused.length > 0) {
    const preview = overused
      .slice(0, 5)
      .map(([, count], index) => `sig${String(index + 1)}=${String(count)}`)
      .join("; ");
    return {
      name: "template duplication",
      status: "fail",
      details: `overused signatures=${String(overused.length)} (threshold >${String(env.QUALITY_MAX_PUBLISHED_SAME_STRUCTURE)}): ${preview}`,
    };
  }

  return {
    name: "template duplication",
    status: "ok",
    details: `no structure signature appears >${String(env.QUALITY_MAX_PUBLISHED_SAME_STRUCTURE)} times in sample`,
  };
}

async function checkRouteSurface(): Promise<ReadinessCheck> {
  try {
    const endpointResults = await withTempSsrServer(async (baseUrl) => {
      const endpoints = [
        "/about",
        "/contact",
        "/privacy",
        "/terms",
        "/editorial-policy",
        "/robots.txt",
        "/sitemap.xml",
      ];

      const failures: string[] = [];

      for (const endpoint of endpoints) {
        const response = await fetch(`${baseUrl}${endpoint}`);
        if (!response.ok) {
          failures.push(`${endpoint}:${String(response.status)}`);
          continue;
        }

        if (endpoint === "/robots.txt") {
          const body = await response.text();
          if (!body.includes("Sitemap:")) {
            failures.push("/robots.txt:missing-sitemap");
          }
        }

        if (endpoint === "/sitemap.xml") {
          const body = await response.text();
          if (!body.includes("<urlset")) {
            failures.push("/sitemap.xml:invalid-xml");
          }
        }
      }

      return failures;
    });

    if (endpointResults.length > 0) {
      return {
        name: "route surface",
        status: "fail",
        details: endpointResults.join(", "),
      };
    }

    return {
      name: "route surface",
      status: "ok",
      details: "trust pages and crawl endpoints respond with expected payload",
    };
  } catch (error) {
    return {
      name: "route surface",
      status: "fail",
      details: normalizeError(error),
    };
  }
}

async function main(): Promise<void> {
  const checks: ReadinessCheck[] = [];

  checks.push(await checkPreflightReadiness());
  checks.push(await checkPublishedVolume());
  checks.push(await checkSourceLinksAndQuality());
  checks.push(await checkTemplateDuplication());
  checks.push(await checkRouteSurface());

  const failCount = checks.filter((item) => item.status === "fail").length;
  const warnCount = checks.filter((item) => item.status === "warn").length;

  logger.info("adsense readiness summary", {
    total: checks.length,
    failCount,
    warnCount,
  });

  for (const check of checks) {
    console.log(render(check));
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  logger.error("adsense readiness crashed", {
    message: normalizeError(error),
  });
  process.exitCode = 1;
});
