// 移除登录表单前，通过页面导航事件和密码管理接口通知浏览器登录成功。
export function completePasswordLogin(username, password) {
  window.history.replaceState(window.history.state, "", window.location.href);
  if (!window.PasswordCredential || !navigator.credentials?.store) return;
  try {
    const credential = new window.PasswordCredential({
      id: username,
      password,
    });
    // 密码保存由浏览器处理，等待确认或拒绝保存均不影响进入工作空间。
    navigator.credentials.store(credential).catch(() => {});
  } catch {
    // 浏览器可能提供接口但禁止保存密码，登录结果仍然有效。
  }
}
