import { parseXUrls } from "./url-utils.js";

const MAX_FOLLOWS_PER_BATCH = 10;
const PAGE_TIMEOUT_MS = 18000;
const PROFILE_GAP_MS = 3500;
const PROFILE_GAP_JITTER_MS = 1800;
const LONG_PAUSE_EVERY = 15;
const LONG_PAUSE_MS = 20000;
const MAX_CONSECUTIVE_ERRORS = 3;

let activeJob = null;
let activeRunPromise = null;

chrome.storage.local.get("activeJob").then(({ activeJob: savedJob }) => {
  if (!activeJob && savedJob?.status === "running") activeJob = savedJob;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "run-job") {
    if (activeJob?.status === "running") {
      sendResponse({ ok: false, error: "已有任务正在运行" });
      return;
    }

    const urls = parseXUrls(message.urls || []);
    if (!urls.length) {
      sendResponse({ ok: false, error: "没有可用的 X 主页地址" });
      return;
    }

    activeJob = {
      id: crypto.randomUUID(),
      mode: message.mode === "follow" ? "follow" : "scan",
      urls,
      remainingUrls: urls.slice(),
      status: "running",
      current: 0,
      followed: 0,
      attempted: 0,
      consecutiveErrors: 0,
      phase: "starting",
      startedAt: new Date().toISOString(),
      results: []
    };
    persistJob();
    activeRunPromise = runJob(activeJob).catch((error) => finishJobWithError(error)).finally(() => {
      activeRunPromise = null;
    });
    sendResponse({ ok: true, jobId: activeJob.id });
    return true;
  }

  if (message?.type === "get-job") {
    sendResponse({ job: activeJob });
    return true;
  }

  if (message?.type === "stop-job") {
    stopActiveJob(sendResponse);
    return true;
  }
});

async function runJob(job) {
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  job.workerTabId = tab.id;
  persistJob();

  try {
    for (let index = 0; index < job.urls.length; index += 1) {
      if (job.cancelRequested) {
        appendQueuedResults(job, index, "已手动停止，未处理");
        job.status = "stopped";
        break;
      }
      if (job.mode === "follow" && job.attempted >= MAX_FOLLOWS_PER_BATCH) {
        appendQueuedResults(job, index, "本批次已达 10 个关注上限");
        break;
      }

      await waitBetweenProfiles(job, index);
      if (job.cancelRequested) {
        appendQueuedResults(job, index, "已手动停止，未处理");
        job.status = "stopped";
        break;
      }
      job.current = index + 1;
      job.phase = "loading";
      const url = job.urls[index];
      const shouldFollow = job.mode === "follow" && job.attempted < MAX_FOLLOWS_PER_BATCH;
      broadcast({ type: "job-progress", job });
      persistJob();

      let result;
      try {
        result = await inspectUrl(tab.id, url, shouldFollow);
      } catch (error) {
        if (job.cancelRequested) {
          appendQueuedResults(job, index, "已手动停止，未处理");
          job.status = "stopped";
          break;
        }
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
      if (["error", "unavailable", "failed"].includes(result.status)) {
        job.consecutiveErrors += 1;
      } else {
        job.consecutiveErrors = 0;
      }
      await rememberFollowedResult(job, result);
      job.results.push(result);
      broadcast({ type: "job-progress", job });
      persistJob();

      if (job.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        appendQueuedResults(job, index + 1, "检测连续异常，已自动暂停保护 X 会话");
        job.status = "paused";
        job.error = "连续 3 个主页无法读取，任务已暂停。请等待 X 恢复后再继续。";
        break;
      }
    }

    await finalizeJob(job);
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      // The worker tab may already be closed by the user.
    }
    delete job.workerTabId;
    persistJob();
  }
}

async function inspectUrl(tabId, url, shouldFollow) {
  await navigateAndWait(tabId, url);
  const response = await sendToTab(tabId, {
    type: "inspect-profile",
    follow: shouldFollow
  });
  if (!response?.ok) throw new Error(response?.message || "无法读取主页状态");
  return { url, ...response.data };
}

function navigateAndWait(tabId, url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error("页面加载超时")), PAGE_TIMEOUT_MS);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) finish(new Error("标签页已关闭"));
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
    chrome.tabs.update(tabId, { url }).catch(() => finish(new Error("标签页已关闭")));
  });
}

async function waitBetweenProfiles(job, index) {
  if (index === 0) return;
  const isLongPause = index % LONG_PAUSE_EVERY === 0;
  const waitMs = isLongPause ? LONG_PAUSE_MS : PROFILE_GAP_MS + Math.floor(Math.random() * PROFILE_GAP_JITTER_MS);
  job.phase = "cooldown";
  job.nextActionAt = new Date(Date.now() + waitMs).toISOString();
  broadcast({ type: "job-progress", job });
  persistJob();
  await waitForDuration(waitMs, job);
}

function waitForDuration(durationMs, job) {
  return new Promise((resolve) => {
    const deadline = Date.now() + durationMs;
    const tick = () => {
      if (job.cancelRequested || Date.now() >= deadline) {
        resolve();
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

function appendQueuedResults(job, startIndex, message) {
  for (let index = startIndex; index < job.urls.length; index += 1) {
    const url = job.urls[index];
    job.results.push({
      url,
      handle: handleFromUrl(url),
      status: "queued",
      message
    });
  }
  job.current = job.urls.length;
}

async function rememberFollowedResult(job, result) {
  if (!["following", "followed"].includes(result.status)) return;
  const remainingUrls = Array.isArray(job.remainingUrls) ? job.remainingUrls : job.urls.slice();
  job.remainingUrls = remainingUrls.filter((url) => url !== result.url);
  await chrome.storage.local.set({ draftUrls: job.remainingUrls.join("\n") });
}

async function finalizeJob(job) {
  if (job.status !== "paused" && job.status !== "stopped") job.status = "complete";
  job.phase = job.status;
  job.completedAt = new Date().toISOString();
  if (job.mode === "follow") {
    await chrome.storage.local.set({ lastBatchAt: job.completedAt });
  }
  await chrome.storage.local.set({
    lastResults: job.results,
    lastMode: job.mode,
    draftUrls: (job.remainingUrls || job.urls).join("\n")
  });
  persistJob();
  const eventType = job.status === "paused" ? "job-paused" : job.status === "stopped" ? "job-stopped" : "job-complete";
  broadcast({ type: eventType, job });
}

async function stopActiveJob(sendResponse) {
  if (!activeJob) {
    const saved = await chrome.storage.local.get("activeJob");
    activeJob = saved.activeJob || null;
  }
  if (activeJob?.status !== "running") {
    sendResponse({ ok: false, error: "当前没有正在运行的任务" });
    return;
  }

  activeJob.cancelRequested = true;
  activeJob.phase = "stopping";
  persistJob();
  if (activeJob.workerTabId) {
    chrome.tabs.remove(activeJob.workerTabId).catch(() => {
      // The worker tab may already be closed.
    });
  }

  if (!activeRunPromise) {
    appendQueuedResults(activeJob, activeJob.results?.length || 0, "已手动停止，未处理");
    activeJob.status = "stopped";
    activeJob.error = "任务已手动停止，已完成结果已保留";
    await finalizeJob(activeJob);
    delete activeJob.workerTabId;
    persistJob();
  } else {
    broadcast({ type: "job-progress", job: activeJob });
  }
  sendResponse({ ok: true });
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
