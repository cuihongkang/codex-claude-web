import { createBackendConfiguration } from "../server/src/backends/configuration.mjs";
import { spawn } from "node:child_process";
import { readConfig } from "../server/src/config.mjs";

const config = readConfig();
const { backends } = await createBackendConfiguration(config).read();
const backend = backends.find((b) => b.id === "codex" && b.enabled);
if (!backend) throw new Error("Codex 后端未启用");
const child = spawn(
  backend.executable || "codex",
  [
    ...(backend.args || []),
    "-c",
    "thread_unload_delay_secs=0",
    "app-server",
    "--listen",
    backend.url,
  ],
  { stdio: "inherit", env: { ...process.env, CODEX_HOME: backend.dataDir } },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
