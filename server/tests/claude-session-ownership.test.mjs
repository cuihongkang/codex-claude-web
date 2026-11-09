import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { claimClaudeSession } from "../src/claude-session-ownership.mjs";

test("SDK 与插件工作区跨进程互斥，释放后可以交接且旧释放不影响新所有者", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "claude-owner-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const release = claimClaudeSession(home, "session-a");
  const module = new URL("../src/claude-session-ownership.mjs", import.meta.url)
    .href;
  const run = () =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { claimClaudeSession } from ${JSON.stringify(module)}; claimClaudeSession(${JSON.stringify(home)}, "session-a")();`,
      ],
      { encoding: "utf8" },
    );
  assert.notEqual(run().status, 0);
  const independent = claimClaudeSession(home, "session-b");
  independent();
  release();
  assert.equal(run().status, 0);
  const next = claimClaudeSession(home, "session-a");
  release();
  assert.throws(() => claimClaudeSession(home, "session-a"), /另一个网页入口/);
  next();
});

test("失效 PID 的占用可恢复，未写完的占用与路径穿越保持拒绝", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "claude-owner-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  claimClaudeSession(home, "session-a")();
  const file = join(home, "web-session-owners/session-a.json");
  await writeFile(file, JSON.stringify({ pid: 2147483647, start: "old" }));
  claimClaudeSession(home, "session-a")();
  await writeFile(file, "");
  assert.throws(() => claimClaudeSession(home, "session-a"), /另一个网页入口/);
  assert.throws(() => claimClaudeSession(home, "../escape"), /无效/);
});
