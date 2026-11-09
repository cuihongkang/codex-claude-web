import test from "node:test";
import assert from "node:assert/strict";
import { createEvents } from "../src/application/events.js";
import { conversationGroups } from "../src/domain/conversation-groups.js";
import { reasoningSummaries } from "../src/domain/reasoning-summary.js";

test("首个思考增量立即归属轮次，完整正文可展开且其他对话增量隔离", () => {
  const state = { current: { id: "claude-thread" }, items: [] };
  const events = createEvents({
    get: () => state,
    messages: {
      put(item) {
        const index = state.items.findIndex((entry) => entry.id === item.id);
        if (index < 0) state.items.push(item);
        else state.items[index] = item;
      },
    },
  });
  const params = {
    threadId: "claude-thread",
    turnId: "turn",
    itemId: "thinking",
    summaryIndex: 0,
    summaryTitle: "思考",
    delta: "完整的单段",
  };
  events.handle({ method: "item/reasoning/summaryTextDelta", params });
  assert.equal(conversationGroups(state.items)[0].turnId, "turn");
  events.handle({
    method: "item/reasoning/summaryTextDelta",
    params: { ...params, delta: "思考正文。" },
  });
  assert.deepEqual(reasoningSummaries(state.items[0].summary), [
    { title: "思考", body: "完整的单段思考正文。" },
  ]);
  events.handle({
    method: "item/reasoning/summaryTextDelta",
    params: { ...params, threadId: "other", delta: "其他对话" },
  });
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].summary[0].text, "完整的单段思考正文。");
});
