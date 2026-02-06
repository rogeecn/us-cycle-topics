import { spawn } from "node:child_process";
import { getEnv } from "../../common/src/env.js";

export interface HugoBuildResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function parseArgs(raw: string): string[] {
  return raw
    .split(" ")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export async function runHugoBuild(): Promise<HugoBuildResult> {
  const env = getEnv();
  const args = ["build", ...parseArgs(env.HUGO_BUILD_ARGS)];

  return new Promise((resolve) => {
    const child = spawn(env.HUGO_COMMAND, args, {
      cwd: env.HUGO_WORKDIR,
      stdio: ["ignore", "pipe", "pipe"],
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
      resolve({
        success: code === 0,
        stdout,
        stderr,
        exitCode: code,
      });
    });

    child.on("error", (error) => {
      resolve({
        success: false,
        stdout,
        stderr: `${stderr}\n${error.message}`,
        exitCode: null,
      });
    });
  });
}
