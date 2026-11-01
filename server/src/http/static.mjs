import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/favicon.ico", ["favicon.ico", "image/x-icon"]],
  ["/favicon.png", ["favicon.png", "image/png"]],
  ["/apple-touch-icon.png", ["apple-touch-icon.png", "image/png"]],
]);
export function createStaticHandler(staticDir) {
  const staticCache = new Map();
  return async function serveStatic(request, response, path) {
    const asset = path.match(/^\/([\w.-]+\.(js|css))$/);
    const file =
      files.get(path) ||
      (asset && [
        asset[1],
        asset[2] === "js"
          ? "text/javascript; charset=utf-8"
          : "text/css; charset=utf-8",
      ]);
    if (!file) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    try {
      const metadata = await stat(join(staticDir, file[0]));
      if (staticCache.get(path)?.modified !== metadata.mtimeMs) {
        const raw = await readFile(join(staticDir, file[0]));
        staticCache.set(path, {
          raw,
          gzip: gzipSync(raw),
          modified: metadata.mtimeMs,
        });
      }
      const content = staticCache.get(path);
      const compressed = /\bgzip\b/.test(
        request.headers["accept-encoding"] || "",
      );
      response.writeHead(200, {
        "Content-Type": file[1],
        "Cache-Control": "no-store",
        Vary: "Accept-Encoding",
        ...(compressed ? { "Content-Encoding": "gzip" } : {}),
      });
      response.end(compressed ? content.gzip : content.raw);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") {
        staticCache.delete(path);
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      console.error("Static file:", error.message);
      response.writeHead(500);
      response.end("Unable to load page");
    }
  };
}
