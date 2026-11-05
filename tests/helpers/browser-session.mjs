export function serveDemoSession(request, response) {
  if (request.url !== "/api/auth/session") return false;
  response
    .writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    })
    .end(
      JSON.stringify({
        authenticated: true,
        username: "demo",
        expiresAt: Date.now() + 86400000,
      }),
    );
  return true;
}
