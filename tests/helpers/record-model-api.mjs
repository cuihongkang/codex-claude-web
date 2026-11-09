import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

// 转发真实供应商的原始响应，记录内容与时序，不构造模型回复。
export async function recordModelApi(baseUrl, directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const requests = [];
  const controllers = new Set();
  const pending = new Set();
  let closing;
  const server = http.createServer(async (request, response) => {
    let finish;
    const completion = new Promise((resolve) => {
      finish = resolve;
    });
    pending.add(completion);
    const id = requests.length + 1;
    const startedAt = Date.now();
    const entry = { id, path: request.url, startedAt };
    requests.push(entry);
    const controller = new AbortController();
    controllers.add(controller);
    const log = createWriteStream(join(directory, `${id}.response`), {
      mode: 0o600,
    });
    response.on("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      await writeFile(join(directory, `${id}.request.json`), body, {
        mode: 0o600,
      });
      const headers = { ...request.headers };
      delete headers.host;
      delete headers["content-length"];
      delete headers.connection;
      const upstream = await fetch(baseUrl + request.url, {
        method: request.method,
        headers,
        ...(body && { body }),
        signal: controller.signal,
      });
      entry.status = upstream.status;
      entry.headersAt = Date.now();
      response.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
      });
      await pipeline(
        Readable.fromWeb(upstream.body),
        new Transform({
          transform(chunk, _encoding, done) {
            entry.firstBytesAt ??= Date.now();
            log.write(chunk);
            done(null, chunk);
          },
        }),
        response,
      );
      entry.completedAt = Date.now();
    } catch (error) {
      entry.error = error.message;
      entry.completedAt = Date.now();
      if (!response.headersSent) response.writeHead(502);
      if (!response.destroyed) response.end();
    } finally {
      controllers.delete(controller);
      await new Promise((resolve) => log.end(resolve));
      await writeFile(
        join(directory, "timings.json"),
        JSON.stringify(requests, null, 2),
        { mode: 0o600 },
      );
      pending.delete(completion);
      finish();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close() {
      return (closing ??= (async () => {
        for (const controller of controllers) controller.abort();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        await Promise.all(pending);
      })());
    },
  };
}
