import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";

const executable = process.env.CLAUDE_EXECUTABLE || "claude";
const cliVersion = execFileSync(executable, ["--version"], {
  encoding: "utf8",
}).trim();
const directory = join(process.cwd(), ".cache", "backend-acceptance");
await mkdir(directory, { recursive: true });
const scripts = [
  "claude-session-history.mjs",
  "claude-message-provenance.mjs",
  "claude-native-fork-boundary.mjs",
  "claude-native-checkpoints.mjs",
  "claude-native-subagents.mjs",
  "claude-native-goal-status.mjs",
  "claude-native-goals.mjs",
  "claude-catalogue.mjs",
  "claude-native-configuration.mjs",
  "claude-project-instructions.mjs",
  "claude-sdk.mjs",
  "claude-thinking.mjs",
  "claude-runtime-lifecycle.mjs",
  "claude-runtime-restart.mjs",
  "claude-worker-upgrade.mjs",
  "claude-worker-environment.mjs",
];
const results = [];
for (const script of scripts) {
  const started = Date.now();
  const log = createWriteStream(join(directory, script + ".log"));
  const child = spawn(
    process.execPath,
    [join("tests", "integration", script)],
    {
      env: { ...process.env, CLAUDE_EXECUTABLE: executable },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (bytes) => {
      log.write(bytes);
      process.stdout.write(bytes);
    });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  await new Promise((resolve) => log.end(resolve));
  results.push({ script, passed: code === 0, elapsedMs: Date.now() - started });
  await writeFile(
    join(directory, "results.json"),
    JSON.stringify(
      { cliVersion, nodeVersion: process.version, results },
      null,
      2,
    ) + "\n",
  );
  if (code !== 0) process.exit(code || 1);
}
console.log(
  JSON.stringify({ cliVersion, passed: results.length, artifacts: directory }),
);
