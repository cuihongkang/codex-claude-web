import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testProviders(app, fixture) {
  const previous = app.get(),
    respond = fixture.responseFor;
  const providers = [
    { id: "codex", name: "ChatGPT / Codex", builtin: true, models: [] },
    {
      id: "custom",
      name: "自定义模型",
      baseUrl: "https://example.com/v1",
      protocol: "chat",
      hasApiKey: true,
      models: [
        { id: "same-name", contextWindow: 32768, maxOutputTokens: 4096 },
      ],
    },
  ];
  const models = [
    {
      id: "native",
      model: "same-name",
      providerId: "codex",
      supportedReasoningEfforts: [{ reasoningEffort: "high" }],
      defaultReasoningEffort: "high",
    },
    {
      id: "custom:same-name",
      model: "same-name",
      providerId: "custom",
      supportedReasoningEfforts: [],
    },
  ];
  let view, settings;
  try {
    fixture.responseFor = (request) =>
      request.method === "lan/providers/set" ? { providers } : { data: [] };
    app.set({
      providersSupported: true,
      providers,
      providerId: "codex",
      models,
      model: "same-name",
      current: { id: "providers-test" },
      threadAccess: null,
      active: {},
      busy: false,
      loading: false,
      compactions: {},
      items: [],
      attachments: [],
      cwd: "/fixture/providers",
      effort: "high",
    });
    await act(async () => {
      view = create(React.createElement(app.Composer));
    });
    assert.equal(
      view.root.findByProps({ "aria-label": "模型" }).findAllByType("option")
        .length,
      1,
    );
    await act(async () =>
      view.root
        .findByProps({ "aria-label": "供应商" })
        .props.onChange({ target: { value: "custom" } }),
    );
    assert.equal(app.get().providerId, "custom");
    assert.equal(app.get().effort, "");
    app.setDraft("验证供应商与同名模型");
    await act(async () => {
      assert.equal(await app.sendMessage(), true);
    });
    const request = fixture.requests
      .filter((m) => m.method === "turn/start")
      .at(-1);
    assert.equal(request.params.providerId, "custom");
    assert.equal(request.params.model, "same-name");
    await act(async () => app.set({ active: { "providers-test": "running" } }));
    assert.equal(
      view.root.findByProps({ "aria-label": "供应商" }).props.disabled,
      true,
    );
    await act(async () => app.selectModel(models[0]));
    assert.equal(app.get().providerId, "custom");
    await act(async () => {
      settings = create(React.createElement(app.ProviderSettings));
    });
    const button = (text) =>
      settings.root
        .findAllByType("button")
        .find((b) => b.children.join("") === text);
    await act(async () => button("编辑").props.onClick());
    const key = settings.root.findByProps({ type: "password" });
    assert.equal(key.props.value, "");
    await act(async () =>
      settings.root.findByType("form").props.onSubmit({ preventDefault() {} }),
    );
    const saved = fixture.requests
      .filter((m) => m.method === "lan/providers/set")
      .at(-1);
    assert.equal(Object.hasOwn(saved.params, "apiKey"), false);
    console.log(
      "PASS 供应商同名模型隔离、发送身份、运行门控、API Key 编辑保留",
    );
  } finally {
    await act(async () => {
      view?.unmount();
      settings?.unmount();
    });
    fixture.responseFor = respond;
    app.set(previous);
  }
}
