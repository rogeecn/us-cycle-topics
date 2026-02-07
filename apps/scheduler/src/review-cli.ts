import {
  approveNeedsReview,
  appendAlertLog,
  getReviewStats,
  listNeedsReview,
  rejectNeedsReview,
} from "../../common/src/repository.js";
import { logger } from "../../common/src/logger.js";

function getArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function getCommand(): string {
  const command = process.argv[2];
  if (!command) {
    throw new Error("missing command: list | stats | approve | reject");
  }
  return command;
}

async function listCommand(): Promise<void> {
  const limit = Number(getArg("limit") ?? "20");
  const rows = await listNeedsReview(limit);

  logger.info("needs_review queue", { count: rows.length, limit });
  for (const row of rows) {
    console.log(
      `${row.id}\t${row.slug}\tscore=${row.qualityReport.scoreTotal}\treason=${row.reviewReason ?? "-"}\tupdated=${row.updatedAt.toISOString()}`,
    );
  }
}

async function statsCommand(): Promise<void> {
  const stats = await getReviewStats();
  logger.info("review stats", {
    total: stats.total,
    draft: stats.draft,
    generated: stats.generated,
    needsReview: stats.needsReview,
    rendered: stats.rendered,
    built: stats.built,
    published: stats.published,
    failed: stats.failed,
    averageScoreAll: stats.averageScoreAll,
    averageScoreGenerated: stats.averageScoreGenerated,
    averageScoreNeedsReview: stats.averageScoreNeedsReview,
    averageScoreFailed: stats.averageScoreFailed,
    reviewedToday: stats.reviewedToday,
  });

  console.log(`total=${stats.total}`);
  console.log(`generated=${stats.generated} needs_review=${stats.needsReview} failed=${stats.failed}`);
  console.log(`rendered=${stats.rendered} built=${stats.built} published=${stats.published}`);
  console.log(
    `avg_all=${stats.averageScoreAll ?? "n/a"} avg_generated=${stats.averageScoreGenerated ?? "n/a"} avg_needs_review=${stats.averageScoreNeedsReview ?? "n/a"}`,
  );
  console.log(`reviewed_today=${stats.reviewedToday}`);
}

async function approveCommand(): Promise<void> {
  const id = Number(getArg("id"));
  const reviewer = getArg("reviewer") ?? "manual-reviewer";
  const notes = getArg("notes") ?? null;

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("approve requires --id <positive integer>");
  }

  const ok = await approveNeedsReview(id, reviewer, notes);
  if (!ok) {
    throw new Error(`approve failed for id=${id}. record not in needs_review`);
  }

  await appendAlertLog("review_action", `review-approve-${id}-${Date.now()}`, {
    id,
    action: "approve",
    reviewer,
    notes,
    reviewedAt: new Date().toISOString(),
  });

  logger.info("review approved", { id, reviewer });
}

async function rejectCommand(): Promise<void> {
  const id = Number(getArg("id"));
  const reviewer = getArg("reviewer") ?? "manual-reviewer";
  const notes = getArg("notes") ?? null;

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("reject requires --id <positive integer>");
  }

  const ok = await rejectNeedsReview(id, reviewer, notes);
  if (!ok) {
    throw new Error(`reject failed for id=${id}. record not in needs_review`);
  }

  await appendAlertLog("review_action", `review-reject-${id}-${Date.now()}`, {
    id,
    action: "reject",
    reviewer,
    notes,
    reviewedAt: new Date().toISOString(),
  });

  logger.info("review rejected", { id, reviewer });
}

async function main(): Promise<void> {
  const command = getCommand();

  if (command === "list") {
    await listCommand();
    return;
  }

  if (command === "stats") {
    await statsCommand();
    return;
  }

  if (command === "approve") {
    await approveCommand();
    return;
  }

  if (command === "reject") {
    await rejectCommand();
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  logger.error("review-cli failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
