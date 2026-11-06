export { providerRuntimeEnvironment } from "./provider-environment.mjs";
import { messagesRequest } from "./messages-request.mjs";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function createProviderTransport(provider) {
  const token = randomUUID();
  const server = http.createServer(async (request, response) => {
    if (
      request.headers["x-api-key"] !== token &&
      request.headers.authorization !== `Bearer ${token}`
    ) {
      response.writeHead(401).end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 64 * 1024 * 1024) throw new Error("请求过大");
      }
      if (body && (provider.protocol || "messages") === "messages")
        body = JSON.stringify(messagesRequest(JSON.parse(body)));
      const headers = {
        ...request.headers,
        "x-api-key": provider.apiKey,
        authorization: `Bearer ${provider.apiKey}`,
      };
      delete headers.host;
      delete headers["content-length"];
      delete headers.connection;
      const abort = new AbortController();
      response.on("close", () => {
        if (!response.writableEnded) abort.abort();
      });
      const target = new URL(provider.baseUrl + request.url);
      const options = {
        method: request.method,
        headers,
        ...(body && { body }),
        signal: abort.signal,
      };
      const upstream = await fetch(target, options);
      response.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
      });
      if (upstream.body)
        await pipeline(Readable.fromWeb(upstream.body), response);
      else response.end();
    } catch (error) {
      if (!response.headersSent) response.writeHead(502);
      response.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    token,
    close() {
      server.close();
      server.closeAllConnections();
    },
  };
}
