export function keyEvent(extra) {
  return {
    key: "Enter",
    nativeEvent: { isComposing: false },
    preventDefault() {
      this.prevented = true;
    },
    ...extra,
  };
}
