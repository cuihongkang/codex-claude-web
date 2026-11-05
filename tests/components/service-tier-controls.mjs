import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testServiceTierControls(app, fixture) {
  const { requests } = fixture;
  {
    const models = [
      {
        id: "speed-model",
        model: "speed-model",
        displayName: "Speed Model",
        defaultReasoningEffort: "high",
        serviceTiers: [
          { id: "priority", name: "Fast", description: "更快，增加用量" },
          { id: "ultrafast", name: "Ultra Fast", description: "最高速度" },
        ],
      },
      { id: "standard-model", model: "standard-model", serviceTiers: [] },
      {
        id: "legacy-model",
        model: "legacy-model",
        additionalSpeedTiers: ["fast"],
      },
    ];
    const thread = { id: "speed-thread", cwd: "/speed-test", createdAt: 1 };
    let resumedTier = "priority";
    let turnFails = false;
    fixture.responseFor = ({ method }) => {
      if (method === "model/list") return { data: models };
      if (method === "config/read")
        return { config: { model: models[0].model, service_tier: "priority" } };
      if (method === "lan/projectless/read") return { directories: {} };
      if (method === "thread/start") return { thread };
      if (method === "thread/resume" || method === "thread/read")
        return { thread, model: models[0].model, serviceTier: resumedTier };
      if (method === "turn/start" && turnFails)
        return { error: { message: "模拟发送失败" } };
      if (
        [
          "thread/list",
          "thread/turns/list",
          "thread/items/list",
          "skills/list",
        ].includes(method)
      )
        return { data: [] };
      return {};
    };
    const connectionState = (ready) => ({
      ready,
      defaultCwd: "/default",
      activeTurns: {},
      questions: [],
    });
    let speedView;
    await act(async () => {
      fixture.socket.emit("lan/state", connectionState(true));
      speedView = create(React.createElement(app.Composer));
    });
    const speedToggle = () =>
      speedView.root.findByProps({ "aria-label": "速度模式" });
    assert.equal(app.get().serviceTier, "priority");
    assert.equal(speedToggle().props["aria-pressed"], true);
    assert(JSON.stringify(speedView.toJSON()).includes("Fast"));
    assert.equal(speedToggle().type, "button");
    assert.equal(speedToggle().findAllByType("select").length, 0);
    assert.equal(
      speedToggle().findAllByType("svg")[0].props.fill,
      "currentColor",
    );
    assert.equal(
      speedView.root.findAllByProps({ title: "选择技能" }).length,
      0,
    );

    await act(async () => speedToggle().props.onClick());
    await act(async () =>
      fixture.socket.emit("lan/state", connectionState(false)),
    );
    await act(async () =>
      fixture.socket.emit("lan/state", connectionState(true)),
    );
    assert.equal(app.get().serviceTier, null);
    assert.equal(speedToggle().props["aria-pressed"], false);
    assert.equal(speedToggle().findAllByType("svg")[0].props.fill, "none");
    await act(async () => {
      app.newChat(thread.cwd);
      app.setDraft("以标准速度新建");
      assert.equal(await app.sendMessage(), true);
    });
    assert.equal(
      requests.findLast((m) => m.method === "thread/start").params.serviceTier,
      null,
    );
    assert.equal(
      requests.findLast((m) => m.method === "turn/start").params.serviceTier,
      null,
    );
    await act(async () =>
      fixture.socket.emit("lan/state", connectionState(false)),
    );
    await act(async () =>
      fixture.socket.emit("lan/state", connectionState(true)),
    );
    assert.equal(app.get().current.id, thread.id);
    assert.equal(app.get().serviceTier, null);
    assert.equal(speedToggle().props["aria-pressed"], false);

    resumedTier = "fast";
    await act(async () => app.openThread(thread.id));
    assert.equal(speedToggle().props["aria-pressed"], true);
    await act(async () => {
      app.setDraft("恢复 Fast 后发送");
      assert.equal(await app.sendMessage(), true);
    });
    assert.equal(
      requests.findLast((m) => m.method === "turn/start").params.serviceTier,
      "priority",
    );
    resumedTier = null;
    await act(async () => app.openThread(thread.id));
    assert.equal(app.get().serviceTier, null);
    assert.equal(speedToggle().props["aria-pressed"], false);
    await act(async () =>
      fixture.socket.emit("thread/settings/updated", {
        threadId: "other-speed-thread",
        threadSettings: { serviceTier: "priority" },
      }),
    );
    assert.equal(app.get().serviceTier, null);
    await act(async () =>
      fixture.socket.emit("thread/settings/updated", {
        threadId: thread.id,
        threadSettings: { serviceTier: "priority" },
      }),
    );
    assert.equal(speedToggle().props["aria-pressed"], true);
    await act(async () =>
      fixture.socket.emit("thread/settings/updated", {
        threadId: thread.id,
        threadSettings: { serviceTier: null },
      }),
    );
    assert.equal(speedToggle().props["aria-pressed"], false);

    await act(async () => speedToggle().props.onClick());
    await act(async () => {
      app.newChat(thread.cwd);
      app.setDraft("新建 Fast 对话");
      assert.equal(await app.sendMessage(), true);
    });
    assert.equal(
      requests.findLast((m) => m.method === "thread/start").params.serviceTier,
      "priority",
    );
    assert.equal(
      requests.findLast((m) => m.method === "turn/start").params.serviceTier,
      "priority",
    );
    await act(async () => {
      app.set({ active: { [thread.id]: "running-speed-turn" } });
      speedToggle().props.onClick();
      app.setDraft("运行中补充");
      assert.equal(await app.sendMessage(), true);
    });
    const steer = requests.findLast((m) => m.method === "turn/steer");
    assert.equal(steer.params.expectedTurnId, "running-speed-turn");
    assert(!Object.hasOwn(steer.params, "serviceTier"));
    await act(async () => {
      app.set({ active: {} });
      app.setDraft("下一轮标准速度");
      turnFails = true;
      assert.equal(await app.sendMessage(), false);
      assert.equal(app.get().serviceTier, null);
      turnFails = false;
      assert.equal(await app.sendMessage(), true);
    });
    assert.equal(
      requests.findLast((m) => m.method === "turn/start").params.serviceTier,
      null,
    );

    resumedTier = "ultrafast";
    await act(async () => app.openThread(thread.id));
    assert.equal(speedToggle().props["aria-pressed"], true);
    assert(speedToggle().props.title.includes("Ultra Fast"));
    await act(async () => {
      app.setDraft("模型目录中的其他速度");
      assert.equal(await app.sendMessage(), true);
    });
    assert.equal(
      requests.findLast((m) => m.method === "turn/start").params.serviceTier,
      "ultrafast",
    );
    await act(async () =>
      speedView.root
        .findByProps({ "aria-label": "模型" })
        .props.onChange({ target: { value: "standard-model" } }),
    );
    assert.equal(app.get().serviceTier, null);
    assert.equal(speedToggle().props.disabled, true);
    await act(async () =>
      speedView.root
        .findByProps({ "aria-label": "模型" })
        .props.onChange({ target: { value: "legacy-model" } }),
    );
    assert.equal(speedToggle().props.disabled, false);
    await act(async () => {
      speedToggle().props.onClick();
      app.selectModel(models[0]);
    });
    assert.equal(app.get().serviceTier, "priority");
    assert.equal(app.get().effort, "high");
    resumedTier = "custom-speed";
    await act(async () => app.openThread(thread.id));
    assert.equal(speedToggle().props["aria-pressed"], true);
    assert(JSON.stringify(speedView.toJSON()).includes("custom-speed"));
    await act(async () => speedToggle().props.onClick());
    assert.equal(app.get().serviceTier, null);
    assert.equal(speedToggle().props["aria-pressed"], false);
    await act(async () => {
      speedView.unmount();
      app.newChat("/default");
      app.set({
        models: [],
        model: "",
        effort: "",
        serviceTier: null,
        threads: [],
        items: [],
        error: "",
      });
    });
    fixture.responseFor = (m) =>
      m.method === "thread/list" ? { data: [] } : {};
    requests.length = 0;
    console.log(
      "PASS 闪电按钮切换与状态、移除技能按钮、Fast 配置和发送、恢复与通知同步、重连及失败重试",
    );
  }
}
