import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareProjectlessDirectory,
  readProjectlessDirectories,
} from "../src/thread-projects.mjs";

test("为每次新建分配独立可写目录，创建失败时报告错误", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "claudex-web-workspaces-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, "claudex-web", "workspaces");
  const directories = await Promise.all([
    prepareProjectlessDirectory(root),
    prepareProjectlessDirectory(root),
  ]);
  assert.notEqual(directories[0], directories[1]);
  for (const directory of directories) {
    assert.ok(directory.startsWith(root + "/chat-"));
    assert.ok((await stat(directory)).isDirectory());
    await writeFile(join(directory, "output.txt"), "fixture");
  }
  const blocked = join(home, "blocked");
  await writeFile(blocked, "fixture");
  await assert.rejects(
    prepareProjectlessDirectory(join(blocked, "workspaces")),
    { code: "ENOTDIR" },
  );
});

test("结合无项目标记和工作区记录识别自动目录，忽略外部目录与已有项目", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "claudex-web-projects-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = "/custom/documents/Codex";
  const directories = {
    desktop: root + "/2026-10-26/mu-q",
    assigned: root + "/2026-10-26/x",
    unmarked: root + "/2026-10-26/other",
    external: "/code/project",
    nested: root + "/2026-10-26/x/work/repo",
    "no-root": root + "/2026-10-26/missing",
    "invalid-output": root + "/2026-10-26/invalid",
  };
  const state = {
    "projectless-thread-ids": [
      "desktop",
      "assigned",
      "external",
      "nested",
      "no-root",
      "invalid-output",
      "cli",
    ],
    "thread-projectless-output-directories": Object.fromEntries(
      Object.entries(directories).map(([id, path]) => [id, path + "/outputs"]),
    ),
    "thread-workspace-root-hints": Object.fromEntries(
      Object.keys(directories)
        .filter((id) => id !== "no-root")
        .map((id) => [id, root]),
    ),
    "thread-project-assignments": {
      assigned: { projectId: "fixture-project" },
    },
  };
  state["thread-projectless-output-directories"]["invalid-output"] =
    directories["invalid-output"];
  await writeFile(
    join(home, ".codex-global-state.json"),
    JSON.stringify(state),
  );
  assert.deepEqual(await readProjectlessDirectories(home), {
    desktop: directories.desktop,
  });
  state["projectless-thread-ids"] = [];
  await writeFile(
    join(home, ".codex-global-state.json"),
    JSON.stringify(state),
  );
  assert.deepEqual(await readProjectlessDirectories(home), {});
});

test("桌面状态缺失、写入中或字段不完整时保留实际目录分组", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "claudex-web-projects-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  assert.deepEqual(await readProjectlessDirectories(home), {});
  for (const content of [
    "{",
    "null",
    "{}",
    '{"projectless-thread-ids":{}}',
    '{"projectless-thread-ids":["missing"]}',
  ]) {
    await writeFile(join(home, ".codex-global-state.json"), content);
    assert.deepEqual(await readProjectlessDirectories(home), {});
  }
});
