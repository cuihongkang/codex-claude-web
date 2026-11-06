import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { readTls, localTlsClient } from "../src/tls.mjs";

test("证书原子生成、并发启动、重新读取和私钥权限", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "claudex-web-tls-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const [first, second] = await Promise.all([
    readTls({
      configDir: directory,
      claudeHome: join(directory, ".claude"),
      codexHome: directory,
    }),
    readTls({
      configDir: directory,
      claudeHome: join(directory, ".claude"),
      codexHome: directory,
    }),
  ]);
  assert.deepEqual(first.cert, second.cert);
  assert.deepEqual(first.key, second.key);
  assert.equal(first.minVersion, "TLSv1.2");
  const certificate = new X509Certificate(first.cert);
  const localClient = localTlsClient(first.cert);
  assert.equal(
    localClient.checkServerIdentity("127.0.0.1", {
      fingerprint256: certificate.fingerprint256,
    }),
    undefined,
  );
  assert(
    localClient.checkServerIdentity("127.0.0.1", {
      fingerprint256: "different certificate",
    }) instanceof Error,
  );
  assert(certificate.checkPrivateKey(createPrivateKey(first.key)));
  assert.equal(certificate.checkIP("127.0.0.1"), "127.0.0.1");
  assert.equal(certificate.checkHost("localhost"), "localhost");
  assert.equal(certificate.checkIP("::1"), "::1");
  assert.equal((await stat(join(directory, "tls"))).mode & 0o777, 0o700);
  assert.equal(
    (await stat(join(directory, "tls/private-key.pem"))).mode & 0o777,
    0o600,
  );
  const again = await readTls({
    configDir: directory,
    claudeHome: join(directory, ".claude"),
    codexHome: directory,
  });
  assert.deepEqual(again, first);
  const custom = await readTls({
    tlsCert: join(directory, "tls/certificate.pem"),
    tlsKey: join(directory, "tls/private-key.pem"),
  });
  assert.deepEqual(custom, first);
  assert(!(await readdir(directory)).some((name) => name.startsWith(".tls-")));
  await assert.rejects(
    readTls({
      tlsCert: join(directory, "missing"),
      tlsKey: join(directory, "missing-key"),
    }),
    /ENOENT/,
  );
  assert(
    (await readFile(join(directory, "tls/certificate.pem"), "utf8")).includes(
      "BEGIN CERTIFICATE",
    ),
  );
});
