import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testReasoningControls(app, fixture) {
  const { requests } = fixture;
  {
    const models = [
      {
        id: "effort-model",
        model: "effort-model",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map(
          (reasoningEffort) => ({ reasoningEffort }),
        ),
      },
      {
        id: "other-effort-model",
        model: "other-effort-model",
        defaultReasoningEffort: "none",
        supportedReasoningEfforts: ["none", "high", "ultra"].map(
          (reasoningEffort) => ({ reasoningEffort }),
        ),
      },
      {
        id: "fixed-effort-model",
        model: "fixed-effort-model",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [{ reasoningEffort: "high" }],
      },
    ];
    app.set({
      models,
      model: models[0].model,
      effort: "",
      current: { id: "effort-fixture" },
      items: [],
      active: {},
    });
    fixture.responseFor = (m) =>
      ["thread/list", "thread/turns/list"].includes(m.method)
        ? { data: [] }
        : {};
    let effortView;
    await act(async () => {
      effortView = create(React.createElement(app.Composer));
    });
    const trigger = () =>
      effortView.root.findByProps({ "aria-label": "调整思考强度" });
    const range = () => effortView.root.findByProps({ type: "range" });
    assert.equal(effortView.root.findAllByProps({ type: "range" }).length, 0);
    assert.equal(trigger().props.title, "思考强度：高");
    await act(async () => trigger().props.onClick());
    assert.equal(trigger().props["aria-expanded"], true);
    assert.deepEqual(
      [
        range().props.min,
        range().props.max,
        range().props.step,
        range().props.value,
      ],
      [0, 3, 1, 2],
    );
    assert.equal(range().props["aria-valuetext"], "高");
    assert.equal(
      effortView.root.findAllByProps({ className: "reasoning-effort-labels" })
        .length,
      0,
    );
    assert.equal(
      effortView.root.findByProps({ className: "reasoning-effort-stops" })
        .children.length,
      4,
    );
    assert.deepEqual(effortView.root.findByType("output").children, ["高"]);
    assert.equal(
      effortView.root.findAll(
        (n) => n.type === "select" && n.props["aria-label"] === "思考强度",
      ).length,
      0,
    );
    await act(async () => {
      range().props.onChange({ target: { value: "0" } });
      app.setDraft("滑块选择低强度");
      assert.equal(await app.sendMessage(), true);
    });
    const low = requests.findLast((m) => m.method === "turn/start").params;
    assert.equal(low.effort, "low");
    assert.equal(low.collaborationMode.settings.reasoning_effort, "low");
    assert.equal(range().props["aria-valuetext"], "低");
    await act(async () => range().props.onChange({ target: { value: "3" } }));
    assert.equal(app.get().effort, "xhigh");
    assert.equal(trigger().props.title, "思考强度：极高");
    await act(async () =>
      effortView.root
        .findByProps({ "aria-label": "模型" })
        .props.onChange({ target: { value: models[1].model } }),
    );
    assert.equal(trigger().props["aria-expanded"], false);
    await act(async () => trigger().props.onClick());
    assert.deepEqual(
      [range().props.max, range().props.value, range().props["aria-valuetext"]],
      [2, 1, "高"],
    );
    await act(async () => {
      range().props.onChange({ target: { value: "2" } });
      app.setDraft("按模型档位发送超高强度");
      assert.equal(await app.sendMessage(), true);
    });
    assert.equal(
      requests.findLast((m) => m.method === "turn/start").params.effort,
      "ultra",
    );
    let stopped = false;
    await act(async () =>
      effortView.root
        .findByProps({ className: "reasoning-effort" })
        .props.onKeyDown({
          key: "Escape",
          stopPropagation() {
            stopped = true;
          },
        }),
    );
    assert(stopped);
    assert.equal(trigger().props["aria-expanded"], false);
    await act(async () => trigger().props.onClick());
    await act(async () =>
      effortView.root
        .findByProps({ className: "reasoning-effort" })
        .props.onBlur({
          currentTarget: { contains: () => false },
          relatedTarget: null,
        }),
    );
    assert.equal(trigger().props["aria-expanded"], false);
    await act(async () => app.selectModel(models[2]));
    assert.equal(trigger().props.disabled, true);
    let inlineView;
    await act(async () => {
      inlineView = create(
        React.createElement(app.ReasoningEffortControl, { inline: true }),
      );
    });
    assert.equal(
      inlineView.root.findByProps({ type: "range" }).props.disabled,
      true,
    );
    await act(async () => app.selectModel(models[0]));
    assert.equal(inlineView.root.findAllByType("button").length, 0);
    await act(async () =>
      inlineView.root
        .findByProps({ type: "range" })
        .props.onChange({ target: { value: "1" } }),
    );
    assert.equal(app.get().effort, "medium");
    assert.equal(trigger().props.title, "思考强度：中");
    await act(async () => {
      inlineView.unmount();
      effortView.unmount();
      app.newChat("/default");
      app.set({
        models: [],
        model: "",
        effort: "",
        threads: [],
        items: [],
        error: "",
      });
    });
    fixture.responseFor = (m) =>
      m.method === "thread/list" ? { data: [] } : {};
    requests.length = 0;
    console.log(
      "PASS 思考强度滑块默认档位、模型支持范围、拖动发送、模型切换、收起交互及弹窗共用状态",
    );
  }
}
