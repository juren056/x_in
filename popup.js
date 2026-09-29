import { parseXUrls } from "./url-utils.js";
import { resetReplyCandidate, selectPendingReplies, validPostUrl } from "./reply-batch.js";
import { backfillAuditPosts, reclassifyAuditPosts } from "./audit-data.js";

const MAX_FOLLOWS_PER_BATCH = 10;
const elements = {
  input: document.querySelector("#urlInput"),
  count: document.querySelector("#urlCount"),
  clear: document.querySelector("#clearButton"),
  follow: document.querySelector("#followButton"),
  scan: document.querySelector("#scanButton"),
  stop: document.querySelector("#stopButton"),
  note: document.querySelector("#actionNote"),
  list: document.querySelector("#resultList"),
  summary: document.querySelector("#summary"),
  lastBatch: document.querySelector("#lastBatchAt"),
  meterFill: document.querySelector("#meterFill"),
  meterText: document.querySelector("#meterText"),
  timeline: document.querySelector("#collectTimelineButton"),
  timelineCurrent: document.querySelector("#collectCurrentTimelineButton"),
  timelineScrollLimit: document.querySelector("#timelineScrollLimit"),
  replyTemplate: document.querySelector("#replyTemplate"),
  setDefaultReply: document.querySelector("#setDefaultReplyButton"),
  defaultReplyStatus: document.querySelector("#defaultReplyStatus"),
  copyReply: document.querySelector("#copyReplyButton"),
  clearReplyHistory: document.querySelector("#clearReplyHistoryButton"),
  replyAssist: document.querySelector("#replyAssistToggle"),
  replyQueue: document.querySelector("#replyQueue"),
  replyBatch: document.querySelector("#replyBatchButton"),
  stopReplyBatch: document.querySelector("#stopReplyBatchButton"),
  replyBatchStatus: document.querySelector("#replyBatchStatus"),
  auditSection: document.querySelector("#auditSection"),
  auditCount: document.querySelector("#auditCount"),
  auditPath: document.querySelector("#auditPath"),
  auditSavePath: document.querySelector("#auditSavePath"),
  auditSaveStatus: document.querySelector("#auditSaveStatus"),
  auditExport: document.querySelector("#auditExport"),
  auditList: document.querySelector("#auditList"),
  clearAudit: document.querySelector("#clearAuditButton")
};

let urls = [];
let replyCandidates = [];
let replyBatchJob = null;
let defaultReply = null;
let auditPosts = [];
let auditLabels = [];

