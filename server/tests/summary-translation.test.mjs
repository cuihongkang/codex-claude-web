import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import {
  createSummaryTranslationHandler,
  translateWithTransmart,
} from "../src/summary-translation.mjs";

async function translationServer(t, translate) {
  const server = http.createServer(createSummaryTranslationHandler(translate));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}/api/translate`;
}

test("服务端直接请求 TranSmart，使用匿名批量翻译参数和超时", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://transmart.qq.com/api/imt");
    assert.equal(options.method, "POST");
    assert.deepEqual(options.headers, { "Content-Type": "application/json" });
    assert.ok(options.signal instanceof AbortSignal);
    const request = JSON.parse(options.body);
    assert.match(request.header.client_key, /^browser-claudex-web-server-/);
    assert.equal(request.header.fn, "auto_translation");
    assert.equal(request.header.user, "");
    assert.equal(request.header.session, "");
    assert.equal(request.model_category, "normal");
    assert.equal(request.type, "plain");
    assert.deepEqual(request.source, {
      lang: "en",
      text_list: ["Checking files", "Reviewing changes"],
    });
    assert.deepEqual(request.target, { lang: "zh" });
    return Response.json({
      header: { ret_code: "succ" },
      auto_translation: ["检查文件", "审查更改"],
    });
  });
  assert.deepEqual(
    await translateWithTransmart(["Checking files", "Reviewing changes"]),
    ["检查文件", "审查更改"],
  );
});

test("远程服务异常、缺少条目和网络超时保留失败状态", async (t) => {
  for (const [body, status] of [
    [{}, 503],
    [{ header: { ret_code: "Session-Out" } }, 200],
    [{ header: { ret_code: "succ" }, auto_translation: [] }, 200],
    [{ header: { ret_code: "succ" }, auto_translation: [""] }, 200],
    [{ header: { ret_code: "succ" }, auto_translation: [123] }, 200],
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () =>
      Response.json(body, { status }),
    );
    await assert.rejects(translateWithTransmart(["Checking files"]), /翻译/);
    mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => {
    throw new DOMException("模拟请求超时", "TimeoutError");
  });
  await assert.rejects(translateWithTransmart(["Checking files"]), {
    name: "TimeoutError",
  });
});

test("本站翻译接口接受匿名 POST，与 Codex 连接独立并保持顺序", async (t) => {
  const seen = [];
  const url = await translationServer(t, async (texts) => {
    seen.push(texts);
    return ["检查文件", "查看配置"];
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: ["Checking files", "Reviewing 配置"] }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    translations: ["检查文件", "查看配置"],
  });
  assert.deepEqual(seen, [["Checking files", "Reviewing 配置"]]);
});

test("无效方法、批量参数和过长正文在本站拦截，完整读取 UTF-8 请求", async (t) => {
  const seen = [];
  const url = await translationServer(t, async (texts) => {
    seen.push(texts);
    return ["检查配置"];
  });
  const get = await fetch(url);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  for (const body of [
    "invalid json",
    "null",
    "{}",
    JSON.stringify({ texts: [] }),
    JSON.stringify({ texts: [""] }),
    JSON.stringify({ texts: [1] }),
    JSON.stringify({ texts: Array(25).fill("Checking files") }),
    JSON.stringify({ texts: ["x".repeat(256 * 1024)] }),
  ]) {
    const response = await fetch(url, { method: "POST", body });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /翻译请求无效/);
  }
  assert.equal(seen.length, 0);
  const body = Buffer.from(JSON.stringify({ texts: ["Checking 配置"] }));
  const split = body.indexOf(Buffer.from("配")) + 1;
  const completed = new Promise((resolve, reject) => {
    const request = http.request(url, { method: "POST" }, (response) => {
      response.resume();
      response.on("end", resolve);
    });
    request.on("error", reject);
    request.write(body.subarray(0, split));
    setImmediate(() => request.end(body.subarray(split)));
  });
  await completed;
  assert.deepEqual(seen, [["Checking 配置"]]);
});

test("远程服务失败时返回重试提示，重试后恢复译文", async (t) => {
  let attempts = 0;
  const url = await translationServer(t, async () => {
    if (++attempts === 1) throw new Error("模拟远程翻译服务断线");
    return ["检查文件"];
  });
  const options = {
    method: "POST",
    body: JSON.stringify({ texts: ["Checking files"] }),
  };
  const failed = await fetch(url, options);
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), {
    error: "翻译服务暂不可用，请重试",
  });
  const retried = await fetch(url, options);
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), { translations: ["检查文件"] });
});
