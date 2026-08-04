const MAX_FOLLOWS_PER_BATCH = 10;
const elements = {
  input: document.querySelector("#urlInput"),
  count: document.querySelector("#urlCount"),
  clear: document.querySelector("#clearButton"),
  follow: document.querySelector("#followButton"),
  scan: document.querySelector("#scanButton"),
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
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "job-progress" || message?.type === "job-complete") renderJob(message.job);
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
  if (saved.activeJob?.status === "running") {
    renderJob(saved.activeJob);
    setBusy(true);
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
  elements.note.textContent = mode === "follow" ? "正在逐个打开主页，本批次最多关注 10 个…" : "正在逐个打开主页并读取状态…";
  const response = await chrome.runtime.sendMessage({ type: "run-job", mode, urls });
  if (!response?.ok) {
    setBusy(false);
    elements.note.textContent = response?.error || "任务无法启动";
  }
}

function renderJob(job) {
  if (!job) return;
  renderResults(job.results || [], job.urls.length, job.followed || 0, job.status);
  const processed = job.results?.length || 0;
  const percent = job.mode === "follow" ? Math.min((job.followed / MAX_FOLLOWS_PER_BATCH) * 100, 100) : (processed / job.urls.length) * 100;
  elements.meterFill.style.width = `${Number.isFinite(percent) ? percent : 0}%`;
  elements.meterText.textContent = job.status === "complete" ? `${processed} 个已完成` : `正在处理 ${Math.min(job.current, job.urls.length)} / ${job.urls.length}`;
  if (job.status === "complete") {
    setBusy(false);
    elements.note.textContent = job.mode === "follow" ? `本次已关注 ${job.followed} 个，剩余未关注账号已排队` : "检测完成，可切换到一键关注";
    if (job.mode === "follow" && job.completedAt) elements.lastBatch.textContent = formatTime(job.completedAt);
  }
}

function renderResults(results, total, followed, status) {
  elements.summary.textContent = status === "running" ? `${results.length} / ${total} 已读取` : `${followed} 个已关注 · ${total} 个总计`;
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
}

function updateCount() {
  urls = parseUrls(elements.input.value);
  elements.count.textContent = `${urls.length} 条`;
}

function parseUrls(value) {
  return [...new Set(value.split(/[\s,，]+/).map((item) => item.trim()).filter((item) => {
    try {
      const url = new URL(item);
      const [handle] = url.pathname.split("/").filter(Boolean);
      return /^https?:$/.test(url.protocol) && /^(www\.)?(x\.com|twitter\.com)$/i.test(url.hostname) && handle && !["home", "explore", "notifications", "messages", "i", "settings"].includes(handle.toLowerCase());
    } catch { return false; }
  }))];
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}
