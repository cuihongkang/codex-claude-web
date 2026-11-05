import assert from "node:assert/strict";

export async function testAttachmentDrafts(app, fixture) {
  const original = app.get();
  const respond = fixture.responseFor;
  const FileReader = globalThis.FileReader;
  const readers = [];
  const image = (id) => ({
    id,
    name: `${id}.png`,
    preview: "data:image/png;base64,aW1hZ2U=",
    input: { type: "image", url: "data:image/png;base64,aW1hZ2U=" },
  });
  let fail = false;
  let onSend = () => {};
  fixture.responseFor = ({ method, params }) => {
    if (["thread/read", "thread/resume", "thread/start"].includes(method))
      return {
        thread: { id: params.threadId || "attachment-created", cwd: "/demo" },
      };
    if (method === "turn/start") {
      onSend();
      return fail ? { error: { message: "模拟发送失败" } } : {};
    }
    if (method === "lan/projectless/read") return { directories: {} };
    return { data: [] };
  };
  globalThis.FileReader = class {
    constructor() {
      readers.push(this);
    }
    readAsDataURL() {}
  };
  try {
    app.newChat("/demo");
    app.set({ attachments: [], active: {} });
    app.setDraft("带图片的新对话草稿");
    const first = image("first");
    app.addAttachment(first);
    await app.openThread("attachment-other");
    assert.deepEqual(app.get().attachments, []);
    const other = image("other");
    app.addAttachment(other);
    app.newChat("/demo");
    assert.equal(app.get().draft, "带图片的新对话草稿");
    assert.deepEqual(app.get().attachments, [first]);
    app.newChat("/demo");
    assert.deepEqual(app.get().attachments, [first]);
    await app.openThread("attachment-other");
    assert.deepEqual(app.get().attachments, [other]);
    app.set({ attachments: [] });
    app.newChat("/demo");
    await app.openThread("attachment-other");
    assert.deepEqual(app.get().attachments, [], "移除的图片保持移除");

    app.newChat("/demo");
    const loading = app.attachFile({ type: "image/png", name: "late.png" });
    await app.openThread("attachment-other");
    readers[0].result = first.preview;
    readers[0].onload();
    await loading;
    assert.deepEqual(app.get().attachments, [], "迟到图片留在原草稿");
    app.newChat("/demo");
    assert.equal(app.get().attachments.length, 2);
    const submitted = app.get().attachments;
    fail = true;
    assert.equal(await app.sendMessage(), false);
    assert.equal(app.get().current.id, "attachment-created");
    assert.deepEqual(app.get().attachments, submitted);
    app.newChat("/demo");
    assert.deepEqual(app.get().attachments, [], "首次发送后新草稿独立");
    await app.openThread("attachment-created");
    assert.deepEqual(app.get().attachments, submitted, "失败附件迁入实际对话");

    fail = false;
    const next = image("next");
    onSend = () => {
      app.addAttachment(next);
      app.newChat("/demo");
      app.addAttachment(other);
    };
    assert.equal(await app.sendMessage(), true);
    assert.deepEqual(app.get().attachments, [other], "发送结果隔离当前草稿");
    await app.openThread("attachment-created");
    assert.deepEqual(app.get().attachments, [next], "仅清理已发送的图片");
    const request = fixture.requests
      .filter((r) => r.method === "turn/start")
      .at(-1);
    assert.deepEqual(
      request.params.input.slice(1),
      submitted.map((a) => a.input),
    );
    onSend = () => {};
    let finishRead;
    const reading = app.attachFile({
      type: "text/plain",
      name: "notes.txt",
      text: () => new Promise((resolve) => (finishRead = resolve)),
    });
    await app.openThread("attachment-other");
    finishRead("文件附件的完整正文");
    await reading;
    assert.deepEqual(app.get().attachments, [], "文件读取结果归属原对话");
    await app.openThread("attachment-created");
    const file = app.get().attachments[1];
    assert.equal(file.name, "notes.txt");
    assert.equal(file.input.text, "附件 notes.txt\n\n文件附件的完整正文");
    app.newChat("/demo");
    await app.openThread("attachment-created");
    assert.deepEqual(app.get().attachments, [next, file]);
    fail = true;
    assert.equal(await app.sendMessage(), false);
    assert.deepEqual(app.get().attachments, [next, file]);
    fail = false;
    assert.equal(await app.sendMessage(), true);
    const fileRequest = fixture.requests
      .filter((r) => r.method === "turn/start")
      .at(-1);
    assert.deepEqual(fileRequest.params.input.slice(-2), [
      next.input,
      file.input,
    ]);
    assert.deepEqual(app.get().attachments, []);
    console.log(
      "PASS 图片及文件草稿切换恢复、对话隔离、移除、异步读取、首次发送迁移和失败重试",
    );
  } finally {
    app.set({ attachments: [] });
    app.newChat("/demo");
    app.set({ attachments: [] });
    app.setDraft("");
    app.set(original);
    fixture.responseFor = respond;
    fixture.requests.length = 0;
    globalThis.FileReader = FileReader;
    for (const id of ["attachment-created", "attachment-other"])
      localStorage.removeItem("cx-draft-" + id);
  }
}