document.addEventListener("DOMContentLoaded", init);
elements.input.addEventListener("input", updateCount);
elements.clear.addEventListener("click", () => {
  elements.input.value = "";
  urls = [];
  updateCount();
  chrome.storage.local.set({ draftUrls: "", timelinePosts: [] });
});
elements.scan.addEventListener("click", () => startJob("scan"));
elements.follow.addEventListener("click", () => startJob("follow"));
elements.stop.addEventListener("click", stopJob);
elements.timeline.addEventListener("click", () => collectTimeline("background"));
elements.timelineCurrent.addEventListener("click", () => collectTimeline("current"));
elements.timelineScrollLimit.addEventListener("change", async () => {
  const limit = Number(elements.timelineScrollLimit.value);
  if (Number.isInteger(limit) && limit >= 1 && limit <= 200) {
    await chrome.storage.local.set({ timelineScrollLimit: limit });
  } else {
    elements.note.textContent = "滚动次数须为 1–200 的整数";
  }
});
elements.replyTemplate.addEventListener("input", () => {
  chrome.storage.local.set({ replyTemplate: elements.replyTemplate.value });
  renderReplyBatchStatus();
  updateDefaultReplyButton();
  elements.defaultReplyStatus.textContent = defaultReply !== null && elements.replyTemplate.value.trim() !== defaultReply
    ? "临时内容；下次打开恢复默认" : defaultReply !== null ? "下次打开自动填入" : "设置后，下次打开自动填入";
});
elements.setDefaultReply.addEventListener("click", saveDefaultReply);
elements.replyBatch.addEventListener("click", runReplyBatch);
elements.stopReplyBatch.addEventListener("click", stopReplyBatch);
elements.copyReply.addEventListener("click", copyReply);
elements.clearReplyHistory.addEventListener("click", clearReplyHistory);
elements.replyAssist.addEventListener("change", async () => {
  await chrome.storage.local.set({ replyAssistEnabled: elements.replyAssist.checked });
  if (elements.replyAssist.checked) {
    await chrome.runtime.sendMessage({ type: "get-reply-batch" });
    await refreshReplyCandidates();
  }
});
elements.replyQueue.addEventListener("click", handleReplyQueueClick);
elements.auditList.addEventListener("click", handleAuditClick);
elements.auditSavePath.addEventListener("click", saveAuditPath);
elements.auditExport.addEventListener("click", exportAudit);
elements.clearAudit.addEventListener("click", clearAuditHistory);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "reply-candidate") refreshReplyCandidates();
  if (message?.type === "audit-updated") refreshAudit();
  if (message?.type === "reply-batch-progress") {
    replyBatchJob = message.job;
    refreshReplyCandidates();
  }
  if (message?.type === "job-progress" || message?.type === "job-complete") renderJob(message.job);
  if (message?.type === "job-paused" || message?.type === "job-stopped") renderJob(message.job);
  if (message?.type === "job-error") {
    setBusy(false);
    elements.note.textContent = message.job?.error || "任务失败，请稍后重试";
  }
});

async function init() {
  const saved = await chrome.storage.local.get(["draftUrls", "lastResults", "lastBatchAt", "activeJob", "replyTemplate", "defaultReply", "replyAssistEnabled", "replyCandidates", "activeReplyJob", "timelineScan", "timelineScrollLimit"]);
  elements.input.value = saved.draftUrls || "";
  elements.timelineScrollLimit.value = Number.isInteger(saved.timelineScrollLimit) && saved.timelineScrollLimit >= 1 && saved.timelineScrollLimit <= 200
    ? String(saved.timelineScrollLimit) : "30";
  defaultReply = typeof saved.defaultReply === "string" ? saved.defaultReply : null;
  elements.replyTemplate.value = defaultReply !== null ? defaultReply : saved.replyTemplate || "";
  updateDefaultReplyButton();
  if (defaultReply !== null) elements.defaultReplyStatus.textContent = "下次打开自动填入";
  elements.replyAssist.checked = saved.replyAssistEnabled !== false;
  replyCandidates = Array.isArray(saved.replyCandidates) ? saved.replyCandidates : [];
  replyBatchJob = saved.activeReplyJob || null;
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-reply-batch" });
    if (response?.job) replyBatchJob = response.job;
    const refreshed = await chrome.storage.local.get("replyCandidates");
    if (Array.isArray(refreshed.replyCandidates)) replyCandidates = refreshed.replyCandidates;
  } catch {
    // Keep the persisted state if the background worker is starting.
  }
  renderReplyQueue();
  try { await chrome.runtime.sendMessage({ type: "audit-load" }); } catch { /* Local helper can be installed later. */ }
  await refreshAudit();
  urls = parseUrls(elements.input.value);
  if (saved.lastBatchAt) elements.lastBatch.textContent = formatTime(saved.lastBatchAt);
  if (saved.lastResults?.length) renderResults(saved.lastResults, saved.lastResults.length, saved.lastResults.filter((item) => item.status === "followed").length, "complete");
  if (["running", "paused", "stopped"].includes(saved.activeJob?.status)) {
    renderJob(saved.activeJob);
    setBusy(saved.activeJob.status === "running");
  }
  updateCount();
  if (saved.timelineScan?.status === "running") {
    elements.note.textContent = "正在读取为你推荐；可保持弹窗打开查看结果。";
    elements.timeline.disabled = true;
    elements.timelineCurrent.disabled = true;
  } else if (saved.timelineScan) {
    renderTimelineScanResult(saved.timelineScan);
  }
}

