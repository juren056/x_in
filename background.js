import { filterNotFollowingUrls, normalizeHandle, parseXUrls } from "./url-utils.js";
import { appendReplyCandidates, discoverReplyCandidates, postsSinceReplyClear } from "./reply-rules.js";
import { MAX_REPLIES_PER_BATCH, selectPendingReplies, updateReplyCandidate } from "./reply-batch.js";
import { mergeAuditPosts, labelAuditPost, buildFeedbackExport, restoreAuditData } from "./audit-data.js";

const MAX_FOLLOWS_PER_BATCH = 10;
const PAGE_TIMEOUT_MS = 18000;
const PROFILE_GAP_MS = 3500;
const PROFILE_GAP_JITTER_MS = 1800;
const LONG_PAUSE_EVERY = 15;
const LONG_PAUSE_MS = 20000;
const MAX_CONSECUTIVE_ERRORS = 3;

let activeJob = null;
let activeRunPromise = null;
let activeTimelinePromise = null;
let activeReplyRun = null;
let replyStartPending = false;
let activeReplyJob = null;

chrome.storage.local.get("activeJob").then(({ activeJob: savedJob }) => {
  if (!activeJob && savedJob?.status === "running") activeJob = savedJob;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "run-reply-batch") {
    startReplyBatch(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "评论批次启动失败" });
    });
    return true;
  }
  if (message?.type === "clear-reply-history") {
    if (activeRunPromise || activeJob?.status === "running" || activeTimelinePromise || activeReplyRun || replyStartPending) {
      sendResponse({ ok: false, error: "请等待当前任务结束后再清零" });
      return true;
    }
    chrome.storage.local.set({
      replyCandidates: [],
      replyClearedAt: new Date().toISOString(),
      activeReplyJob: null
    }).then(() => {
      activeReplyJob = null;
      broadcast({ type: "reply-candidate" });
      sendResponse({ ok: true });
    }).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "清零失败" });
    });
    return true;
  }  if (message?.type === "get-reply-batch") {
    getReplyBatch().then(async (job) => {
      await backfillReplyCandidates();
      sendResponse({ job });
    }).catch((error) => sendResponse({ error: error instanceof Error ? error.message : "待回复列表同步失败" }));
    return true;
  }
  if (message?.type === "stop-reply-batch") {
    if (!activeReplyJob || activeReplyJob.status !== "running") {
      sendResponse({ ok: false, error: "当前没有评论批次" });
    } else {
      activeReplyJob.cancelRequested = true;
      sendResponse({ ok: true });
    }
    return true;
  }
  if (message?.type === "clear-audit-history") {
    if (activeRunPromise || activeJob?.status === "running" || activeTimelinePromise || activeReplyRun || replyStartPending) {
      sendResponse({ ok: false, error: "请等待当前任务结束后再清零" });
      return true;
    }
    chrome.storage.local.set({ auditPosts: [], auditClearedAt: new Date().toISOString() })
      .then(() => { broadcast({ type: "audit-updated" }); sendResponse({ ok: true }); })
      .catch((error) => sendResponse({ ok: false, error: error.message || "清零失败" }));
    return true;
  }
  if (message?.type === "audit-load") {
    loadAuditFile().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "audit-info") {
    nativeAudit({ action: "info", path: message.path || "" }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "audit-label") {
    saveAuditLabel(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "audit-set-path") {
    setAuditPath(message.path).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "audit-export") {
    exportAudit().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "collect-timeline") {
    if (activeJob?.status === "running" || activeReplyRun || replyStartPending) {
      sendResponse({ ok: false, error: "请先等待当前巡检任务结束" });
      return;
    }
    if (activeTimelinePromise) {
      sendResponse({ ok: false, error: "正在读取为你推荐，请等待完成" });
      return;
    }
    const scrollLimit = message.scrollLimit == null ? 30 : Number(message.scrollLimit);
    if (!Number.isInteger(scrollLimit) || scrollLimit < 1 || scrollLimit > 200) {
      sendResponse({ ok: false, error: "滚动次数须为 1–200 的整数" });
      return true;
    }
    activeTimelinePromise = collectTimeline(scrollLimit, message.mode === "current" ? "current" : "background");
    activeTimelinePromise.then((data) => {
      sendResponse({ ok: true, ...data });
    }).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "读取为你推荐失败" });
    }).finally(() => {
      activeTimelinePromise = null;
    });
    return true;
  }
  if (message?.type === "run-job") {
    if (activeReplyRun) {
      sendResponse({ ok: false, error: "请先等待评论批次结束" });
      return;
    }
    if (activeTimelinePromise) {
      sendResponse({ ok: false, error: "请先等待为你推荐读取完成" });
      return;
    }
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
      replyAssistEnabled: message.replyAssistEnabled !== false,
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
    const replyConfig = await chrome.storage.local.get(["timelinePosts", "replyClearedAt"]);
    job.phase = "syncing";
    broadcast({ type: "job-progress", job });
    let followingHandles;
    try {
      followingHandles = await syncFollowing(tab.id);
    } catch (error) {
      if (job.cancelRequested) {
        job.status = "stopped";
        job.error = "任务已手动停止，已完成结果已保留";
        await finalizeJob(job);
        return;
      }
      throw error;
    }
    job.followingHandles = followingHandles;
    if (job.replyAssistEnabled) {
      const storedReplies = await chrome.storage.local.get("replyCandidates");
      const candidates = Array.isArray(storedReplies.replyCandidates) ? storedReplies.replyCandidates : [];
      const updated = discoverReplyCandidates(candidates, postsSinceReplyClear(replyConfig.timelinePosts, replyConfig.replyClearedAt), followingHandles);
      if (JSON.stringify(updated) !== JSON.stringify(candidates)) {
        await chrome.storage.local.set({ replyCandidates: updated });
        broadcast({ type: "reply-candidate" });
      }
    }
    job.remainingUrls = filterNotFollowingUrls(job.urls, followingHandles);
    job.pendingUrls = job.remainingUrls.slice();
    job.pendingIndex = 0;
    job.results = job.urls
      .filter((url) => !job.pendingUrls.includes(url))
      .map((url) => ({ url, handle: `@${handleFromUrl(url)}`, status: "following", message: "已在我的关注列表" }));
    await chrome.storage.local.set({ draftUrls: job.remainingUrls.join("\n"), followingHandles, followingSyncedAt: new Date().toISOString() });
    broadcast({ type: "job-progress", job });
    persistJob();

    for (let index = 0; index < job.pendingUrls.length; index += 1) {
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
      job.current = job.results.length + 1;
      job.phase = "loading";
      const url = job.pendingUrls[index];
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
      if (["following", "followed"].includes(result.status) && job.replyAssistEnabled) {
        try {
          await queueReplyCandidate(result, postsSinceReplyClear(replyConfig.timelinePosts, replyConfig.replyClearedAt));
        } catch {
          result.replyNote = "待回复列表保存失败";
        }
      }
      job.results.push(result);
      job.pendingIndex = index + 1;
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

async function syncFollowing(tabId) {
  await navigateAndWait(tabId, "https://x.com/home");
  const profile = await sendToTab(tabId, { type: "discover-own-handle" });
  if (!profile?.ok || !profile.handle) {
    throw new Error(profile?.message || "无法识别当前登录账号");
  }
  await navigateAndWait(tabId, `https://x.com/${profile.handle}/following`);
  const response = await sendToTab(tabId, { type: "collect-following" });
  if (!response?.ok || !Array.isArray(response.handles)) {
    throw new Error(response?.message || "无法读取我的关注列表");
  }
  return response.handles.map(normalizeHandle);
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
  const pendingUrls = job.pendingUrls || job.urls;
  for (let index = startIndex; index < pendingUrls.length; index += 1) {
    const url = pendingUrls[index];
    job.results.push({
      url,
      handle: handleFromUrl(url),
      status: "queued",
      message
    });
  }
  job.pendingIndex = pendingUrls.length;
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
    appendQueuedResults(activeJob, activeJob.pendingIndex || 0, "已手动停止，未处理");
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

async function sendToTab(tabId, message, retry = true) {
  let lastError;
  for (let attempt = 0; attempt < (retry ? 4 : 1); attempt += 1) {
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

async function collectTimeline(scrollLimit, mode = "background") {
  await chrome.storage.local.set({ timelineScan: { status: "running", mode, scrollLimit, startedAt: new Date().toISOString() } });
  let tab;
  let ownedTab = false;
  try {
    if (mode === "current") {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https:\/\/(?:x\.com|twitter\.com)\/home(?:[/?#]|$)/i.test(tab.url || "")) {
        throw new Error("请先在当前标签页打开 X 首页，再点击当前页采集");
      }
    } else {
      tab = await chrome.tabs.create({ url: "about:blank", active: false });
      ownedTab = true;
      await chrome.tabs.update(tab.id, { autoDiscardable: false });
      await navigateAndWait(tab.id, "https://x.com/home");
    }
    const response = await sendToTab(tab.id, { type: "collect-for-you", scrollLimit });
    if (!response?.ok) throw new Error(response?.message || "无法读取为你推荐");
    const handles = [...new Set(response.handles.map(normalizeHandle))];
    const urls = handles.map((handle) => "https://x.com/" + handle);
    const saved = await chrome.storage.local.get(["draftUrls", "timelinePosts", "replyCandidates", "replyAssistEnabled", "followingHandles", "lastResults", "replyClearedAt", "auditPosts"]);
    const seen = new Set();
    const merged = parseXUrls([saved.draftUrls || "", ...urls]).filter((url) => {
      const key = url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const postMap = new Map();
    for (const post of saved.timelinePosts || []) {
      if (post?.postUrl) postMap.set(post.postUrl, post);
    }
    const collectedAt = new Date().toISOString();
    for (const post of response.posts || []) {
      if (post?.postUrl) postMap.set(post.postUrl, { ...post, collectedAt });
    }
    const allPosts = [...postMap.values()];
    const auditPosts = mergeAuditPosts(saved.auditPosts || [], response.posts || [], collectedAt);
    const freshPosts = postsSinceReplyClear(allPosts, saved.replyClearedAt);
    const following = [
      ...(saved.followingHandles || []),
      ...((saved.lastResults || []).filter((item) => ["following", "followed"].includes(item.status)).map((item) => item.handle))
    ];
    const candidates = Array.isArray(saved.replyCandidates) ? saved.replyCandidates : [];
    const updatedCandidates = saved.replyAssistEnabled !== false
      ? discoverReplyCandidates(candidates, freshPosts, following) : candidates;
    await chrome.storage.local.set({
      draftUrls: merged.join("\n"),
      timelinePosts: allPosts,
      auditPosts,
      replyCandidates: updatedCandidates,
      lastTimelineAt: new Date().toISOString(),
      timelineScan: { status: response.stopReason === "limit" ? "complete" : "partial", mode, scrollLimit,
        found: urls.length, total: merged.length, scannedPosts: response.scannedPosts,
        rounds: response.rounds, stopReason: response.stopReason,
        visibilityState: response.visibilityState, scrollDistance: response.scrollDistance,
        completedAt: new Date().toISOString() }
    });
    if (JSON.stringify(updatedCandidates) !== JSON.stringify(candidates)) broadcast({ type: "reply-candidate" });
    return { urls, scannedPosts: response.scannedPosts, rounds: response.rounds,
      scrollLimit, stopReason: response.stopReason, visibilityState: response.visibilityState,
      scrollDistance: response.scrollDistance, mode };
  } catch (error) {
    await chrome.storage.local.set({ timelineScan: {
      status: "error", mode, error: error instanceof Error ? error.message : "读取为你推荐失败",
      completedAt: new Date().toISOString()
    } });
    throw error;
  } finally {
    if (ownedTab && tab?.id != null) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function queueReplyCandidate(result, posts) {
  const saved = await chrome.storage.local.get("replyCandidates");
  const candidates = Array.isArray(saved.replyCandidates) ? saved.replyCandidates : [];
  const merged = appendReplyCandidates(candidates, posts, [result.handle]);
  if (JSON.stringify(merged) === JSON.stringify(candidates)) return;
  await chrome.storage.local.set({ replyCandidates: merged });
  broadcast({ type: "reply-candidate" });
}

async function backfillReplyCandidates() {
  if (activeRunPromise || activeJob?.status === "running" || activeReplyRun || replyStartPending) return;
  const saved = await chrome.storage.local.get([
    "replyCandidates", "timelinePosts", "replyAssistEnabled", "followingHandles", "lastResults", "replyClearedAt"
  ]);
  if (saved.replyAssistEnabled === false) return;
  const candidates = Array.isArray(saved.replyCandidates) ? saved.replyCandidates : [];
  const followed = [
    ...(saved.followingHandles || []),
    ...candidates.filter((item) => item.status !== "detected").map((item) => item.handle),
    ...((saved.lastResults || []).filter((item) => ["following", "followed"].includes(item.status)).map((item) => item.handle))
  ];
  const merged = discoverReplyCandidates(candidates, postsSinceReplyClear(saved.timelinePosts, saved.replyClearedAt), followed);
  if (JSON.stringify(merged) === JSON.stringify(candidates)) return;
  await chrome.storage.local.set({ replyCandidates: merged });
  broadcast({ type: "reply-candidate" });
}
async function startReplyBatch(message) {
  if (activeReplyRun || activeRunPromise || activeTimelinePromise || activeJob?.status === "running") {
    return { ok: false, error: "已有任务正在运行" };
  }
  const text = String(message.text || "").trim();
  if (!text || [...text].length > 280) return { ok: false, error: "回复内容须为 1–280 个字符" };
  const saved = await chrome.storage.local.get("replyCandidates");
  let candidates = Array.isArray(saved.replyCandidates) ? saved.replyCandidates : [];
  candidates = candidates.map((item) => item.status === "posting"
    ? { ...item, status: "uncertain", error: "上次任务中断，请检查原帖" } : item);
  await chrome.storage.local.set({ replyCandidates: candidates });
  const selected = selectPendingReplies(candidates, message.postUrls, Number.POSITIVE_INFINITY);
  if (!selected.length) return { ok: false, error: "没有可发布的待回复帖子" };
  activeReplyJob = {
    id: crypto.randomUUID(),
    status: "running",
    total: selected.length,
    goal: MAX_REPLIES_PER_BATCH,
    processed: 0,
    sent: 0,
    failed: 0,
    uncertain: 0,
    reviewItems: [],
    startedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ activeReplyJob });
  activeReplyRun = executeReplyBatch(activeReplyJob, selected, text).catch(async (error) => {
    activeReplyJob.status = "error";
    activeReplyJob.error = error instanceof Error ? error.message : "评论批次失败";
    await chrome.storage.local.set({ activeReplyJob });
    broadcast({ type: "reply-batch-progress", job: activeReplyJob });
  }).finally(() => {
    activeReplyRun = null;
  });
  return { ok: true, job: activeReplyJob };
}

async function getReplyBatch() {
  const saved = await chrome.storage.local.get("activeReplyJob");
  const job = activeReplyJob || saved.activeReplyJob || null;
  if (job?.status === "running" && !activeReplyRun && !replyStartPending) {
    job.status = "interrupted";
    job.error = "后台任务中断，请检查状态不确定的帖子";
    const savedCandidates = await chrome.storage.local.get("replyCandidates");
    const candidates = (savedCandidates.replyCandidates || []).map((item) => item.status === "posting"
      ? { ...item, status: "uncertain", error: "任务中断，请检查原帖是否已发布" } : item);
    await chrome.storage.local.set({ activeReplyJob: job, replyCandidates: candidates });
  }
  return job;
}

async function executeReplyBatch(job, selected, text) {
  let tab = await chrome.tabs.create({ url: "about:blank", active: true });
  let keepTabOpen = false;
  try {
    await navigateAndWait(tab.id, "https://x.com/home");
    const own = await sendToTab(tab.id, { type: "discover-own-handle" });
    if (!own?.ok || !own.handle) throw new Error("无法识别当前登录账号");
    for (const item of selected) {
      if (job.cancelRequested || job.sent >= MAX_REPLIES_PER_BATCH) break;
      const current = await chrome.storage.local.get("replyCandidates");
      let candidates = Array.isArray(current.replyCandidates) ? current.replyCandidates : [];
      const currentItem = candidates.find((entry) => entry.postUrl === item.postUrl);
      if (!currentItem || !["pending", "detected"].includes(currentItem.status)) continue;
      const needsFollow = currentItem.status === "detected";
      candidates = updateReplyCandidate(candidates, item.postUrl, {
        status: "posting",
        attemptedAt: new Date().toISOString()
      });
      await chrome.storage.local.set({ replyCandidates: candidates });
      broadcast({ type: "reply-batch-progress", job });

      let outcome;
      let messageSent = false;
      let followAttempted = false;
      try {
        if (needsFollow) {
          const targetHandle = new URL(item.postUrl).pathname.split("/")[1].toLowerCase();
          await navigateAndWait(tab.id, "https://x.com/" + targetHandle);
          followAttempted = true;
          const followResponse = await sendToTab(tab.id, { type: "inspect-profile", follow: true }, false);
          const followStatus = followResponse?.data?.status;
          if (!followResponse?.ok || !["following", "followed"].includes(followStatus)) {
            outcome = {
              status: followStatus === "unavailable" ? "failed" : "uncertain",
              message: followResponse?.data?.message || followResponse?.message || "无法确认关注结果，已跳过该条并保留页面供核查"
            };
          } else {
            const followed = await chrome.storage.local.get(["replyCandidates", "followingHandles"]);
            const followedCandidates = (followed.replyCandidates || []).map((entry) =>
              entry.status === "detected" && String(entry.handle || "").replace(/^@/, "").toLowerCase() === targetHandle
                ? { ...entry, status: "pending" } : entry);
            const followingHandles = [...new Set([...(followed.followingHandles || []), targetHandle])];
            await chrome.storage.local.set({ replyCandidates: followedCandidates, followingHandles });
            broadcast({ type: "reply-candidate" });
          }
        }
        if (!outcome) {
          await navigateAndWait(tab.id, item.postUrl);
          messageSent = true;
          const response = await sendToTab(tab.id, {
            type: "submit-reply",
            postUrl: item.postUrl,
            text,
            ownHandle: own.handle
          }, false);
          outcome = response?.ok ? response.data : {
            status: "uncertain",
            message: response?.message || "无法确认评论结果"
          };
        }
      } catch (error) {
        outcome = {
          status: messageSent || followAttempted ? "uncertain" : "failed",
          message: error instanceof Error ? error.message : "关注或评论失败"
        };
      }
      const status = ["sent", "already"].includes(outcome?.status)
        ? "done" : outcome?.status === "failed" ? "failed" : "uncertain";
      const latest = await chrome.storage.local.get("replyCandidates");
      candidates = updateReplyCandidate(latest.replyCandidates || [], item.postUrl, {
        status,
        failedStage: status === "done" ? null : needsFollow && !messageSent ? "follow" : "reply",
        error: status === "done" ? null : outcome?.message || "无法确认",
        completedAt: status === "done" ? new Date().toISOString() : null
      });
      await chrome.storage.local.set({ replyCandidates: candidates });
      job.processed += 1;
      if (outcome?.status === "sent") job.sent += 1;
      if (status === "failed") job.failed += 1;
      if (status === "uncertain") {
        job.uncertain += 1;
        keepTabOpen = true;
        job.reviewTabId = tab.id;
        job.reviewPostUrl = item.postUrl;
        job.reviewItems.push({ postUrl: item.postUrl, tabId: tab.id, error: outcome?.message || "结果待核查" });
      }
      await chrome.storage.local.set({ activeReplyJob: job });
      broadcast({ type: "reply-batch-progress", job });
      if (job.cancelRequested || job.sent >= MAX_REPLIES_PER_BATCH) break;
      if (status === "uncertain") {
        tab = await chrome.tabs.create({ url: "about:blank", active: true });
        keepTabOpen = false;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (job.status === "running") {
      job.status = job.cancelRequested ? "stopped" : "complete";
      job.completedAt = new Date().toISOString();
      await chrome.storage.local.set({ activeReplyJob: job });
      broadcast({ type: "reply-batch-progress", job });
    }
  } finally {
    if (!keepTabOpen) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

const NATIVE_HOST = "com.xfollow.audit";
function nativeAudit(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error || !response?.ok) reject(new Error(error?.message || response?.error || "Local file helper failed"));
      else resolve(response);
    });
  });
}
async function saveAuditLabel(message) {
  try { await loadAuditFile(); } catch { /* Keep browser-side feedback if helper is unavailable. */ }
  const saved = await chrome.storage.local.get(["auditPosts", "auditLabels", "auditPath"]);
  const post = (saved.auditPosts || []).find((item) => item.postUrl === message.postUrl);
  if (!post) throw new Error("Post is no longer in the audit list");
  if (typeof message.shouldMatch !== "boolean" || message.shouldMatch === post.matched) {
    throw new Error("Choose the opposite classification for a misjudgment");
  }
  const labels = labelAuditPost(saved.auditLabels || [], post.postUrl, message.shouldMatch, message.note, new Date().toISOString(), post);
  await chrome.storage.local.set({ auditLabels: labels, auditSyncPending: true });
  try {
    const response = await nativeAudit({ action: "save", path: saved.auditPath || "", data: buildFeedbackExport(saved.auditPosts || [], labels, new Date().toISOString()) });
    await chrome.storage.local.set({ auditPath: response.path, auditSyncPending: false, auditLastSavedAt: response.savedAt });
    return { ok: true, path: response.path, savedAt: response.savedAt };
  } catch (error) {
    return { ok: false, savedInBrowser: true, error: error.message };
  }
}
async function loadAuditFile(pathOverride) {
  const saved = await chrome.storage.local.get(["auditPosts", "auditLabels", "auditPath", "auditClearedAt"]);
  const response = await nativeAudit({ action: "read", path: pathOverride ?? saved.auditPath ?? "" });
  const merged = restoreAuditData(saved.auditPosts || [], saved.auditLabels || [], response.data, saved.auditClearedAt);
  await chrome.storage.local.set({ auditPosts: merged.posts, auditLabels: merged.labels, auditPath: response.path });
  return { ok: true, path: response.path, labels: merged.labels.length };
}
async function setAuditPath(path) {
  const loaded = await loadAuditFile(String(path || ""));
  const saved = await chrome.storage.local.get(["auditPosts", "auditLabels"]);
  const response = await nativeAudit({ action: "save", path: loaded.path, data: buildFeedbackExport(saved.auditPosts || [], saved.auditLabels || [], new Date().toISOString()) });
  await chrome.storage.local.set({ auditPath: response.path, auditSyncPending: false, auditLastSavedAt: response.savedAt });
  return response;
}
async function exportAudit() {
  await loadAuditFile();
  const saved = await chrome.storage.local.get(["auditPosts", "auditLabels", "auditPath"]);
  const response = await nativeAudit({ action: "export", path: saved.auditPath || "", data: buildFeedbackExport(saved.auditPosts || [], saved.auditLabels || [], new Date().toISOString()) });
  return response;
}
