import assert from "node:assert/strict";

export async function testProjectModels(app, requests, setResponse, emit) {
  const original = app.get();
  const previousPreferences = localStorage.getItem("cx-project-models");
  const previousPending = localStorage.getItem("cx-project-models-pending");
  const models = [
    {
      model: "project-a-model",
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map(
        (reasoningEffort) => ({ reasoningEffort }),
      ),
    },
    {
      model: "project-b-model",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"].map(
        (reasoningEffort) => ({ reasoningEffort }),
      ),
    },
  ];
  const thread = {
    id: "project-model-history",
    cwd: "/fixture/project-a",
    model: models[0].model,
    reasoningEffort: "low",
    createdAt: 1,
  };
  let finishResume;
  let hold = false;
  setResponse(({ method }) => {
    if (method === "thread/read") return { thread };
    if (method === "thread/resume") {
      const settings = {
        thread,
        model: models[0].model,
        reasoningEffort: "low",
      };
      return hold
        ? new Promise((resolve) => (finishResume = () => resolve(settings)))
        : settings;
    }
    return { data: [] };
  });
  try {
    app.set({ models, active: {}, connected: true });
    localStorage.removeItem("cx-project-models");
    localStorage.removeItem("cx-project-models-pending");
    app.set({
      current: thread,
      cwd: thread.cwd,
      projectless: false,
      model: models[1].model,
      effort: "high",
      loading: false,
    });
    app.newChat(undefined, { reuseDirectory: true });
    assert.equal(
      app.get().model,
      models[1].model,
      "右上角同项目新建保留从历史恢复的模型",
    );
    assert.equal(
      app.get().effort,
      "high",
      "尚未手动选择时同项目新建也保留强度",
    );
    app.newChat(thread.cwd);
    app.selectModel(models[0]);
    app.selectEffort("high");
    app.selectModel(models[1]);
    assert.equal(app.get().effort, "high");
    app.newChat("/fixture/project-b");
    app.selectModel(models[0]);
    app.selectEffort("medium");
    app.newChat(thread.cwd);
    assert.equal(app.get().model, models[1].model);
    assert.equal(app.get().effort, "high");
    await app.openThread(thread.id);
    assert.equal(app.get().model, models[0].model);
    assert.equal(app.get().effort, "low", "已有对话恢复自身设置");
    app.setDraft("沿用已有对话设置发送");
    assert.equal(await app.sendMessage(), true);
    const params = requests.findLast(
      (request) => request.method === "turn/start",
    ).params;
    assert.equal(params.model, models[0].model);
    assert.equal(params.effort, "low");
    assert.equal(params.collaborationMode.settings.reasoning_effort, "low");
    hold = true;
    const checking = app.refreshThreadAccess();
    app.selectModel(models[0]);
    app.selectEffort("xhigh");
    finishResume();
    await checking;
    assert.equal(app.get().effort, "xhigh", "迟到的恢复响应保留用户新选择");
    app.selectModel(models[1]);
    assert.equal(app.get().effort, "high", "目标模型缺少极高时使用最近的高档");
    app.newChat("/fixture/project-b");
    assert.equal(app.get().model, models[0].model);
    assert.equal(app.get().effort, "medium");
    app.setDraft("选择目录时继续保留的草稿");
    const attachments = [{ id: "project-attachment", name: "notes.txt" }];
    app.set({ attachments });
    app.setProjectDirectory(thread.cwd);
    assert.equal(app.get().effort, "high");
    assert.equal(app.get().draft, "选择目录时继续保留的草稿");
    assert.equal(app.get().attachments, attachments);
    app.newChat("");
    app.selectModel(models[1]);
    app.selectEffort("low");
    app.newChat(thread.cwd);
    app.newChat("");
    assert.equal(app.get().effort, "low", "未分类使用独立偏好");
    const stored = JSON.parse(localStorage.getItem("cx-project-models"));
    assert.deepEqual(stored[thread.cwd], {
      model: models[1].model,
      effort: "high",
    });
    let projects = {
      "/server/project": { model: models[1].model, effort: "medium" },
    };
    let fail = false;
    let holdSave = false;
    let finishSave;
    setResponse(({ method, params }) => {
      if (method === "lan/projectModels/read")
        return { projects: { ...projects } };
      if (method === "lan/projectModels/set") {
        if (fail) return { error: { message: "模拟磁盘写入失败" } };
        if (holdSave) {
          holdSave = false;
          return new Promise((resolve) => {
            finishSave = () => {
              projects = {
                ...projects,
                [params.cwd]: { model: params.model, effort: params.effort },
              };
              resolve({ projects: { ...projects } });
            };
          });
        }
        if (!params.ifAbsent || !Object.hasOwn(projects, params.cwd))
          projects = {
            ...projects,
            [params.cwd]: { model: params.model, effort: params.effort },
          };
        return { projects: { ...projects } };
      }
      return { data: [] };
    });
    await app.syncProjectModels();
    assert.deepEqual(
      projects[thread.cwd],
      { model: models[1].model, effort: "high" },
      "已有浏览器选择迁移到服务端",
    );
    localStorage.removeItem("cx-project-models");
    localStorage.removeItem("cx-project-models-pending");
    await app.syncProjectModels();
    app.newChat("/server/project");
    assert.equal(app.get().model, models[1].model);
    assert.equal(
      app.get().effort,
      "medium",
      "清空浏览器后从服务端恢复项目选择",
    );
    fail = true;
    app.selectEffort("high");
    await assert.rejects(app.syncProjectModels(), /模拟磁盘写入失败/);
    assert.equal(app.get().effort, "high");
    assert(
      Object.hasOwn(
        JSON.parse(localStorage.getItem("cx-project-models-pending")),
        "/server/project",
      ),
    );
    fail = false;
    await app.syncProjectModels();
    assert.equal(
      projects["/server/project"].effort,
      "high",
      "失败重试保存用户选择",
    );
    holdSave = true;
    app.selectEffort("low");
    assert(finishSave);
    app.selectEffort("high");
    await emit("lan/projectModels/updated", {
      projects: {
        "/server/project": { model: models[1].model, effort: "low" },
      },
    });
    assert.equal(app.get().effort, "high");
    assert.equal(
      JSON.parse(localStorage.getItem("cx-project-models"))["/server/project"]
        .effort,
      "high",
    );
    finishSave();
    await app.syncProjectModels();
    assert.equal(
      projects["/server/project"].effort,
      "high",
      "旧保存响应与跨页面通知保留后续选择并完成新值写入",
    );
  } finally {
    setResponse(() => ({ data: [] }));
    await app.syncProjectModels();
    app.newChat();
    app.set(original);
    if (previousPreferences === null)
      localStorage.removeItem("cx-project-models");
    else localStorage.setItem("cx-project-models", previousPreferences);
    if (previousPending === null)
      localStorage.removeItem("cx-project-models-pending");
    else localStorage.setItem("cx-project-models-pending", previousPending);
  }
  console.log(
    "PASS 项目模型与强度隔离、模型切换保留及最近档位、历史恢复、迟到响应与实际发送",
  );
}
