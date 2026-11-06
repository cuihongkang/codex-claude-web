import { randomUUID } from "node:crypto";

// TranSmart 匿名接口使用 browser 前缀的客户端标识；请求由 Node.js 直接发送。
const clientKey = `browser-claudex-web-server-${randomUUID()}`;

export async function translateWithTransmart(texts) {
  const response = await fetch("https://transmart.qq.com/api/imt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      header: {
        fn: "auto_translation",
        client_key: clientKey,
        user: "",
        session: "",
      },
      type: "plain",
      model_category: "normal",
      source: { lang: "en", text_list: texts },
      target: { lang: "zh" },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("翻译服务请求失败，请重试");
  const data = await response.json();
  if (data.header?.ret_code !== "succ")
    throw new Error("翻译服务暂不可用，请重试");
  if (
    !Array.isArray(data.auto_translation) ||
    data.auto_translation.length !== texts.length ||
    data.auto_translation.some(
      (text) => typeof text !== "string" || !text.trim(),
    )
  )
    throw new Error("翻译结果不完整");
  return data.auto_translation;
}

export function createSummaryTranslationHandler(
  translate = translateWithTransmart,
) {
  return async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      response.writeHead(405);
      response.end(JSON.stringify({ error: "翻译接口使用 POST 请求" }));
      return;
    }
    let texts;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size <= 256 * 1024) chunks.push(chunk);
      }
      if (size > 256 * 1024) throw new Error("翻译文本过长，请缩短后重试");
      texts = JSON.parse(Buffer.concat(chunks).toString("utf8")).texts;
      if (
        !Array.isArray(texts) ||
        !texts.length ||
        texts.length > 24 ||
        texts.some((text) => typeof text !== "string" || !text.trim())
      )
        throw new Error("翻译请求需包含 1 到 24 条有效文本");
    } catch (error) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "翻译请求无效：" + error.message }));
      return;
    }
    try {
      const translations = await translate(texts);
      response.writeHead(200);
      response.end(JSON.stringify({ translations }));
    } catch {
      response.writeHead(502);
      response.end(JSON.stringify({ error: "翻译服务暂不可用，请重试" }));
    }
  };
}