async function startJob(mode) {
  urls = parseUrls(elements.input.value);
  if (!urls.length) {
    elements.note.textContent = "请先读取或粘贴至少一个有效的 X 主页地址";
    elements.input.focus();
    return;
  }
  await chrome.storage.local.set({ draftUrls: elements.input.value });
  setBusy(true);
  elements.note.textContent = "正在先同步我的关注列表，之后只处理未关注账号…";
  const response = await chrome.runtime.sendMessage({ type: "run-job", mode, urls, replyAssistEnabled: elements.replyAssist.checked });
  if (!response?.ok) {
    setBusy(false);
    elements.note.textContent = response?.error || "任务无法启动";
  }
}

async function stopJob() {
  elements.stop.disabled = true;
  elements.note.textContent = "正在停止，当前页面关闭后任务会结束…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "stop-job" });
    if (!response?.ok) {
      setBusy(false);
      elements.note.textContent = response?.error || "当前没有正在运行的任务";
    }
  } catch {
    setBusy(false);
    elements.note.textContent = "停止请求失败，请重新打开插件查看状态";
  }
}

function renderJob(job) {
  if (!job) return;
  syncRemainingUrls(job);
  renderResults(job.results || [], job.urls.length, job.followed || 0, job.status);
  const processed = job.results?.length || 0;
  const percent = job.mode === "follow" ? Math.min((job.followed / MAX_FOLLOWS_PER_BATCH) * 100, 100) : (processed / job.urls.length) * 100;
  elements.meterFill.style.width = `${Number.isFinite(percent) ? percent : 0}%`;
  elements.meterText.textContent = job.status === "complete" ? `${processed} 个已完成` : job.status === "paused" ? "已暂停保护" : job.status === "stopped" ? "已手动停止" : job.phase === "syncing" ? "同步我的关注列表" : job.phase === "stopping" ? "正在停止" : job.phase === "cooldown" ? "安全等待中" : `正在处理 ${Math.min(job.current, job.urls.length)} / ${job.urls.length}`;
  if (job.phase === "cooldown") {
    elements.note.textContent = "安全等待中：复用同一个后台标签页，避免连续请求 X…";
  }
  if (job.phase === "syncing") {
    elements.note.textContent = "正在读取我的 following 列表，已关注账号不会再打开主页…";
  }
  if (job.status === "complete") {
    setBusy(false);
    elements.note.textContent = job.mode === "follow" ? `本次已关注 ${job.followed} 个，剩余未关注账号已排队` : "检测完成，可切换到一键关注";
    if (job.mode === "follow" && job.completedAt) elements.lastBatch.textContent = formatTime(job.completedAt);
  }
  if (job.status === "paused") {
    setBusy(false);
    elements.note.textContent = job.error || "任务已暂停，请等待 X 恢复后再继续";
    if (job.mode === "follow" && job.completedAt) elements.lastBatch.textContent = formatTime(job.completedAt);
  }
  if (job.status === "stopped") {
    setBusy(false);
    elements.note.textContent = "任务已手动停止，已完成结果已保留";
    if (job.mode === "follow" && job.completedAt) elements.lastBatch.textContent = formatTime(job.completedAt);
  }
}

function renderResults(results, total, followed, status) {
  elements.summary.textContent = status === "running" || status === "paused" || status === "stopped" ? `${results.length} / ${total} 已处理` : `${followed} 个已关注 · ${total} 个总计`;
  if (!results.length) {
    elements.list.innerHTML = '<div class="empty-state"><span>◎</span><p>读取或粘贴一组主页地址，开始第一次巡检</p></div>';
    return;
  }
  elements.list.innerHTML = results.map((result, index) => {
    const handle = result.handle || "未知账号";
    const statusText = {
      following: "已关注", followed: "刚刚关注", "not-following": "未关注", queued: "待下批", unavailable: "无法确认", failed: "未成功", error: "检测失败"
    }[result.status] || "读取中";
    return `<div class="result-row" style="animation-delay:${Math.min(index * 30, 420)}ms">
      <div class="account"><span class="avatar">${escapeHtml(handle.replace("@", "").slice(0, 2).toUpperCase())}</span><div><div class="handle">${escapeHtml(handle)}</div><div class="url">${escapeHtml(result.url || "")}${result.message ? ` · ${escapeHtml(result.message)}` : ""}</div></div></div>
      <span class="state state-${result.status}">${statusText}</span>
    </div>`;
  }).join("");
}

