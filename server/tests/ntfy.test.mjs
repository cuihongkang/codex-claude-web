import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNtfy } from "../src/ntfy.mjs";
const event = {
  provider: "claude",
  threadId: "fixture",
  id: "turn-1",
  kind: "completed",
  title: "private user prompt",
};
async function fixture(t, fetchImpl) {
  const dir = await mkdtemp(join(tmpdir(), "ntfy-test-"));
  const options = {
    url: "https://ntfy.sh/test-topic",
    webUrl: "http://192.0.2.1:8766",
    stateFile: join(dir, "state.json"),
    fetchImpl,
    onError: () => {},
    retryMs: 60000,
  };
  const center = createNtfy(options);
  t.after(async () => {
    await center.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { center, options };
}
const settle = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("timeout");
};
test("ntfy sends without a browser, deduplicates and omits conversation content", async (t) => {
  const sent = [];
  const { center, options } = await fixture(t, async (url, req) => {
    sent.push({ url, body: JSON.parse(req.body) });
    return { ok: true };
  });
  await center.publish(event);
  await center.publish(event);
  await settle(() => sent.length === 1);
  assert.equal(sent[0].body.topic, "test-topic");
  assert.equal(
    new URL(sent[0].body.click).searchParams.get("notifyThread"),
    "fixture",
  );
  assert.equal(JSON.stringify(sent).includes(event.title), false);
  await settle(
    async () =>
      JSON.parse(await readFile(options.stateFile)).pending.length === 0,
  );
  await center.close();
  const restored = createNtfy(options);
  t.after(() => restored.close());
  await restored.publish(event);
  await restored.flush();
  assert.equal(sent.length, 1);
});
test("failed deliveries survive restart and retry for both backends", async (t) => {
  let ok = false,
    count = 0;
  const { center, options } = await fixture(t, async () => {
    count++;
    return { ok };
  });
  await center.publish({ ...event, provider: "codex", kind: "attention" });
  await settle(() => count === 1);
  await center.close();
  ok = true;
  const restored = createNtfy(options);
  t.after(() => restored.close());
  await settle(() => count === 2);
  await settle(
    async () =>
      JSON.parse(await readFile(options.stateFile)).pending.length === 0,
  );
});
test("disabled sender ignores events and rejects invalid endpoints", async () => {
  const center = createNtfy({
    url: "",
    fetchImpl: () => {
      throw Error("must not send");
    },
  });
  await center.publish(event);
  await center.close();
  assert.throws(() => createNtfy({ url: "http://ntfy.sh/topic" }), /HTTPS/);
});
