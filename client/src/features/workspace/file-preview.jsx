import React, { useEffect, useRef, useState } from "react";
import { Download, File } from "lucide-react";

export function FilePreview({ path, kind }) {
  const media = useRef();
  const [attempt, retry] = useState(0);
  const [failed, setFailed] = useState(false);
  const url = "/api/files?" + new URLSearchParams({ path });
  const name = path.split("/").at(-1);
  const labels = { image: "图片", audio: "音频", video: "视频", pdf: "PDF" };
  const label = labels[kind] || "文件";
  const props = {
    src: url,
    "aria-label": name,
    onError: () => setFailed(true),
  };
  useEffect(() => {
    const element = media.current;
    return () => {
      if (!element) return;
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [attempt]);
  return (
    <div
      className={"file-preview file-preview-" + kind}
      aria-label={label + "预览"}
    >
      {kind === "image" ? (
        <img key={attempt} {...props} alt={name} />
      ) : kind === "audio" ? (
        <audio
          key={attempt}
          ref={media}
          {...props}
          controls
          preload="metadata"
        />
      ) : kind === "video" ? (
        <video
          key={attempt}
          ref={media}
          {...props}
          controls
          playsInline
          preload="metadata"
        />
      ) : kind === "pdf" ? (
        <object
          key={attempt}
          data={url}
          type="application/pdf"
          aria-label={name}
          onError={props.onError}
        >
          <p>可下载 PDF 后查看。</p>
        </object>
      ) : (
        <div className="file-download-info">
          <File size={32} strokeWidth={1.3} />
          <span>下载后使用对应应用打开</span>
        </div>
      )}
      {failed && (
        <div className="file-preview-error" role="status">
          <span>{label}加载失败，请重试或下载后查看。</span>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              retry(attempt + 1);
            }}
          >
            重试
          </button>
        </div>
      )}
      <a className="file-download" href={url + "&download=1"} download={name}>
        <Download size={15} aria-hidden="true" />
        下载文件
      </a>
    </div>
  );
}