function setBusy(busy) {
  elements.follow.disabled = busy;
  elements.scan.disabled = busy;
  elements.timeline.disabled = busy;
  elements.stop.hidden = !busy;
  elements.stop.disabled = false;
}

function updateCount() {
  urls = parseUrls(elements.input.value);
  elements.count.textContent = `${urls.length} 条`;
}

function syncRemainingUrls(job) {
  if (!job.results?.length || !Array.isArray(job.remainingUrls) || document.activeElement === elements.input) return;
  const nextValue = job.remainingUrls.join("\n");
  if (elements.input.value === nextValue) return;
  elements.input.value = nextValue;
  updateCount();
}

function parseUrls(value) {
  return parseXUrls(value);
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function renderTimelineScanResult(scan) {
  const fallback = (scan.mode === "background" && ["partial", "error"].includes(scan.status)) ||
    (scan.mode === "current" && scan.status === "error");
  elements.timelineCurrent.hidden = !fallback;
  if (scan.status === "error") {
    elements.note.textContent = scan.error + (fallback ? "；可在当前 X 首页尝试扫描" : "");
    return;
  }
  const summary = `本次扫描 ${scan.rounds} / ${scan.scrollLimit} 次，采集 ${scan.scannedPosts} 条帖子、${scan.found} 个账号；合并后共 ${scan.total} 个。`;
  const reason = scan.stopReason === "time" ? "达到 4 分钟时限" :
    scan.stopReason === "stalled" ? "页面滚动和帖子加载均已停止" :
    scan.stopReason === "no-new-posts" ? "滚动后没有继续加载新帖" : "";
  elements.note.textContent = scan.status === "partial"
    ? summary + " " + reason + (fallback ? "；后台采集不完整，可在已打开的 X 首页重试。" : "。")
    : summary;
}

async function collectTimeline(mode = "background") {
  const scrollLimit = Number(elements.timelineScrollLimit.value);
  if (!Number.isInteger(scrollLimit) || scrollLimit < 1 || scrollLimit > 200) {
    elements.note.textContent = "滚动次数须为 1–200 的整数";
    elements.timelineScrollLimit.focus();
    return;
  }
  elements.timeline.disabled = true;
  elements.timelineCurrent.disabled = true;
  elements.timelineScrollLimit.disabled = true;
  elements.follow.disabled = true;
  elements.scan.disabled = true;
  elements.note.textContent = mode === "current"
    ? "正在扫描当前 X 首页；页面会自动滚动，不会新建标签页…"
    : "正在后台标签页读取首页“为你推荐”，不会切换当前页面…";
  await chrome.storage.local.set({ draftUrls: elements.input.value, timelineScrollLimit: scrollLimit });
  try {
    const response = await chrome.runtime.sendMessage({ type: "collect-timeline", scrollLimit, mode });
    if (!response?.ok) throw new Error(response?.error || "读取失败");
    const seen = new Set();
    const merged = parseXUrls(elements.input.value + "\n" + response.urls.join("\n")).filter((url) => {
      const key = url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    elements.input.value = merged.join("\n");
    updateCount();
    await chrome.storage.local.set({ draftUrls: elements.input.value, lastTimelineAt: new Date().toISOString() });
    await refreshAudit();
    renderTimelineScanResult({ status: response.stopReason === "limit" ? "complete" : "partial",
      mode, scrollLimit, found: response.urls.length, total: merged.length,
      scannedPosts: response.scannedPosts, rounds: response.rounds, stopReason: response.stopReason });
  } catch (error) {
    renderTimelineScanResult({ status: "error", mode,
      error: error instanceof Error ? error.message : "读取为你推荐失败" });
  } finally {
    elements.timeline.disabled = false;
    elements.timelineCurrent.disabled = false;
    elements.timelineScrollLimit.disabled = false;
    elements.follow.disabled = false;
    elements.scan.disabled = false;
  }
}

async function copyReply() {
  const reply = elements.replyTemplate.value.trim();
  if (!reply) {
    elements.note.textContent = "请先填写回复内容";
    elements.replyTemplate.focus();
    return;
  }
  try {
    await navigator.clipboard.writeText(reply);
    elements.note.textContent = "回复内容已复制；请在 X 原帖中检查后自行发送。";
  } catch {
    elements.note.textContent = "复制失败，请手动选择回复内容。";
  }
}

async function clearReplyHistory() {
  if (!window.confirm("清零累计匹配帖子及其回复状态？已发布的 X 评论不会删除；之后重新扫描到的帖子会重新累计。")) return;
  elements.clearReplyHistory.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "clear-reply-history" });
    if (!response?.ok) throw new Error(response?.error || "清零失败");
    replyCandidates = [];
    replyBatchJob = null;
    renderReplyQueue();
  } catch (error) {
    elements.replyBatchStatus.textContent = error instanceof Error ? error.message : "清零失败";
  } finally {
    elements.clearReplyHistory.disabled = replyBatchJob?.status === "running" || replyCandidates.length === 0;
  }
}
async function refreshReplyCandidates() {
  const saved = await chrome.storage.local.get("replyCandidates");
  replyCandidates = Array.isArray(saved.replyCandidates) ? saved.replyCandidates : [];
  renderReplyQueue();
}

