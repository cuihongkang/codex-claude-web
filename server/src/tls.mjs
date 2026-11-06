import { migrateProductConfig } from "./product-config.mjs";
import { migrateWebDirectory } from "./web-config-migration.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, rm, mkdtemp } from "node:fs/promises";
import { hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";

const execute = promisify(execFile);
export function localTlsClient(cert) {
  const fingerprint = new X509Certificate(cert).fingerprint256;
  return {
    ca: cert,
    allowPartialTrustChain: true,
    checkServerIdentity(_hostname, peer) {
      if (peer.fingerprint256 !== fingerprint)
        return new Error("本机网页服务证书与配置不匹配");
    },
  };
}
export async function readTls(config) {
  await migrateProductConfig(config);
  if (config.tlsCert)
    return {
      cert: await readFile(config.tlsCert),
      key: await readFile(config.tlsKey),
      minVersion: "TLSv1.2",
    };
  await migrateWebDirectory(config, "tls", [
    "certificate.pem",
    "private-key.pem",
  ]);
  const parent = config.configDir;
  const directory = join(parent, "tls");
  const certificate = join(directory, "certificate.pem");
  const key = join(directory, "private-key.pem");
  try {
    await readFile(certificate);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(parent, ".tls-"));
    const names = new Set(["DNS:localhost", "IP:127.0.0.1", "IP:::1"]);
    if (/^[a-zA-Z0-9.-]+$/.test(hostname())) names.add(`DNS:${hostname()}`);
    for (const addresses of Object.values(networkInterfaces()))
      for (const { address } of addresses || [])
        if (!address.includes("%")) names.add(`IP:${address}`);
    try {
      await execute(
        "/usr/bin/openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "365",
          "-subj",
          "/CN=Claudex Web",
          "-addext",
          `subjectAltName=${[...names].join(",")}`,
          "-keyout",
          join(temporary, "private-key.pem"),
          "-out",
          join(temporary, "certificate.pem"),
        ],
        { timeout: 15000 },
      );
      try {
        await rename(temporary, directory);
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  const cert = await readFile(certificate);
  const parsed = new X509Certificate(cert);
  if (Date.parse(parsed.validTo) <= Date.now())
    throw new Error(
      "自动生成的 HTTPS 证书已过期，请配置 TLS_CERT 与 TLS_KEY，或按部署文档重新生成证书。",
    );
  return { cert, key: await readFile(key), minVersion: "TLSv1.2" };
}
