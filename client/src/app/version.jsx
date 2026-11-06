import React from "react";

export function VersionDetails() {
  return (
    <p className="version-details">
      Claudex Web · {__CLAUDEX_WEB_BUILD__.version}
    </p>
  );
}
