// 发布通道仅接受稳定版及带递增序号的 alpha、beta、rc 版本。
export const releaseVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;

export function compareReleaseVersions(left, right) {
  const key = (version) => {
    const [, major, minor, patch, stage, sequence] =
      version.match(releaseVersion);
    return [
      major,
      minor,
      patch,
      stage ? ["alpha", "beta", "rc"].indexOf(stage) : 3,
      sequence || 0,
    ].map(Number);
  };
  const a = key(left),
    b = key(right);
  const index = a.findIndex((value, i) => value !== b[i]);
  return index < 0 ? 0 : Math.sign(a[index] - b[index]);
}

export function releaseFlags(tag) {
  return tag.includes("-")
    ? ["--prerelease", "--latest=false"]
    : ["--prerelease=false", "--latest"];
}
