import { X509Certificate } from "node:crypto";
import { createSummaryTranslationHandler } from "../summary-translation.mjs";
import { serveFile } from "../file-content.mjs";
import { createStaticHandler } from "./static.mjs";
export function createHttpHandler({
  config,
  tls,
  authentication,
  version,
  isReady,
}) {
  const publicCertificate = new X509Certificate(tls.cert);
  const translateSummary = createSummaryTranslationHandler();
  const serveStatic = createStaticHandler(config.staticDir);
  return async function handleHttp(request, response) {
    const ready = isReady();
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'self'; base-uri 'self'; object-src 'self'; upgrade-insecure-requests",
    );
    response.setHeader("Cache-Control", "no-store");
    const path = new URL(request.url, "http://localhost").pathname;
    if (["/api/tls/info", "/api/tls/certificate"].includes(path)) {
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }
      const download = path === "/api/tls/certificate";
      const body = download
        ? publicCertificate.raw
        : Buffer.from(
            JSON.stringify({
              fingerprint: publicCertificate.fingerprint256,
              validTo: publicCertificate.validTo,
              selfSigned:
                publicCertificate.subject === publicCertificate.issuer &&
                publicCertificate.verify(publicCertificate.publicKey),
            }),
          );
      response.writeHead(200, {
        "Content-Type": download
          ? "application/pkix-cert"
          : "application/json; charset=utf-8",
        "Content-Length": body.length,
        ...(download
          ? { "Content-Disposition": 'attachment; filename="claudex-web.cer"' }
          : {}),
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }
    if (await authentication.handle(request, response, path)) return;
    if (
      path.startsWith("/api/") &&
      !authentication.authorize(request, response)
    )
      return;
    if (["/api/files", "/api/media"].includes(path)) {
      await serveFile(request, response);
      return;
    }
    if (path === "/api/translate") {
      await translateSummary(request, response);
      return;
    }
    if (path === "/healthz") {
      response.writeHead(ready ? 200 : 503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ ready, version }));
      return;
    }

    await serveStatic(request, response, path);
  };
}
