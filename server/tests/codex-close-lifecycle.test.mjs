import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createSubscriptions } from "../src/backends/codex/subscriptions.mjs";

function fixture(t) {
  const response = Promise.withResolvers();
  const controller = createSubscriptions({
    transport: {
      ready: true,
      pending: new Map(),
      call: () => response.promise,
    },
    compactions: { busy: () => false },
    activeTurns: new Map(),
    activeThreads: new Set(),
  });
  t.after(() => controller.reset());
  controller.subscriptions.set("thread", new Set());
  controller.releaseUnusedThreads();
  return { controller, response, released: controller.releasing.get("thread") };
}

test("取消订阅响应和原生关闭都确认后才结束释放，关闭可以先于响应到达", async (t) => {
  for (const closedFirst of [false, true]) {
    const { controller, response, released } = fixture(t);
    let settled = false;
    released.then(() => {
      settled = true;
    });
    if (closedFirst) controller.threadClosed("thread");
    else response.resolve({ status: "unsubscribed" });
    await setImmediate();
    assert.equal(settled, false);
    assert.equal(controller.releasing.has("thread"), true);
    if (closedFirst) response.resolve({ status: "unsubscribed" });
    else controller.threadClosed("thread");
    assert.deepEqual(await released, { status: "unsubscribed" });
    assert.equal(controller.releasing.has("thread"), false);
    assert.equal(controller.subscriptions.has("thread"), false);
  }
});

for (const status of ["notSubscribed", "notLoaded"]) {
  test(`原生返回 ${status} 时直接结束本连接的释放`, async (t) => {
    const { controller, response, released } = fixture(t);
    response.resolve({ status });
    assert.deepEqual(await released, { status });
    assert.equal(controller.releasing.has("thread"), false);
  });
}

test("断线使等待原生关闭的请求失败并清理释放状态", async (t) => {
  const { controller, response, released } = fixture(t);
  response.resolve({ status: "unsubscribed" });
  const failed = assert.rejects(released, /Codex 后端连接已关闭/);
  controller.reset();
  await failed;
  assert.equal(controller.releasing.size, 0);
  assert.equal(controller.subscriptions.size, 0);
});
