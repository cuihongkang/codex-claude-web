import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL("../client/src/assets/claudex-web.svg", import.meta.url),
);
const output = fileURLToPath(new URL("../client/public/", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "claudex-web-icons-"));
try {
  await mkdir(output, { recursive: true });
  const images = new Map();
  for (const size of [16, 32, 48, 96, 180]) {
    const path = join(temporary, `${size}.png`);
    execFileSync("gdk-pixbuf-thumbnailer", ["-s", String(size), source, path]);
    images.set(size, await readFile(path));
  }
  await writeFile(join(output, "favicon.png"), images.get(96));
  await writeFile(join(output, "apple-touch-icon.png"), images.get(180));

  // ICO 使用一个目录和三个 PNG 位图，分别对应 16、32、48 像素。
  const sizes = [16, 32, 48];
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images.get(size).length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images.get(size).length;
  }
  await writeFile(
    join(output, "favicon.ico"),
    Buffer.concat([directory, ...sizes.map((size) => images.get(size))]),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
