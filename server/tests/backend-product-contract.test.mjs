import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { backendProductFixture } from "../../tests/helpers/backend-product-contract.mjs";
import { hasBackendWork } from "../../shared/backend-activity.mjs";

for (const backendId of ["codex", "claude"]) {
  test(
    `${backendId}：离线项目偏好、跨页面通知和目录创建遵循相同产品契约`,
    { timeout: 10000 },
    async (t) => {
      const f = await backendProductFixture(t, backendId);
      assert.deepEqual(await f.call("lan/projectModels/read"), {
        projects: f.existingProjects,
      });
      await assert.rejects(f.call("lan/projectless/prepare"));
      const preference = {
        cwd: join(f.root, "next"),
        model: "next-model",
        effort: "low",
      };
      const saved = await f.call("lan/projectModels/set", preference);
      assert.deepEqual(saved.projects, {
        ...f.existingProjects,
        [preference.cwd]: {
          model: preference.model,
          effort: preference.effort,
        },
      });
      assert.deepEqual(f.events.at(-1), {
        method: "lan/projectModels/updated",
        params: saved,
      });
      assert.deepEqual(
        JSON.parse(
          await readFile(
            join(f.projectDirectory, "project-models.json"),
            "utf8",
          ),
        ),
        saved.projects,
      );
      const count = f.events.length;
      await assert.rejects(
        f.call("lan/projectModels/set", { ...preference, model: "" }),
      );
      assert.equal(f.events.length, count);
      assert.deepEqual(await f.call("lan/projectModels/read"), saved);
      const blocked = join(f.projectDirectory, "project-models.json.tmp");
      await mkdir(blocked);
      await assert.rejects(
        f.call("lan/projectModels/set", { ...preference, effort: "high" }),
      );
      assert.equal(f.events.length, count);
      assert.deepEqual(await f.call("lan/projectModels/read"), saved);
      await rm(blocked, { recursive: true });
      await f.call("lan/projectModels/set", preference);
      await f.connect();
      const first = await f.call("lan/projectless/prepare");
      const second = await f.call("lan/projectless/prepare");
      assert.equal(first.root, f.config.projectlessRoot);
      assert.notEqual(first.cwd, second.cwd);
      assert.equal(
        f.requests.filter((r) => r.method?.startsWith("lan/")).length,
        0,
      );
      assert.equal(f.adapter.subscriptions, undefined);
      assert.equal(typeof f.adapter.releaseClient, "function");
    },
  );

  test(
    `${backendId}：整理占用阻止全部写入入口，保留设置和历史读取`,
    { timeout: 10000 },
    async (t) => {
      const f = await backendProductFixture(t, backendId);
      await f.connect();
      if (backendId === "codex")
        await f.call("thread/compact/start", { threadId: "thread" });
      for (const method of [
        "turn/start",
        "turn/steer",
        "review/start",
        "thread/revert",
        "thread/rollback",
        "thread/compact/start",
      ])
        await assert.rejects(
          f.call(method, { threadId: "thread", input: [] }),
          {
            message: "正在整理上下文，完成后可继续发送。",
          },
        );
      assert.equal(hasBackendWork(f.adapter.state().params), true);
      await f.call("thread/read", { threadId: "thread" });
      await f.call("lan/projectModels/read");
      if (backendId === "codex")
        assert.equal(
          f.requests.filter((r) => r.method === "turn/start").length,
          0,
        );
    },
  );
}

test("后端停止与升级统一核对每种活动，已结束记录允许空闲替换", () => {
  for (const snapshot of [
    { activeTurns: { thread: "turn" } },
    { backgroundTasks: { thread: [{ status: "unknown" }] } },
    { queuedInputs: { thread: 1 } },
    { internalCommands: ["thread"] },
    { questions: [{ id: "question" }] },
    ...["starting", "running", "reconnecting"].map((status) => ({
      compactions: { thread: { status } },
    })),
  ])
    assert.equal(hasBackendWork(snapshot), true, JSON.stringify(snapshot));
  assert.equal(hasBackendWork(), false);
  for (const status of ["completed", "interrupted", "failed", "unconfirmed"])
    assert.equal(
      hasBackendWork({ compactions: { thread: { status } } }),
      false,
    );
});
