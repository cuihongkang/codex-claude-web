import React from "react";
import {
  File,
  FileArchive,
  FileAudio2,
  FileCode2,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileText,
  FileVideo2,
  Folder,
  Globe,
  Link,
  Mail,
  Presentation,
  Terminal,
} from "lucide-react";
import { filePresentation } from "../../../shared/file-types.mjs";

function PythonIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path
        fillRule="evenodd"
        d="M12 2C8 2 7 3 7 5v3h6v1H5c-2 0-3 2-3 5s1 5 3 5h2v-3c0-2 1-3 3-3h5c2 0 3-1 3-3V5c0-2-2-3-6-3ZM10 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"
      />
      <path
        fillRule="evenodd"
        transform="rotate(180 12 12)"
        d="M12 2C8 2 7 3 7 5v3h6v1H5c-2 0-3 2-3 5s1 5 3 5h2v-3c0-2 1-3 3-3h5c2 0 3-1 3-3V5c0-2-2-3-6-3ZM10 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"
      />
    </svg>
  );
}

export function pathIcon(href, { literal = false } = {}) {
  if (/^(?:https?:)?\/\//i.test(href)) return Globe;
  if (/^mailto:/i.test(href)) return Mail;
  if (href.startsWith("#") || /^[a-z][\w+.-]*:/i.test(href)) return Link;
  const path = literal
    ? href
    : href.split(/[?#]/)[0].replace(/:\d+(?::\d+)?$/, "");
  if (path.endsWith("/")) return Folder;
  const name = path.split("/").at(-1).toLowerCase();
  const extension = name.split(".").at(-1);
  if (/^(py|pyi|pyw|ipynb)$/.test(extension)) return PythonIcon;
  if (
    /^(js|jsx|ts|tsx|mjs|cjs|c|h|cc|cpp|cxx|hpp|hxx|cu|cuh|rs|go|java|kt|kts|cs|swift|rb|php|lua|r|sql|proto|vue|svelte|html|css|scss|sass|less|cmake)$/.test(
      extension,
    ) ||
    /^(makefile|dockerfile|cmakelists\.txt)$/.test(name)
  )
    return FileCode2;
  if (
    /^(json|jsonc|ya?ml|toml|xml|ini|conf|cfg|properties|env|gitignore|editorconfig)$/.test(
      extension,
    ) ||
    /^\.env\./.test(name)
  )
    return FileJson2;
  if (/^(md|mdx|txt|rst|pdf|docx?|odt|rtf)$/.test(extension)) return FileText;
  if (/^(csv|tsv|xlsx?|ods|parquet)$/.test(extension)) return FileSpreadsheet;
  if (/^(pptx?|odp|key)$/.test(extension)) return Presentation;
  const presentation = filePresentation(path);
  if (presentation?.kind === "image") return FileImage;
  if (presentation?.kind === "audio") return FileAudio2;
  if (presentation?.kind === "video") return FileVideo2;
  if (/^(zip|tar|gz|tgz|xz|bz2|7z|rar)$/.test(extension)) return FileArchive;
  if (/^(sh|bash|zsh|fish|ps1)$/.test(extension)) return Terminal;
  return File;
}
