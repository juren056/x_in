import { parseXUrls } from "./url-utils.js";

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
  meterText: document.querySelector("#meterText")
};

let urls = [];

document.addEventListener("DOMContentLoaded", init);
elements.input.addEventListener("input", updateCount);
elements.clear.addEventListener("click", () => {
  elements.input.value = "";
  urls = [];
  updateCount();
});
elements.scan.addEventListener("click", () => startJob("scan"));
elements.follow.addEventListener("click", () => startJob("follow"));
elements.stop.addEventListener("click", stopJob);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "job-progress" || message?.type === "job-complete") renderJob(message.job);
  if (message?.type === "job-paused" || message?.type === "job-stopped") renderJob(message.job);
  if (message?.type === "job-error") {
    setBusy(false);
    elements.note.textContent = message.job?.error || "任务失败，请稍后重试";
  }
});

async function init() {
  const saved = await chrome.storage.local.get(["draftUrls", "lastResults", "lastBatchAt", "activeJob"]);
  elements.input.value = saved.draftUrls || "";
  urls = parseUrls(elements.input.value);
  if (saved.lastBatchAt) elements.lastBatch.textContent = formatTime(saved.lastBatchAt);
  if (saved.lastResults?.length) renderResults(saved.lastResults, saved.lastResults.length, saved.lastResults.filter((item) => item.status === "followed").length, "complete");
  if (["running", "paused", "stopped"].includes(saved.activeJob?.status)) {
    renderJob(saved.activeJob);
    setBusy(saved.activeJob.status === "running");
  }
  updateCount();
}

async function startJob(mode) {
  urls = parseUrls(elements.input.value);
  if (!urls.length) {
    elements.note.textContent = "请先粘贴至少一个有效的 X 主页地址";
    elements.input.focus();
    return;
  }
  await chrome.storage.local.set({ draftUrls: elements.input.value });
  setBusy(true);
  elements.note.textContent = "正在先同步我的关注列表，之后只处理未关注账号…";
  const response = await chrome.runtime.sendMessage({ type: "run-job", mode, urls });
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
    elements.list.innerHTML = '<div class="empty-state"><span>◎</span><p>粘贴一组主页地址，开始第一次巡检</p></div>';
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
