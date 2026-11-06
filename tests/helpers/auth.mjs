import https from "node:https";
import { gunzipSync } from "node:zlib";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { readTls, localTlsClient } from "../../server/src/tls.mjs";

export async function authenticationFixture(directory) {
  const tls = await readTls({
    configDir: directory,
    claudeHome: join(directory, ".claude"),
    codexHome: directory,
  });
  const authDirectory = join(directory, "auth");
  await mkdir(authDirectory, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("base64url");
  const id = createHash("sha256").update(token).digest("hex");
  const session = {
    username: userInfo().username,
    expiresAt: Date.now() + 86400000,
  };
  await writeFile(
    join(authDirectory, "sessions.json"),
    JSON.stringify([[id, session]]),
    { mode: 0o600 },
  );
  await writeFile(
    join(authDirectory, "maintenance-token"),
    "fixture-maintenance-token",
    { mode: 0o600 },
  );
  const pamtester = join(directory, "pamtester-fixture");
  await writeFile(
    pamtester,
    `#!${process.execPath}
const args = process.argv.slice(2);
if (JSON.stringify(args) !== JSON.stringify(['login', ${JSON.stringify(userInfo().username)}, 'authenticate(PAM_SILENT|PAM_DISALLOW_NULL_AUTHTOK)', 'acct_mgmt(PAM_SILENT)'])) process.exit(3);
let input = ''; for await (const chunk of process.stdin) input += chunk;
if (input === 'unavailable\\n') process.kill(process.pid, 'SIGTERM');
process.exit(input === 'fixture-password\\n' ? 0 : 1);
`,
    { mode: 0o700 },
  );
  return {
    tls,
    cookie: `__Host-codex-web-session=${token}`,
    pamtester,
    authDirectory,
    id,
    session,
  };
}
export function httpsFetch(ca, cookie = "") {
  return (url, options = {}) =>
    new Promise((resolve, reject) => {
      const request = https.request(
        url,
        {
          ...localTlsClient(ca),
          method: options.method || "GET",
          headers: {
            ...(cookie ? { Cookie: cookie, Origin: new URL(url).origin } : {}),
            ...options.headers,
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("error", reject);
          response.on("end", () =>
            resolve(
              new Response(
                [204, 304].includes(response.statusCode) ||
                  options.method === "HEAD"
                  ? null
                  : response.headers["content-encoding"] === "gzip"
                    ? gunzipSync(Buffer.concat(chunks))
                    : Buffer.concat(chunks),
                { status: response.statusCode, headers: response.headers },
              ),
            ),
          );
        },
      );
      request.on("error", reject);
      request.end(options.body);
    });
}
