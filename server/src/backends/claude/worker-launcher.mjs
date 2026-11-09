import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile, unlink } from "node:fs/promises";

import { workerLocation, prepareWorkerDirectory } from "./worker-location.mjs";
export { workerLocation } from "./worker-location.mjs";
const execute = promisify(execFile);
export async function launchWorker(backend, desired) {
  const { socket, unit, directory } = workerLocation(backend);
  await prepareWorkerDirectory(directory);
  await mkdir(backend.stateDir, { recursive: true, mode: 0o700 });
  let entry = fileURLToPath(new URL("./worker-server.mjs", import.meta.url));
  let runtimeEnv = desired?.runtimeEnv || {};
  try {
    const saved = JSON.parse(
      await readFile(join(backend.stateDir, "worker-options.json"), "utf8"),
    );
    if (
      saved.preferredEntry &&
      (!desired || saved.generation >= desired.generation)
    ) {
      entry = saved.preferredEntry;
      runtimeEnv = saved.runtimeEnv || {};
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const envPath = join(backend.stateDir, `worker-environment-${randomUUID()}`);
  const args = [entry, socket, backend.stateDir, envPath];
  const quote = (value) =>
    '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  const environment = { ...runtimeEnv, PATH: process.env.PATH };
  await writeFile(
    envPath,
    Object.entries(environment)
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join("\n") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  let userManager = false;
  try {
    await execute("systemctl", ["--user", "show-environment"], {
      timeout: 5000,
    });
    userManager = true;
  } catch (error) {
    if (process.env.INVOCATION_ID) {
      await unlink(envPath);
      throw new Error(`无法启动独立 Claude 后端服务：${error.message}`);
    }
  }
  if (userManager) {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        await execute(
          "systemd-run",
          [
            "--user",
            "--quiet",
            `--unit=${unit}`,
            "--collect",
            "--property=Type=exec",
            "--property=Restart=on-failure",
            "--property=RestartSec=2",
            `--property=EnvironmentFile=${envPath.replace(/%/g, "%%")}`,
            process.execPath,
            ...args,
          ],
          { timeout: 10000 },
        );
        return;
      } catch (error) {
        const { stdout } = await execute(
          "systemctl",
          ["--user", "show", unit, "--property=ActiveState", "--value"],
          { timeout: 5000 },
        );
        if (["active", "activating"].includes(stdout.trim())) {
          const current = await execute(
            "systemctl",
            ["--user", "show", unit, "--property=EnvironmentFiles", "--value"],
            { timeout: 5000 },
          );
          if (!current.stdout.includes(envPath)) await unlink(envPath);
          return;
        }
        if (
          !["deactivating", "inactive", "failed", ""].includes(stdout.trim()) ||
          attempt === 49
        ) {
          await unlink(envPath);
          throw error;
        }
        await delay(100);
      }
    }
    return;
  }
  await mkdir(backend.stateDir, { recursive: true, mode: 0o700 });
  const log = await open(join(backend.stateDir, "worker.log"), "a", 0o600);
  try {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: { ...process.env, ...runtimeEnv },
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
  } finally {
    await log.close();
  }
}
