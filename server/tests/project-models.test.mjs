import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectModels } from "../src/project-models.mjs";

test("项目设置写入磁盘，重新创建存储后恢复，连续写入保留各项目和最新选择", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "claudex-web-models-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createProjectModels(directory);
  assert.deepEqual(await store.read(), {});
  await Promise.all([
    store.set({ cwd: "/demo/a", model: "model-a", effort: "high" }),
    store.set({ cwd: "/demo/b", model: "model-b", effort: "medium" }),
    store.set({ cwd: "/demo/a", model: "model-c", effort: "xhigh" }),
    store.set({ cwd: "", model: "model-a", effort: "low" }),
  ]);
  const persisted = JSON.parse(
    await readFile(join(directory, "project-models.json"), "utf8"),
  );
  assert.deepEqual(persisted, {
    "/demo/a": { model: "model-c", effort: "xhigh" },
    "/demo/b": { model: "model-b", effort: "medium" },
    "": { model: "model-a", effort: "low" },
  });
  assert.deepEqual(await createProjectModels(directory).read(), persisted);
  await store.set({
    cwd: "/demo/a",
    model: "old-browser",
    effort: "low",
    ifAbsent: true,
  });
  assert.deepEqual(
    await store.read(),
    persisted,
    "旧浏览器迁移保留已有服务端设置",
  );
});

test("输入及磁盘损坏保留原文件，写入失败后支持重试", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "claudex-web-models-error-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createProjectModels(directory);
  await assert.rejects(
    store.set({ cwd: "relative", model: "m", effort: "high" }),
    /无效/,
  );
  await store.set({ cwd: "/demo/a", model: "m", effort: "high" });
  const path = join(directory, "project-models.json");
  await writeFile(path, "broken-json");
  await assert.rejects(
    store.set({ cwd: "/demo/b", model: "m", effort: "low" }),
  );
  assert.equal(await readFile(path, "utf8"), "broken-json");
  await writeFile(path, "{}");
  await store.set({ cwd: "/demo/b", model: "m", effort: "low" });
  assert.deepEqual(await store.read(), {
    "/demo/b": { model: "m", effort: "low" },
  });
});

test("网页目录迁移读取旧项目选择，首次修改保存完整偏好且保留旧文件", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "project-model-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = {
    "/demo/a": { model: "gpt", effort: "high" },
    "": { model: "gpt", effort: "low" },
  };
  const path = join(root, "project-models.json");
  await writeFile(path, JSON.stringify(legacy));
  const target = join(root, "new-web");
  const store = createProjectModels(target, root);
  assert.deepEqual(await store.read(), legacy);
  await store.set({ cwd: "/demo/b", model: "gpt-b", effort: "medium" });
  assert.deepEqual(await createProjectModels(target).read(), {
    ...legacy,
    "/demo/b": { model: "gpt-b", effort: "medium" },
  });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), legacy);
  await writeFile(join(target, "project-models.json"), "{}");
  assert.deepEqual(await store.read(), {});
});
