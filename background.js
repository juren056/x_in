const MAX_FOLLOWS_PER_BATCH = 10;
const PAGE_TIMEOUT_MS = 18000;

let activeJob = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "run-job") {
    if (activeJob?.status === "running") {
      sendResponse({ ok: false, error: "已有任务正在运行" });
      return;
    }

    const urls = normalizeUrls(message.urls || []);
    if (!urls.length) {
      sendResponse({ ok: false, error: "没有可用的 X 主页地址" });
      return;
    }

    activeJob = {
      id: crypto.randomUUID(),
      mode: message.mode === "follow" ? "follow" : "scan",
      urls,
      status: "running",
      current: 0,
      followed: 0,
      attempted: 0,
      startedAt: new Date().toISOString(),
      results: []
    };
    persistJob();
    runJob(activeJob).catch((error) => finishJobWithError(error));
    sendResponse({ ok: true, jobId: activeJob.id });
    return true;
  }

  if (message?.type === "get-job") {
    sendResponse({ job: activeJob });
    return true;
  }
});

async function runJob(job) {
  for (let index = 0; index < job.urls.length; index += 1) {
    job.current = index + 1;
    const url = job.urls[index];
    const shouldFollow = job.mode === "follow" && job.attempted < MAX_FOLLOWS_PER_BATCH;
    broadcast({ type: "job-progress", job });
    persistJob();

    let result;
    try {
      result = await inspectUrl(url, shouldFollow);
    } catch (error) {
      result = {
        url,
        handle: handleFromUrl(url),
        status: "error",
        message: error instanceof Error ? error.message : "页面检测失败"
      };
    }

    if (job.mode === "follow" && result.status === "not-following" && !shouldFollow) {
      result.status = "queued";
      result.message = "本批次已达 10 个上限";
    }
    if (result.status === "followed") {
      job.followed += 1;
      job.attempted += 1;
    } else if (result.status === "failed" && shouldFollow) {
      job.attempted += 1;
    }
    job.results.push(result);
    broadcast({ type: "job-progress", job });
    persistJob();
  }

  job.status = "complete";
  job.completedAt = new Date().toISOString();
  if (job.mode === "follow") {
    await chrome.storage.local.set({ lastBatchAt: job.completedAt });
  }
  await chrome.storage.local.set({ lastResults: job.results, lastMode: job.mode });
  persistJob();
  broadcast({ type: "job-complete", job });
}

async function inspectUrl(url, shouldFollow) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabLoad(tab.id);
    const response = await sendToTab(tab.id, {
      type: "inspect-profile",
      follow: shouldFollow
    });
    if (!response?.ok) throw new Error(response?.message || "无法读取主页状态");
    return { url, ...response.data };
  } finally {
    if (tab.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // The tab may already be closed by the user.
      }
    }
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error("页面加载超时")), PAGE_TIMEOUT_MS);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch(() => finish(new Error("标签页已关闭")));
  });
}

async function sendToTab(tabId, message) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
  }
  throw new Error(lastError?.message || "无法连接 X 页面");
}

function normalizeUrls(urls) {
  return [...new Set(urls.map((value) => {
    try {
      const candidate = new URL(value.trim());
      if (!/^https?:$/.test(candidate.protocol) || !/^(www\.)?(x\.com|twitter\.com)$/i.test(candidate.hostname)) return null;
      const [handle] = candidate.pathname.split("/").filter(Boolean);
      if (!handle || ["home", "explore", "notifications", "messages", "i", "settings"].includes(handle.toLowerCase())) return null;
      return `https://x.com/${handle.replace(/^@/, "")}`;
    } catch {
      return null;
    }
  }).filter(Boolean))];
}

function handleFromUrl(url) {
  return url.split("/").filter(Boolean).pop() || "未知账号";
}

function persistJob() {
  if (!activeJob) return;
  chrome.storage.local.set({ activeJob });
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup may not be open while a job continues in the background.
  });
}

function finishJobWithError(error) {
  if (!activeJob) return;
  activeJob.status = "error";
  activeJob.error = error instanceof Error ? error.message : "任务失败";
  persistJob();
  broadcast({ type: "job-error", job: activeJob });
}
