import { defaultUrlTransform } from "react-markdown";

const imageTypes = {
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

export function localImagePath(source, cwd = "") {
  if (!source || source.startsWith("//")) return null;
  let path = source;
  if (/^file:\/\//i.test(path)) {
    const url = new URL(path);
    if (url.hostname && url.hostname !== "localhost") return null;
    path = url.pathname;
  } else if (path.startsWith("sandbox:/")) path = path.slice("sandbox:".length);
  else if (/^[a-z][\w+.-]*:/i.test(path)) return null;
  path = path.split(/[?#]/)[0];
  if (!path) return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    // 未编码的百分号也可以是文件名的一部分。
  }
  if (!path.startsWith("/")) {
    if (!cwd) return null;
    path = cwd + "/" + path;
  }
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}

export function imageDataUrl(path, dataBase64) {
  const ext = path.split(".").at(-1).toLowerCase();
  return `data:${imageTypes[ext] || "application/octet-stream"};base64,${dataBase64}`;
}

export function messageUrlTransform(value, key, node) {
  if (
    node.tagName === "a" &&
    key === "href" &&
    (/^file:\/\/(?:localhost)?\//i.test(value) || value.startsWith("sandbox:/"))
  )
    return value;
  if (
    node.tagName === "img" &&
    key === "src" &&
    (/^file:\/\/(?:localhost)?\//i.test(value) ||
      value.startsWith("sandbox:/") ||
      /^data:image\/(?:png|apng|jpe?g|gif|webp|svg\+xml|avif|bmp|x-icon);base64,[a-z\d+/=\s]+$/i.test(
        value,
      ))
  )
    return value;
  return defaultUrlTransform(value);
}
