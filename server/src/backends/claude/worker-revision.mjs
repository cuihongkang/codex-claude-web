import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const loadedAt = Date.now();
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? files(path)
          : entry.name.endsWith(".mjs")
            ? [path]
            : [];
      }),
  );
  return nested.flat();
}
async function revision() {
  const paths = [
    ...(await files(join(root, "server", "src"))),
    ...(await files(join(root, "shared"))),
    join(root, "package.json"),
  ].sort();
  const content = await Promise.all(paths.map((path) => readFile(path)));
  const hash = createHash("sha256");
  paths.forEach((path, index) => {
    hash.update(relative(root, path));
    hash.update(content[index]);
  });
  return {
    loadedAt,
    entry: fileURLToPath(new URL("./worker-server.mjs", import.meta.url)),
    hash: hash.digest("hex"),
    version: JSON.parse(await readFile(join(root, "package.json"), "utf8"))
      .version,
  };
}
const current = revision();
export const workerRevision = () => current;
