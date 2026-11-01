import { readConfig } from "./config.mjs";
import { readTls } from "./tls.mjs";
import { createAuthentication } from "./auth.mjs";
import { readVersion } from "./version.mjs";
import { createWebApplication } from "./application.mjs";
const config = readConfig();
const tls = await readTls(config);
const authentication = await createAuthentication(config);
const application = createWebApplication({
  config,
  tls,
  authentication,
  version: readVersion(),
});
await application.start();
console.log(
  `Codex web listening on https://${config.host}:${application.server.address().port}`,
);
