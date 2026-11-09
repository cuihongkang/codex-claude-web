// IndexedDB 的唯一主键写入在同源页面之间串行，刷新后仍保留轮次去重记录。
export async function claimCompletion(key) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("claudex-web-notifications", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("completions");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("通知记录暂时被其他页面占用"));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("completions", "readwrite");
      const request = transaction.objectStore("completions").add(true, key);
      let duplicate = false;
      request.onerror = (event) => {
        if (request.error.name === "ConstraintError") {
          event.preventDefault();
          event.stopPropagation();
          duplicate = true;
        }
      };
      transaction.oncomplete = () => resolve(!duplicate);
      transaction.onabort = () => reject(transaction.error || request.error);
    });
  } finally {
    database.close();
  }
}