function renderReplyQueue() {
  renderReplyBatchStatus();
  if (!replyCandidates.length) {
    elements.replyQueue.innerHTML = '<p class="reply-empty">暂无累计匹配的帖子；读取首页“为你推荐”后显示。</p>';
    return;
  }
  const labels = {
    detected: "待关注",
    pending: "待回复",
    posting: "正在发布",
    done: "已回复",
    failed: "发布失败",
    uncertain: "结果待核查"
  };
  elements.replyQueue.innerHTML = replyCandidates.map((item) => {
    const url = escapeHtml(String(item.postUrl || ""));
    const handle = escapeHtml(String(item.handle || ""));
    const tags = escapeHtml((item.tags || []).length
      ? item.tags.map((tag) => "#" + tag).join(" ") : item.matchReason === "content" ? "正文匹配" : "");
    const status = labels[item.status] || "待回复";
    return '<div class="reply-item">' +
      '<div class="reply-item-head"><strong>@' + handle + '</strong><span>' + status + '</span></div>' +
      '<div class="reply-item-tags">' + tags + '</div>' +
      '<div class="reply-item-text">' + escapeHtml(String(item.text || "")) + '</div>' +
      (item.error ? '<div class="reply-item-error">' + escapeHtml(String(item.error)) + '</div>' : '') +
      '<div class="reply-item-actions">' +
      '<button type="button" data-reply-action="open" data-url="' + url + '">打开原帖</button>' +
      '<button type="button" data-reply-action="copy" data-url="' + url + '">复制回复</button>' +
      '<button type="button" data-reply-action="misjudge" data-url="' + url + '">误判：不应通过</button>' +
      (item.status === "done" || item.status === "posting" ? '' :
        '<button type="button" data-reply-action="done" data-url="' + url + '">标记已回复</button>') +
      (item.status === "failed" || item.status === "uncertain" ?
        '<button type="button" data-reply-action="reset" data-url="' + url + '">重置状态</button>' : '') +
      '</div></div>';
  }).join("");
}

