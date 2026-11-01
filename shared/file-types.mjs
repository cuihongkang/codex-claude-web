const previews = {
  image: {
    png: "image/png",
    apng: "image/apng",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    jfif: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
    tif: "image/tiff",
    tiff: "image/tiff",
  },
  audio: {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    wave: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    wma: "audio/x-ms-wma",
    amr: "audio/amr",
    mid: "audio/midi",
    midi: "audio/midi",
  },
  video: {
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    ogv: "video/ogg",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    mpg: "video/mpeg",
    mpeg: "video/mpeg",
    mts: "video/mp2t",
    m2ts: "video/mp2t",
    "3gp": "video/3gpp",
    "3g2": "video/3gpp2",
    flv: "video/x-flv",
    wmv: "video/x-ms-wmv",
  },
  pdf: { pdf: "application/pdf" },
};
const downloads = new Set(
  "doc docx docm dot dotx odt xls xlsx xlsm xlsb ods ppt pptx pptm odp pages numbers key zip tar gz tgz xz bz2 7z rar zst br jar apk deb rpm exe dll so dylib wasm bin iso img dmg db sqlite sqlite3 parquet arrow feather npy npz h5 hdf5 pkl pickle pt pth onnx psd ai eps woff woff2 ttf otf".split(
    " ",
  ),
);

export function filePresentation(path) {
  const name = path.split("/").at(-1).toLowerCase();
  const extension = name.includes(".") ? name.split(".").at(-1) : "";
  for (const [kind, types] of Object.entries(previews))
    if (types[extension]) return { kind, mime: types[extension] };
  return downloads.has(extension)
    ? { kind: "download", mime: "application/octet-stream" }
    : null;
}

export function decodeTextFile(bytes) {
  if (
    bytes.some(
      (byte) =>
        byte === 0 || (byte < 32 && ![9, 10, 12, 13, 27].includes(byte)),
    )
  )
    return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
