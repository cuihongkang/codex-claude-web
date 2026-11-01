import React from "react";

export function VersionDetails() {
  return (
    <p className="version-details">Codex Web · {__CODEX_WEB_BUILD__.version}</p>
  );
}