function renderReplyBatchStatus() {
  const total = replyCandidates.length;
  const pending = replyCandidates.filter((item) => item.status === "pending" && validPostUrl(item.postUrl)).length;
  const needsFollow = replyCandidates.filter((item) => item.status === "detected" && validPostUrl(item.postUrl)).length;
  const eligible = pending + needsFollow;
  const running = replyBatchJob?.status === "running";
  const needsReview = replyBatchJob?.status === "paused" && replyCandidates.some((item) =>
    item.postUrl === replyBatchJob.reviewPostUrl && ["failed", "uncertain"].includes(item.status));
  const validText = [...elements.replyTemplate.value.trim()].length;
  elements.replyBatch.disabled = running || eligible === 0 || validText === 0 || validText > 280;
  elements.stopReplyBatch.hidden = !running;
  elements.clearReplyHistory.disabled = running || total === 0;
  const labels = {
    stopped: "已停止",
    complete: "本批完成",
    error: "批次失败",
    interrupted: "任务中断，请核查",
    paused: "已暂停，请检查保留的 X 标签页"
  };
  const batchSummary = replyBatchJob?.status === "complete" || replyBatchJob?.status === "stopped"
    ? " · 上批成功 " + (replyBatchJob.sent || 0) + " / 10" +
      ((replyBatchJob.failed || 0) ? " · 失败 " + replyBatchJob.failed : "") +
      ((replyBatchJob.uncertain || 0) ? " · 待核查 " + replyBatchJob.uncertain : "")
    : "";
  elements.replyBatchStatus.textContent = running
    ? "成功 " + (replyBatchJob.sent || 0) + " / 10 · 已尝试 " + (replyBatchJob.processed || 0) +
      " / " + (replyBatchJob.total || 0) +
      ((replyBatchJob.failed || 0) ? " · 失败 " + replyBatchJob.failed : "") +
      ((replyBatchJob.uncertain || 0) ? " · 待核查 " + replyBatchJob.uncertain : "")
    : needsReview && eligible === 0 ? labels.paused
      : total ? "累计匹配 " + total + " 条 · 待关注 " + needsFollow + " 条 · 待回复 " + pending + " 条" + batchSummary
        : labels[replyBatchJob?.status] || "累计匹配 0 条";
}

async function runReplyBatch() {
  const selected = selectPendingReplies(replyCandidates, null, Number.POSITIVE_INFINITY);
  const text = elements.replyTemplate.value.trim();
  if (!selected.length || !text || [...text].length > 280) {
    elements.replyBatchStatus.textContent = "请准备待回复帖子及 1–280 字评论";
    return;
  }
  const accounts = selected.slice(0, 10).map((item) => "@" + item.handle).join("、");
  const followCount = selected.filter((item) => item.status === "detected").length;
  if (!window.confirm("本次共有 " + selected.length + " 条待处理原帖" +
      (followCount ? "，其中 " + followCount + " 条需先关注账号" : "") +
      "。将按列表顺序尝试，失败会跳过并顺延，直到确认成功 10 条或候选用完；结果待核查的帖子不计成功，也不会重试。\n" +
      "前 10 条：" + accounts + "\n\n评论内容：\n" + text + "\n\n确认开始？")) return;
  elements.replyBatch.disabled = true;
  elements.replyBatchStatus.textContent = "正在启动评论批次…";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "run-reply-batch",
      text,
      postUrls: selected.map((item) => item.postUrl)
    });
    if (!response?.ok) throw new Error(response?.error || "评论批次无法启动");
    replyBatchJob = response.job;
    renderReplyBatchStatus();
  } catch (error) {
    elements.replyBatchStatus.textContent = error instanceof Error ? error.message : "启动失败";
    elements.replyBatch.disabled = false;
  }
}

