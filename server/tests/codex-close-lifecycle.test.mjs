import test from "node:test";
import assert from "node:assert/strict";
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

for (const status of ["unsubscribed", "notSubscribed", "notLoaded"]) {
  test(`原生确认 ${status} 后释放本连接，无需等待其他订阅者关闭`, async (t) => {
    const { controller, response, released } = fixture(t);
    response.resolve({ status });
    assert.deepEqual(await released, { status });
    assert.equal(controller.releasing.has("thread"), false);
    assert.equal(controller.subscriptions.has("thread"), false);
  });
}
