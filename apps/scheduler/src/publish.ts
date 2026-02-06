import { spawn } from "node:child_process";
import { getEnv } from "../../common/src/env.js";

function parseArgs(raw: string): string[] {
  return raw
    .split(" ")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export interface PublishResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export async function publishWithRsync(): Promise<PublishResult> {
  const env = getEnv();
  if (env.PUBLISH_METHOD !== "rsync") {
    return { success: true, stdout: "publish skipped", stderr: "", exitCode: 0 };
  }

  if (!env.RSYNC_TARGET) {
    return {
      success: false,
      stdout: "",
      stderr: "RSYNC_TARGET is required when PUBLISH_METHOD=rsync",
      exitCode: null,
    };
  }

  const args = [
    ...(env.RSYNC_DRY_RUN ? ["--dry-run"] : []),
    ...parseArgs(env.RSYNC_FLAGS),
    `${env.HUGO_PUBLIC_DIR}/`,
    env.RSYNC_TARGET,
  ];

  return new Promise((resolve) => {
    const child = spawn("rsync", args, {
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