async function stopReplyBatch() {
  elements.stopReplyBatch.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "stop-reply-batch" });
    if (!response?.ok) throw new Error(response?.error || "停止失败");
    elements.replyBatchStatus.textContent = "正在停止；当前操作完成后结束";
  } catch (error) {
    elements.replyBatchStatus.textContent = error instanceof Error ? error.message : "停止失败";
  } finally {
    elements.stopReplyBatch.disabled = false;
  }
}
async function handleReplyQueueClick(event) {
  const button = event.target.closest("[data-reply-action]");
  if (!button) return;
  const item = replyCandidates.find((candidate) => candidate.postUrl === button.dataset.url);
  if (!item) return;
  if (button.dataset.replyAction === "open") {
    await chrome.tabs.create({ url: item.postUrl, active: true });
    return;
  }
  if (button.dataset.replyAction === "misjudge") {
    await markMisjudgment(item.postUrl, false);
    return;
  }
  if (button.dataset.replyAction === "copy") {
    await copyReply();
    return;
  }
  if (button.dataset.replyAction === "reset") {
    if (!["failed", "uncertain"].includes(item.status)) return;
    if (item.status === "uncertain" &&
        !window.confirm("请先打开原帖确认评论未发布。重置后，这条帖子会重新进入下一批评论。")) return;
    const saved = await chrome.storage.local.get("replyCandidates");
    const current = Array.isArray(saved.replyCandidates) ? saved.replyCandidates : [];
    replyCandidates = resetReplyCandidate(current, item.postUrl);
    await chrome.storage.local.set({ replyCandidates });
    renderReplyQueue();
    return;
  }  if (button.dataset.replyAction === "done") {
    item.status = "done";
    item.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ replyCandidates });
    renderReplyQueue();
  }
}

async function refreshAudit() {
  const saved = await chrome.storage.local.get(["auditPosts", "timelinePosts", "auditLabels", "auditPath", "auditSyncPending", "auditLastSavedAt", "auditClearedAt"]);
  const previousPosts = Array.isArray(saved.auditPosts) ? saved.auditPosts : [];
  const withTimeline = Array.isArray(saved.timelinePosts) && saved.timelinePosts.length
    ? backfillAuditPosts(previousPosts, saved.timelinePosts, new Date().toISOString(), saved.auditClearedAt)
    : previousPosts;
  auditPosts = reclassifyAuditPosts(withTimeline);
  if (auditPosts.length !== previousPosts.length || auditPosts.some((post, index) => post !== previousPosts[index])) {
    await chrome.storage.local.set({ auditPosts });
  }
  auditLabels = Array.isArray(saved.auditLabels) ? saved.auditLabels : [];
  if (document.activeElement !== elements.auditPath) elements.auditPath.value = saved.auditPath || "";
  if (!saved.auditPath && !elements.auditPath.value) {
    try {
      const info = await chrome.runtime.sendMessage({ type: "audit-info" });
      if (info?.ok) elements.auditPath.value = info.path;
    } catch { /* The helper may not be installed yet. */ }
  }
  elements.auditSaveStatus.textContent = saved.auditSyncPending
    ? "标注已保存在浏览器，尚未同步到本地文件"
    : saved.auditLastSavedAt ? "本地已保存：" + formatTime(saved.auditLastSavedAt) : "尚未保存本地文件；请安装本地助手并设置地址";
  renderAudit();
}
function renderAudit() {
  const rejected = auditPosts.filter((post) => !post.matched).sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));
  const unreadable = rejected.filter((post) => post.reason === "unreadable").length;
  elements.auditCount.textContent = rejected.length + " 条未通过" + (unreadable ? " · " + unreadable + " 条无法读取" : "");
  elements.auditList.innerHTML = rejected.map((post) => {
    const label = auditLabels.find((item) => item.postUrl.toLowerCase() === post.postUrl.toLowerCase());
    const url = escapeHtml(String(post.postUrl || ""));
    const reason = post.reason === "unreadable" ? "正文无法读取" : "未命中标签或交友邀请";
    return '<article class="audit-item"><div class="reply-item-head"><strong>@' + escapeHtml(String(post.handle || "")) + '</strong><span>' +
      reason + '</span></div><div class="reply-item-text">' + escapeHtml(String(post.text || "")) + '</div>' +
      '<div class="audit-meta">首次：' + escapeHtml(String(post.firstSeenAt || "")) + ' · 最近：' + escapeHtml(String(post.lastSeenAt || "")) + '</div>' +
      '<div class="reply-item-actions"><a href="' + url + '" target="_blank" rel="noopener">打开原帖</a>' +
      '<button type="button" data-audit-action="mark" data-url="' + url + '">误判：应当通过</button>' +
      (label ? '<span class="audit-labeled">已标注 ' + escapeHtml(String(label.markedAt || "")) + '</span>' : '') +
      '</div><div class="audit-link">' + url + '</div></article>';
  }).join("") || '<p class="reply-empty">暂无未通过筛选的帖子。</p>';
  elements.clearAudit.disabled = rejected.length === 0;
}
async function handleAuditClick(event) {
  const button = event.target.closest("[data-audit-action]");
  if (button?.dataset.auditAction === "mark") await markMisjudgment(button.dataset.url, true);
}
async function markMisjudgment(postUrl, shouldMatch) {
  const note = window.prompt("误判说明（可留空）", "");
  if (note === null) return;
  const response = await chrome.runtime.sendMessage({ type: "audit-label", postUrl, shouldMatch, note });
  await refreshAudit();
  elements.auditSaveStatus.textContent = response?.ok
    ? "已保存到：" + response.path
    : "已保存到浏览器，写入本地失败：" + (response?.error || "未知错误");
}
async function saveAuditPath() {
  elements.auditSavePath.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "audit-set-path", path: elements.auditPath.value.trim() });
    if (!response?.ok) throw new Error(response?.error || "无法写入本地文件");
    elements.auditPath.value = response.path;
    elements.auditSaveStatus.textContent = "已同步到：" + response.file;
  } catch (error) {
    elements.auditSaveStatus.textContent = "本地保存失败：" + error.message;
  } finally {
    elements.auditSavePath.disabled = false;
  }
}
async function exportAudit() {
  elements.auditExport.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "audit-export" });
    if (!response?.ok) throw new Error(response?.error || "导出失败");
    elements.auditSaveStatus.textContent = "已导出：" + response.file;
  } catch (error) {
    elements.auditSaveStatus.textContent = "导出失败：" + error.message;
  } finally {
    elements.auditExport.disabled = false;
  }
}

