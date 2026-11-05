import { open } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { pipeline } from "node:stream/promises";
import { filePresentation } from "../../shared/file-types.mjs";

export async function serveFile(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const url = new URL(request.url, "http://localhost");
  const path = url.searchParams.get("path");
  if (!path || !isAbsolute(path) || path.includes("\0")) {
    response.writeHead(400).end("Invalid file path");
    return;
  }
  const presentation = filePresentation(path);
  const download =
    url.searchParams.get("download") === "1" ||
    !presentation ||
    presentation.kind === "download";
  const type = presentation?.mime || "application/octet-stream";
  const filename = encodeURIComponent(basename(path)).replace(
    /['()*]/g,
    (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
  );
  let file;
  try {
    file = await open(path, "r");
    const metadata = await file.stat();
    const { size } = metadata;
    if (!metadata.isFile()) {
      response.writeHead(404).end("File not found");
      return;
    }
    let start = 0;
    let end = size - 1;
    const range = request.method === "GET" && request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        if (match[1]) {
          start = Number(match[1]);
          if (match[2]) end = Math.min(Number(match[2]), end);
        } else {
          start = Math.max(0, size - Number(match[2]));
          if (Number(match[2]) === 0) start = size;
        }
      }
      if (
        !match ||
        !(match[1] || match[2]) ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start >= size ||
        end < start
      ) {
        response.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
    }
    response.writeHead(range ? 206 : 200, {
      "Content-Type": type,
      "Content-Length": size ? end - start + 1 : 0,
      "Accept-Ranges": "bytes",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
      ...(type === "image/svg+xml"
        ? {
            "Content-Security-Policy":
              "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
          }
        : {}),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    });
    if (request.method === "HEAD" || !size) response.end();
    else
      await pipeline(
        file.createReadStream({ start, end, autoClose: false }),
        response,
      );
  } catch (error) {
    if (response.headersSent) response.destroy();
    else
      response
        .writeHead(
          ["ENOENT", "ENOTDIR"].includes(error.code)
            ? 404
            : error.code === "EACCES"
              ? 403
              : 500,
        )
        .end("Unable to load file");
  } finally {
    await file?.close();
  }
}
