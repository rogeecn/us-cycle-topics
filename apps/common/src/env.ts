import "dotenv/config";
import { z } from "zod";

function booleanFlag(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
      }
      if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
      }
    }

    return value;
  }, z.boolean());
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  GENKIT_MODEL: z.string().default("googleai/gemini-2.5-flash"),
  GENKIT_BASEURL: z.preprocess(
    (value) => {
      if (typeof value === "string" && value.trim() === "") {
        return undefined;
      }
      return value;
    },
    z.string().url().optional(),
  ),
  GENKIT_PROMPT_VERSION: z.string().default("v1"),
  PRODUCER_AUTO_INPUT_PROMPT_NAME: z.string().default("seo-auto-input"),
  PRODUCER_OUTLINE_PROMPT_NAME: z.string().default("seo-outline"),
  PRODUCER_PROMPT_NAME: z.string().default("seo-article"),
  QUALITY_MIN_SCORE: z.coerce.number().min(0).max(100).default(70),
  NEEDS_REVIEW_ALERT_THRESHOLD: z.coerce.number().int().min(1).default(20),
  HUGO_CONTENT_DIR: z.string().default("./hugo-site/content/posts"),
  HUGO_COMMAND: z.string().default("hugo"),
  HUGO_BUILD_ARGS: z.string().default("--minify"),
  HUGO_WORKDIR: z.string().default("./hugo-site"),
  HUGO_PUBLIC_DIR: z.string().default("./hugo-site/public"),
  PUBLISH_METHOD: z.enum(["rsync", "none"]).default("rsync"),
  RSYNC_TARGET: z.string().optional(),
  RSYNC_FLAGS: z.string().default("-az --delete"),
  RSYNC_DRY_RUN: booleanFlag(true),
  SCHEDULER_CRON: z.string().default("0 * * * *"),
  PREFLIGHT_ON_RUN: booleanFlag(true),
  PREFLIGHT_ENSURE_HUGO_SCAFFOLD: booleanFlag(true),
  ALERT_WEBHOOK_URL: z.string().optional(),
  ALERT_DAILY_HOUR_LOCAL: z.coerce.number().int().min(0).max(23).default(9),
  ALERT_TIMEZONE: z.string().default("Asia/Shanghai"),
  RENDER_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(2000),
  MAX_RENDER_LOCK_SECONDS: z.coerce.number().int().positive().default(1200),
  PG_BOOTSTRAP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),
  PG_BOOTSTRAP_BACKOFF_MS: z.coerce.number().int().positive().default(2000),
  NODE_ENV: z.string().default("development"),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ")}`,
    );
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
