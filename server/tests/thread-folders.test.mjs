import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createThreadFolders } from "../src/thread-folders.mjs";

test("项目迁移原子保存、重开恢复、未分类保留目录及后端隔离", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "thread-folders-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "中文目录");
  await mkdir(folder);
  const folders = createThreadFolders(root);
  await folders.read();
  const thread = { id: "same", cwd: root, createdAt: 1 };
  const claude = { ...thread, id: "backend:claude:same" };
  await Promise.all([folders.move(thread, folder), folders.move(claude, "")]);
  assert.equal(folders.project(thread).folderPath, folder);
  assert.equal(folders.project(claude).folderPath, "");
  assert.equal(folders.project(thread).createdAt, 1);
  await folders.move(thread, "");
  assert.equal(folders.project(thread).cwd, folder);
  assert.equal(
    folders.params("turn/steer", { threadId: thread.id }).cwd,
    undefined,
  );
  assert.equal(
    folders.params("turn/start", { threadId: thread.id }).cwd,
    folder,
  );
  const restored = createThreadFolders(root);
  await restored.read();
  assert.deepEqual(restored.project(thread), folders.project(thread));
  const before = folders.project(thread);
  await assert.rejects(folders.move(thread, join(root, "missing")));
  await mkdir(join(root, "thread-folders.json.blocked"));
  await rm(join(root, "thread-folders.json"));
  await mkdir(join(root, "thread-folders.json"));
  await assert.rejects(folders.move(thread, folder));
  assert.deepEqual(folders.project(thread), before);
  assert.throws(() => folders.move(thread, "relative"));
});
