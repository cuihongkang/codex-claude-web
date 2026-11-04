import test from "node:test";
import assert from "node:assert/strict";
import adapterModule from "../../vendor/anyresponses/src/adapters/openai-chat.js";

const adapter = adapterModule.createOpenAIChatAdapter();
const request = { model: "reasoning-model", input: "question" };

async function collect(deltas, finish = "stop") {
  async function* chunks() {
    for (const delta of deltas)
      yield { id: "chat", choices: [{ index: 0, delta }] };
    yield { choices: [{ index: 0, delta: {}, finish_reason: finish }] };
    yield {
      choices: [],
      usage: {
        prompt_tokens: 40,
        completion_tokens: 12,
        completion_tokens_details: { reasoning_tokens: 8 },
      },
    };
  }
  return Array.fromAsync(adapter.toOpenStream(chunks(), { request }));
}

for (const field of ["reasoning_content", "reasoning"]) {
  test(`Chat 流式 ${field} 转为实时推理正文，正文及历史保持独立`, async () => {
    let reachedAnswer = false;
    async function* chunks() {
      yield { choices: [{ delta: { [field]: "先核对条件。\n" } }] };
      yield { choices: [{ delta: { [field]: "再计算结果。" } }] };
      reachedAnswer = true;
      yield {
        choices: [
          { delta: { content: "结果为 323。" }, finish_reason: "stop" },
        ],
      };
    }
    const events = [];
    for await (const event of adapter.toOpenStream(chunks(), { request })) {
      if (event.type === "response.reasoning_text.delta")
        assert.equal(reachedAnswer, false, "正文返回前已收到推理增量");
      events.push(event);
    }
    const deltas = events.filter(
      (e) => e.type === "response.reasoning_text.delta",
    );
    assert.equal(
      deltas.map((e) => e.delta).join(""),
      "先核对条件。\n再计算结果。",
    );
    const done = events.find(
      (e) =>
        e.type === "response.output_item.done" && e.item.type === "reasoning",
    );
    assert.ok(
      deltas.every(
        (e) =>
          e.item_id === done.item.id &&
          e.output_index === 0 &&
          e.content_index === 0,
      ),
    );
    assert.ok(
      events.indexOf(done) <
        events.findIndex(
          (e) =>
            e.type === "response.output_item.added" &&
            e.item.type === "message",
        ),
    );
    const completed = events.at(-1).response;
    assert.deepEqual(
      completed.output.map((i) => i.type),
      ["reasoning", "message"],
    );
    assert.deepEqual(completed.output[0], done.item);
    assert.equal(completed.output[1].content[0].text, "结果为 323。");
  });

  test(`Chat 非流式 ${field} 保留推理与最终回答`, () => {
    const response = adapter.toOpenResponse(
      {
        choices: [
          {
            message: { [field]: "核对过程", content: "回答" },
            finish_reason: "stop",
          },
        ],
      },
      { request },
    );
    assert.deepEqual(
      response.output.map((i) => i.type),
      ["reasoning", "message"],
    );
    assert.equal(response.output[0].content[0].text, "核对过程");
    assert.equal(response.output[1].content[0].text, "回答");
  });
}

test("推理后调用工具，推理项先完成，工具参数与用量保持完整", async () => {
  const events = await collect(
    [
      { reasoning_content: "需要先读取账本。" },
      {
        tool_calls: [
          {
            index: 0,
            id: "call",
            function: { name: "read", arguments: '{"id":' },
          },
        ],
      },
      { tool_calls: [{ index: 0, function: { arguments: "1}" } }] },
    ],
    "tool_calls",
  );
  const completed = events.at(-1).response;
  assert.deepEqual(
    completed.output.map((i) => i.type),
    ["reasoning", "function_call"],
  );
  assert.deepEqual(JSON.parse(completed.output[1].arguments), { id: 1 });
  assert.equal(completed.output[1].call_id, "call");
  assert.equal(completed.usage.output_tokens_details.reasoning_tokens, 8);
  const reasoningDone = events.findIndex(
    (e) =>
      e.type === "response.output_item.done" && e.item.type === "reasoning",
  );
  const toolAdded = events.findIndex(
    (e) =>
      e.type === "response.output_item.added" &&
      e.item.type === "function_call",
  );
  assert.ok(reasoningDone < toolAdded);
});

test("只有推理且达到输出上限时保留已收到的推理，省去空回答", async () => {
  const events = await collect([{ reasoning_content: "尚在核对" }], "length");
  const response = events.at(-1).response;
  assert.equal(response.status, "incomplete");
  assert.deepEqual(
    response.output.map((i) => i.type),
    ["reasoning"],
  );
  assert.equal(response.output[0].content[0].text, "尚在核对");
  assert.equal(response.output[0].status, "incomplete");
});

test("空推理与重复别名字段保持正文和推理各一份", async () => {
  const empty = await collect([
    { reasoning_content: null, reasoning: "", content: "直接回答" },
  ]);
  assert.deepEqual(
    empty.at(-1).response.output.map((i) => i.type),
    ["message"],
  );
  const mirrored = await collect([
    { reasoning_content: "核对", reasoning: "核对" },
    { content: "回答" },
  ]);
  assert.equal(mirrored.at(-1).response.output[0].content[0].text, "核对");
});