async function clearAuditHistory() {
  if (!window.confirm("清零累计未通过筛选的帖子？人工误判标注和本地 JSON 文件会保留；再次扫描到的帖子可重新累计。")) return;
  elements.clearAudit.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "clear-audit-history" });
    if (!response?.ok) throw new Error(response?.error || "清零失败");
    await refreshAudit();
  } catch (error) {
    elements.auditSaveStatus.textContent = error instanceof Error ? error.message : "清零失败";
  } finally {
    elements.clearAudit.disabled = auditPosts.filter((post) => !post.matched).length === 0;
  }
}

function updateDefaultReplyButton() {
  const text = elements.replyTemplate.value.trim();
  const length = [...text].length;
  const same = defaultReply !== null && text === defaultReply;
  elements.setDefaultReply.disabled = !length || length > 280 || same;
  elements.setDefaultReply.textContent = same ? "已设为默认" : "设为默认回复";
}
async function saveDefaultReply() {
  const text = elements.replyTemplate.value.trim();
  const length = [...text].length;
  if (!length || length > 280) {
    elements.defaultReplyStatus.textContent = "默认回复须为 1–280 字";
    return;
  }
  elements.setDefaultReply.disabled = true;
  try {
    await chrome.storage.local.set({ defaultReply: text, replyTemplate: text });
    defaultReply = text;
    elements.replyTemplate.value = text;
    elements.defaultReplyStatus.textContent = "已保存；下次打开自动填入";
    updateDefaultReplyButton();
  } catch (error) {
    elements.defaultReplyStatus.textContent = "保存失败：" + (error instanceof Error ? error.message : "请重试");
    updateDefaultReplyButton();
  }
}
