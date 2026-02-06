import { access, constants } from "node:fs/promises";
import { scaffoldHugoSite } from "../../renderer/src/scaffold.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { getEnv } from "../../common/src/env.js";
import { normalizeError } from "../../common/src/errors.js";
import { logger } from "../../common/src/logger.js";
import { runPreflight } from "./preflight.js";

type CheckStatus = "ok" | "warn" | "fail";

interface DoctorCheck {
  name: string;
  status: CheckStatus;
  details: string;
}

function render(check: DoctorCheck): string {
  return `${check.status.toUpperCase().padEnd(4)} ${check.name} - ${check.details}`;
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim() || stderr.trim() || "ok");
        return;
      }
      reject(new Error(`${command} exited with ${String(code)}: ${stderr.trim()}`));
    });

    child.on("error", (error) => {
      reject(new Error(`${command} failed: ${normalizeError(error)}`));
    });
  });
}

async function checkPathWritable(name: string, target: string): Promise<DoctorCheck> {
  try {
    await access(target, constants.W_OK);
    return { name, status: "ok", details: `${target} writable` };
  } catch (error) {
    return { name, status: "fail", details: normalizeError(error) };
  }
}

async function checkCommand(name: string, command: string, args: string[]): Promise<DoctorCheck> {
  try {
    const output = await runCommand(command, args);
    return { name, status: "ok", details: output.split("\n")[0] ?? "ok" };
  } catch (error) {
    return { name, status: "fail", details: normalizeError(error) };
  }
}

async function checkRsyncConfigured(): Promise<DoctorCheck> {
  const env = getEnv();
  if (env.PUBLISH_METHOD !== "rsync") {
    return { name: "publish target", status: "warn", details: "PUBLISH_METHOD is not rsync" };
  }

  if (!env.RSYNC_TARGET) {
    return {
      name: "publish target",
      status: "fail",
      details: "RSYNC_TARGET is required when PUBLISH_METHOD=rsync",
    };
  }

  return {
    name: "publish target",
    status: "ok",
    details: `${env.RSYNC_TARGET}${env.RSYNC_DRY_RUN ? " (dry-run)" : ""}`,
  };
}

async function checkPreflight(): Promise<DoctorCheck> {
  try {
    const report = await runPreflight();
    return {
      name: "preflight",
      status: "ok",
      details: `database=${report.database}, hugo=${report.hugo}, rsync=${report.rsync}`,
    };
  } catch (error) {
    return {
      name: "preflight",
      status: "fail",
      details: normalizeError(error),
    };
  }
}

async function main(): Promise<void> {
  const env = getEnv();
  await scaffoldHugoSite();

  const checks: DoctorCheck[] = [];

  checks.push({
    name: "env",
    status: "ok",
    details: `cron=${env.SCHEDULER_CRON}, publish=${env.PUBLISH_METHOD}, dryRun=${String(env.RSYNC_DRY_RUN)}`,
  });

  checks.push(await checkCommand("node", "node", ["-v"]));
  checks.push(await checkCommand("hugo", env.HUGO_COMMAND, ["version"]));
  checks.push(await checkCommand("rsync", "rsync", ["--version"]));
  checks.push(await checkPathWritable("hugo workdir", path.resolve(process.cwd(), env.HUGO_WORKDIR)));
  checks.push(await checkPathWritable("hugo content", path.resolve(process.cwd(), env.HUGO_CONTENT_DIR)));
  checks.push(await checkPathWritable("hugo public", path.resolve(process.cwd(), env.HUGO_PUBLIC_DIR)));
  checks.push(await checkRsyncConfigured());
  checks.push(await checkPreflight());

  const failCount = checks.filter((item) => item.status === "fail").length;
  const warnCount = checks.filter((item) => item.status === "warn").length;

  logger.info("doctor summary", { total: checks.length, failCount, warnCount });
  for (const check of checks) {
    console.log(render(check));
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  logger.error("doctor crashed", { message: normalizeError(error) });
  process.exitCode = 1;
});
