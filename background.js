let inspectionRunning = false;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "inspect-follow") return;
  const handle = String(message.handle || "").replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    sendResponse({ ok: false, error: "账号名无效" });
    return;
  }
  if (inspectionRunning) {
    sendResponse({ ok: false, error: "已有关注状态检查正在运行" });
    return;
  }
  inspectionRunning = true;
  inspectFollow(handle).then((result) => {
    sendResponse({ ok: true, result });
  }).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "检查失败" });
  }).finally(() => {
    inspectionRunning = false;
  });
  return true;
});

async function inspectFollow(handle) {
  const tab = await chrome.tabs.create({ url: "https://x.com/" + handle, active: false });
  try {
    await waitForTab(tab.id);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "inspect-profile" });
        if (!response?.ok) throw new Error(response?.error || "无法读取主页");
        return response.status;
      } catch (error) {
        if (attempt === 3) throw error;
        await delay(500);
      }
    }
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error("主页加载超时")), 18000);
    const onUpdated = (changedId, info) => {
      if (changedId === tabId && info.status === "complete") finish();
    };
    const onRemoved = (removedId) => {
      if (removedId === tabId) finish(new Error("检查标签页已关闭"));
    };
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      error ? reject(error) : resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then((current) => {
      if (current.status === "complete") finish();
    }).catch(() => finish(new Error("检查标签页已关闭")));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
