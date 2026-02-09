import { access, constants } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
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

async function checkCommand(name: string, command: string, args: string[]): Promise<DoctorCheck> {
  try {
    const output = await runCommand(command, args);
    return { name, status: "ok", details: output.split("\n")[0] ?? "ok" };
  } catch (error) {
    return { name, status: "fail", details: normalizeError(error) };
  }
}

async function checkStaticAssets(): Promise<DoctorCheck> {
  const env = getEnv();
  const publicDir = path.resolve(process.cwd(), env.STATIC_PUBLIC_DIR);

  try {
    await access(publicDir, constants.R_OK);
    await access(path.join(publicDir, "css", "style.css"), constants.R_OK);
    await access(path.join(publicDir, "js", "menu.js"), constants.R_OK);
    return {
      name: "static assets",
      status: "ok",
      details: `${publicDir} with css/style.css and js/menu.js`,
    };
  } catch (error) {
    return {
      name: "static assets",
      status: "fail",
      details: normalizeError(error),
    };
  }
}

async function checkPreflight(): Promise<DoctorCheck> {
  try {
    const report = await runPreflight();
    return {
      name: "preflight",
      status: "ok",
      details: `database=${report.database}, staticAssets=${report.staticAssets}`,
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
  const checks: DoctorCheck[] = [];

  checks.push({
    name: "env",
    status: "ok",
    details: `cron=${env.SCHEDULER_CRON}`,
  });

  checks.push(await checkCommand("node", "node", ["-v"]));
  checks.push(await checkStaticAssets());
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
