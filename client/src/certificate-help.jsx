import React, { useEffect, useState } from "react";

const instructions = {
  Windows: [
    "打开下载的证书，选择“安装证书”，存储位置选择“当前用户”。",
    "选择“将所有的证书都放入下列存储”，然后选择“受信任的根证书颁发机构”，完成安装。",
    "完全退出浏览器后重新打开本站，确认地址栏的证书警告已消失，再登录。",
  ],
  macOS: [
    "打开下载的证书，将它添加到“钥匙串访问”的“登录”钥匙串。",
    "在钥匙串中打开这张证书，展开“信任”，将“安全套接字层（SSL）”设为“始终信任”，保存更改。",
    "重新打开浏览器访问本站，确认地址栏的证书警告已消失，再登录。",
  ],
  "iPhone / iPad": [
    "使用 Safari 下载证书，允许下载描述文件。",
    "打开“设置 → 通用 → VPN 与设备管理”，选择刚下载的证书描述文件并安装。",
    "打开“设置 → 通用 → 关于本机 → 证书信任设置”，为这张证书启用完全信任，然后重新打开本站。",
  ],
  Android: [
    "下载证书，在系统设置中搜索“安装证书”。",
    "选择“CA 证书”，按系统提示选择下载的文件并安装。不同手机的入口名称可能略有不同。",
    "重新打开浏览器访问本站，确认地址栏的证书警告已消失，再登录。",
  ],
};

export function CertificateHelp() {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState("Windows");
  const [certificate, setCertificate] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setCertificate(null);
    setError(false);
    fetch("/api/tls/info", { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("certificate unavailable");
        return response.json();
      })
      .then((value) => {
        if (!controller.signal.aborted) setCertificate(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [open, attempt]);
  return (
    <details
      className="certificate-help"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>浏览器证书安装</summary>
      {open && (
        <div className="certificate-content">
          <p>
            浏览器提示证书不受信任时，可在这台设备上安装本站证书。请先向网站管理员核对证书，再继续操作。
          </p>
          {error ? (
            <p role="alert">
              证书信息读取失败。
              <button onClick={() => setAttempt(attempt + 1)}>重试</button>
            </p>
          ) : !certificate ? (
            <p role="status">正在读取证书…</p>
          ) : (
            <>
              <details className="certificate-details">
                <summary>核对证书</summary>
                <p>请通过已有的联系方式向管理员取得指纹，核对一致后再安装。</p>
                <span>SHA-256 指纹</span>
                <code>{certificate.fingerprint}</code>
                <p>
                  有效期至{" "}
                  {new Date(certificate.validTo).toLocaleDateString("zh-CN")}
                </p>
              </details>
              <a
                className="certificate-download"
                href="/api/tls/certificate"
                download="codex-web.cer"
              >
                下载证书
              </a>
              {certificate.selfSigned ? (
                <>
                  <label className="field-label">
                    选择你的设备
                    <select
                      value={platform}
                      onChange={(event) => setPlatform(event.target.value)}
                    >
                      {Object.keys(instructions).map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <ol>
                    {instructions[platform].map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </>
              ) : (
                <p>
                  本站证书由证书机构签发。如仍有警告，请将警告内容提供给网站管理员，由管理员检查证书配置或提供所需的信任证书。
                </p>
              )}
              <a href="/" target="_blank" rel="noopener noreferrer">
                重新打开登录页
              </a>
            </>
          )}
          <details>
            <summary>首次访问被浏览器拦截怎么办？</summary>
            <p>
              先请管理员核对警告页面中的证书。确认一致后，可通过“高级 →
              继续访问”进入本站下载并安装证书。安装完成、警告消失后再填写密码。
            </p>
            <p>
              浏览器没有“继续访问”入口时，请管理员直接提供证书文件。安装后重新访问本站。
            </p>
          </details>
        </div>
      )}
    </details>
  );
}
