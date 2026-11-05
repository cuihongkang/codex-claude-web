import test from "node:test";
import assert from "node:assert/strict";
import { createRpcClient } from "../src/infrastructure/rpc-client.js";

test("RPC 请求按实例与连接隔离，发送异常、断开和超时均清理等待记录", async (t) => {
  const previousSocket = globalThis.WebSocket,
    previousLocation = globalThis.location;
  const sockets = [];
  globalThis.location = { host: "fixture.invalid" };
  globalThis.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() {
      sockets.push(this);
    }
    send(raw) {
      if (this.fail) throw new Error("发送失败");
      this.sent.push(JSON.parse(raw));
    }
    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
    reply(id, result) {
      this.onmessage({ data: JSON.stringify({ id, result }) });
    }
  };
  t.after(() => {
    globalThis.WebSocket = previousSocket;
    globalThis.location = previousLocation;
  });
  const options = {
    isConnected: () => true,
    authenticated: () => true,
    requestContext: () => ({ opening: 3 }),
    onNotification() {},
    onRequest() {},
    onResponse() {},
    onClose() {},
  };
  const first = createRpcClient(options),
    second = createRpcClient(options);
  first.connect();
  second.connect();
  const pendingFirst = first.rpc("thread/read", { threadId: "a" });
  const pendingSecond = second.rpc("thread/read", { threadId: "b" });
  assert.equal(first.pending.get(1).opening, 3);
  sockets[1].reply(1, { id: "b" });
  assert.deepEqual(await pendingSecond, { id: "b" });
  assert.equal(first.pending.size, 1);
  const rejected = assert.rejects(pendingFirst, /断开/);
  first.disconnect(new Error("断开"));
  await rejected;
  first.connect();
  const next = first.rpc("thread/read", { threadId: "next" });
  sockets[0].reply(2, { id: "旧连接" });
  assert.equal(first.pending.size, 1);
  sockets[2].reply(2, { id: "next" });
  assert.deepEqual(await next, { id: "next" });
  const replacing = first.rpc("thread/read", { threadId: "replaced" });
  const replaced = assert.rejects(replacing, /连接已更新/);
  first.connect();
  await replaced;
  assert.equal(sockets[2].readyState, 3);
  assert.equal(first.pending.size, 0);
  sockets[3].fail = true;
  await assert.rejects(first.rpc("thread/read"), /发送失败/);
  assert.equal(first.pending.size, 0);
  sockets[3].fail = false;
  await assert.rejects(first.rpc("thread/read", {}, 5), /超时/);
  assert.equal(first.pending.size, 0);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const preparing = first.rpc("thread/resume", { threadId: "migration" });
  const ordinary = first.rpc("thread/read", { threadId: "ordinary" });
  const timedOut = assert.rejects(ordinary, /超时/);
  t.mock.timers.tick(600001);
  await timedOut;
  assert.equal(first.pending.size, 1);
  const preparation = sockets[3].sent.findLast(
    (message) => message.method === "thread/resume",
  );
  sockets[3].reply(preparation.id, { model: "restored" });
  assert.deepEqual(await preparing, { model: "restored" });
  t.mock.timers.reset();
  first.disconnect(new Error("结束"));
  second.disconnect(new Error("结束"));
});
