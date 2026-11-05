import test from "node:test";
import assert from "node:assert/strict";
import {
  NotificationCenter,
  codexNotification,
} from "../src/notification-events.js";
const event = {
  provider: "claude",
  threadId: "thread",
  id: "turn",
  kind: "completed",
};
function fixture() {
  const data = new Map(),
    delivered = [];
  let hidden = true;
  const options = {
    storage: { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v) },
    hidden: () => hidden,
    deliver: (e) => delivered.push(e),
  };
  return {
    center: new NotificationCenter(options),
    options,
    delivered,
    data,
    visible: () => {
      hidden = false;
    },
  };
}
test("Codex notifications ignore snapshots, history, interruption and ordinary tool events", () => {
  for (const m of [
    { method: "lan/state", params: { threadId: "t" } },
    {
      method: "turn/completed",
      params: { threadId: "t", turn: { id: "x", status: "interrupted" } },
    },
    {
      method: "item/started",
      params: { threadId: "t", item: { id: "x", type: "commandExecution" } },
    },
  ])
    assert.equal(codexNotification(m), null);
  for (const status of ["completed", "failed"])
    assert.equal(
      codexNotification({
        method: "turn/completed",
        params: { threadId: "t", turn: { id: "x", status } },
      }).kind,
      status,
    );
  assert.equal(
    codexNotification({
      id: 1,
      method: "item/tool/requestUserInput",
      params: { threadId: "t" },
    }).kind,
    "attention",
  );
  const p = { threadId: "t", item: { id: "question", questions: [{}] } };
  assert.deepEqual(
    codexNotification({ method: "item/started", params: p }),
    codexNotification({ method: "item/completed", params: p }),
  );
});
test("explicit opt-in, background-only delivery, dedup across reloads and tabs", async () => {
  const f = fixture();
  f.center.receive(event);
  assert.equal(f.center.items.length, 0);
  f.center.enable(true);
  f.center.receive({ ...event, id: "new" });
  f.center.receive({ ...event, id: "new" });
  const other = new NotificationCenter(f.options);
  other.receive({ ...event, id: "new" });
  assert.equal(other.items.length, 0);
  f.visible();
  f.center.receive({ ...event, id: "visible" });
  await Promise.resolve();
  assert.equal(f.delivered.length, 1);
  assert.equal(f.center.items.length, 1);
  f.center.enable(false);
  assert.equal(f.center.items.length, 0);
});
test("blocked native notifications and unavailable storage keep an actionable inbox", async () => {
  const center = new NotificationCenter({
    storage: undefined,
    hidden: () => true,
    deliver: () => {
      throw Error("denied");
    },
  });
  center.enable(true);
  center.receive(event);
  await new Promise((r) => setImmediate(r));
  assert.equal(center.items.length, 1);
  center.dismiss(center.items[0].key);
  assert.equal(center.items.length, 0);
});
