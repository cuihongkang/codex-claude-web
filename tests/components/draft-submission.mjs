import assert from "node:assert/strict";

export async function testDraftSubmission(app, fixture) {
  const { requests } = fixture;
  {
    const thread = { id: "draft-thread", cwd: "/code/x", createdAt: 1 };
    let turnFails = true;
    let onSend = () => {};
    fixture.responseFor = ({ method }) => {
      if (["thread/start", "thread/resume", "thread/read"].includes(method))
        return { thread, cwd: thread.cwd };
      if (method === "thread/list") return { data: [thread] };
      if (method === "thread/turns/list" || method === "thread/items/list")
        return { data: [] };
      if (method === "lan/projectless/read") return { directories: {} };
      if (method === "turn/start") {
        onSend();
        return turnFails ? { error: { message: "消息发送失败" } } : {};
      }
      return {};
    };
    app.newChat(thread.cwd);
    app.setDraft("尚未发送的首条消息");
    app.newChat();
    assert.equal(app.get().draft, "尚未发送的首条消息");
    assert.equal(await app.sendMessage(), false);
    assert.equal(app.get().current.id, thread.id);
    assert.equal(app.get().draft, "尚未发送的首条消息");
    assert.equal(localStorage.getItem("cx-draft-new"), null);
    assert.equal(
      localStorage.getItem("cx-draft-" + thread.id),
      "尚未发送的首条消息",
    );
    app.newChat();
    assert.equal(app.get().draft, "");
    await app.openThread(thread.id);
    assert.equal(app.get().draft, "尚未发送的首条消息");
    turnFails = false;
    assert.equal(await app.sendMessage(), true);
    assert.equal(app.get().draft, "");
    assert.equal(localStorage.getItem("cx-draft-" + thread.id), null);
    app.newChat();
    assert.equal(app.get().draft, "");
    await app.openThread(thread.id);
    assert.equal(app.get().draft, "");

    app.setDraft("发送后切换对话");
    onSend = () => {
      app.newChat();
      app.setDraft("新对话中的未发送草稿");
    };
    assert.equal(await app.sendMessage(), true);
    assert.equal(app.get().draft, "新对话中的未发送草稿");
    assert.equal(localStorage.getItem("cx-draft-" + thread.id), null);
    await app.openThread(thread.id);
    assert.equal(app.get().draft, "");

    app.setDraft("发送时继续编辑");
    onSend = () => app.setDraft("等待期间输入的下一条草稿");
    assert.equal(await app.sendMessage(), true);
    assert.equal(app.get().draft, "等待期间输入的下一条草稿");
    assert.equal(
      localStorage.getItem("cx-draft-" + thread.id),
      "等待期间输入的下一条草稿",
    );
    app.newChat();
    assert.equal(app.get().draft, "新对话中的未发送草稿");
    await app.openThread(thread.id);
    assert.equal(app.get().draft, "等待期间输入的下一条草稿");
    app.newChat();
    app.setDraft("");
    app.set({ threads: [], active: {}, error: "", items: [] });
    fixture.responseFor = (m) =>
      m.method === "thread/list" ? { data: [] } : {};
    requests.length = 0;
    console.log(
      "PASS 新对话保留未发送草稿、创建后草稿归属、发送失败恢复、成功清理及等待期间的切换和编辑",
    );
  }
}
