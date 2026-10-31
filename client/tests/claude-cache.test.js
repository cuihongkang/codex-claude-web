import test from "node:test";
import assert from "node:assert/strict";
import { readClaudeCache, writeClaudeCache } from "../src/claude-cache.js";
function storage() {
  let value;
  return {
    getItem: () => value,
    setItem: (_, v) => {
      value = v;
    },
  };
}
test("restores bounded messages and list without permission prompts", () => {
  const db = storage();
  writeClaudeCache(
    {
      selected: "demo",
      session: { id: "demo" },
      sessions: Array.from({ length: 100 }, (_, id) => ({ id })),
      messages: Array.from({ length: 400 }, (_, id) => ({
        id,
        text: "x".repeat(4000),
      })),
      permissions: [{ id: "must-not-restore" }],
    },
    db,
  );
  const value = readClaudeCache(db);
  assert.equal(value.selected, "demo");
  assert.equal(value.sessions.length, 80);
  assert(value.messages.length < 300);
  assert.equal(value.messages.at(-1).id, 399);
  assert.equal(value.permissions, undefined);
  assert(db.getItem().length <= 750000);
});
test("invalid, expired and unavailable storage fall back to live loading", () => {
  for (const value of [
    "bad",
    "null",
    JSON.stringify({ savedAt: 0, sessions: [], messages: [] }),
  ])
    assert.equal(readClaudeCache({ getItem: () => value }), null);
  const broken = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("full");
    },
  };
  assert.equal(readClaudeCache(broken), null);
  assert.doesNotThrow(() =>
    writeClaudeCache({ sessions: [], messages: [] }, broken),
  );
});

test("old snapshots without origin metadata are discarded, new classified snapshots restore", () => {
  const db = storage();
  db.setItem(
    "claude-history-v1",
    JSON.stringify({
      savedAt: Date.now(),
      selected: "demo",
      session: { id: "demo" },
      sessions: [],
      messages: [{ id: "summary", role: "user", content: [] }],
    }),
  );
  assert.equal(readClaudeCache(db), null);
  writeClaudeCache(
    {
      selected: "demo",
      session: { id: "demo" },
      sessions: [],
      messages: [{ id: "summary", role: "user", kind: "context", content: [] }],
    },
    db,
  );
  assert.equal(readClaudeCache(db).messages[0].kind, "context");
});
