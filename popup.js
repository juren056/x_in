import { parsePostCandidates } from "./url-utils.js";
import { mergeCandidates, summarizeCandidates, updateCandidate } from "./candidate-store.js";

const elements = {
  postInput: document.querySelector("#postInput"),
  importCount: document.querySelector("#importCount"),
  importButton: document.querySelector("#importButton"),
  replyTemplate: document.querySelector("#replyTemplate"),
  templateCount: document.querySelector("#templateCount"),
  applyTemplateButton: document.querySelector("#applyTemplateButton"),
  summary: document.querySelector("#summary"),
  candidateList: document.querySelector("#candidateList"),
  notice: document.querySelector("#notice")
};
let candidates = [];
let defaultReply = "";
let filter = "pending";
let saveQueue = Promise.resolve();

document.addEventListener("DOMContentLoaded", init);
elements.postInput.addEventListener("input", () => {
  enqueueSave({ importDraft: elements.postInput.value });
  elements.importCount.textContent = parsePostCandidates(elements.postInput.value).length + " 个账号";
});
elements.importButton.addEventListener("click", importPosts);
elements.replyTemplate.addEventListener("input", () => {
  defaultReply = elements.replyTemplate.value;
  elements.templateCount.textContent = defaultReply.length + " 字";
  enqueueSave({ defaultReply });
});
elements.applyTemplateButton.addEventListener("click", () => {
  candidates = candidates.map((item) => item.replyStatus === "pending" && !item.customReply
    ? { ...item, replyDraft: defaultReply } : item);
  enqueueSave({ candidates });
  render();
  notice("默认模板已应用到未单独编辑的待处理回复。");
});
document.querySelector(".filter-row").addEventListener("click", (event) => {
  const selected = event.target.closest("[data-filter]");
  if (!selected) return;
  filter = selected.dataset.filter;
  render();
});
elements.candidateList.addEventListener("input", (event) => {
  if (!event.target.matches(".reply-draft")) return;
  candidates = updateCandidate(candidates, event.target.dataset.id, {
    replyDraft: event.target.value,
    customReply: true
  });
  enqueueSave({ candidates });
});
elements.candidateList.addEventListener("click", handleCandidateAction);

async function init() {
  const saved = await chrome.storage.local.get(["candidates", "defaultReply", "importDraft"]);
  candidates = Array.isArray(saved.candidates) ? saved.candidates : [];
  defaultReply = String(saved.defaultReply || "");
  elements.postInput.value = String(saved.importDraft || "");
  elements.replyTemplate.value = defaultReply;
  elements.templateCount.textContent = defaultReply.length + " 字";
  elements.importCount.textContent = parsePostCandidates(elements.postInput.value).length + " 个账号";
  render();
}

function importPosts() {
  const imported = parsePostCandidates(elements.postInput.value);
  if (!imported.length) {
    notice("未找到有效的 X 帖子链接。格式示例：https://x.com/name/status/123");
    return;
  }
  const result = mergeCandidates(candidates, imported, defaultReply);
  candidates = result.candidates;
  elements.postInput.value = "";
  elements.importCount.textContent = "0 个账号";
  enqueueSave({ candidates, importDraft: "" });
  filter = "pending";
  render();
  notice("新增 " + result.added + " 个账号，更新 " + result.updated + " 个；重复账号保留已有处理记录。");
}

async function handleCandidateAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  const item = candidates.find((candidate) => candidate.id === id);
  if (!item) return;
  const action = button.dataset.action;
  if (action === "open-post" || action === "open-profile") {
    await chrome.tabs.create({ url: action === "open-post" ? item.postUrl : item.profileUrl, active: true });
    return;
  }
  if (action === "check-follow") {
    button.disabled = true;
    notice("正在检查 @" + item.handle + " 的关注状态…");
    try {
      const response = await chrome.runtime.sendMessage({ type: "inspect-follow", handle: item.handle });
      if (!response?.ok) throw new Error(response?.error || "检查失败");
      candidates = updateCandidate(candidates, id, { followStatus: response.result });
      enqueueSave({ candidates });
      render();
      notice("@" + item.handle + "：关注状态已更新。");
    } catch (error) {
      button.disabled = false;
      notice(error instanceof Error ? error.message : "检查失败");
    }
    return;
  }
  if (action === "copy") {
    const text = item.replyDraft.trim();
    if (!text) {
      notice("请先填写回复内容。");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notice("回复已复制；请在原帖中检查并发送。");
    } catch {
      notice("复制失败，请手动选择回复文字。");
    }
    return;
  }
  const changes = {
    "mark-following": { followStatus: "following" },
    "mark-replied": { replyStatus: "replied", repliedAt: new Date().toISOString() },
    "skip": { replyStatus: "skipped" },
    "reopen": { replyStatus: "pending", repliedAt: null },
    "reset-reply": { replyDraft: defaultReply, customReply: false }
  }[action];
  if (!changes) return;
  candidates = updateCandidate(candidates, id, changes);
  enqueueSave({ candidates });
  render();
  notice(action === "mark-replied" ? "已记录为已回复。此操作不会在 X 上发送评论。" : "记录已更新。");
}

function render() {
  const summary = summarizeCandidates(candidates);
  elements.summary.textContent = summary.pending + " 待处理 · " + summary.replied + " 已回复 · " + summary.skipped + " 已跳过";
  for (const button of document.querySelectorAll("[data-filter]")) {
    button.classList.toggle("active", button.dataset.filter === filter);
  }
  const shown = candidates.filter((item) => filter === "all" || item.replyStatus === filter);
  shown.sort((a, b) => {
    if (a.replyStatus === "pending" && b.replyStatus === "pending") {
      return Number(b.intent === "matched") - Number(a.intent === "matched");
    }
    return 0;
  });
  elements.candidateList.innerHTML = shown.length ? shown.map(renderCandidate).join("")
    : '<div class="empty-state">' + (candidates.length ? "当前筛选下没有候选帖子。" : "导入帖子后，在这里逐条查看和处理。") + "</div>";
}

function renderCandidate(item) {
  const id = escapeHtml(item.id);
  const intentText = item.intent === "matched" ? "文字显示求互关" : "待核对原帖";
  const followText = {
    following: "已关注", "not-following": "未关注",
    unavailable: "无法确认", unknown: "关注状态待查"
  }[item.followStatus] || "关注状态待查";
  const replyText = {
    pending: "待处理", replied: "已回复", skipped: "已跳过"
  }[item.replyStatus] || "待处理";
  const postText = item.postText
    ? '<p class="post-text">' + escapeHtml(item.postText) + "</p>"
    : '<p class="post-text missing">导入时未提供原文，请打开原帖核对互关意图。</p>';
  const activeActions = item.replyStatus === "pending"
    ? '<button class="record-button" data-action="mark-following" data-id="' + id + '">标记已关注</button>' +
      '<button class="record-button" data-action="mark-replied" data-id="' + id + '">标记已回复</button>' +
      '<button class="record-button danger" data-action="skip" data-id="' + id + '">跳过</button>'
    : '<button class="record-button" data-action="reopen" data-id="' + id + '">重新处理</button>';
  return '<article class="candidate">' +
    '<div class="candidate-header"><span class="handle">@' + escapeHtml(item.handle) + '</span>' +
    '<div class="badges"><span class="badge ' + escapeHtml(item.intent) + '">' + intentText + '</span>' +
    '<span class="badge ' + escapeHtml(item.followStatus) + '">' + followText + '</span>' +
    '<span class="badge">' + replyText + '</span></div></div>' +
    postText +
    '<a class="post-link" href="' + escapeHtml(item.postUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.postUrl) + '</a>' +
    '<div class="candidate-actions"><button class="mini-button" data-action="open-post" data-id="' + id + '">打开原帖</button>' +
    '<button class="mini-button" data-action="open-profile" data-id="' + id + '">打开主页</button>' +
    '<button class="mini-button" data-action="check-follow" data-id="' + id + '">检查关注状态</button></div>' +
    '<label class="reply-label" for="reply-' + id + '">此帖回复草稿（可单独编辑）</label>' +
    '<textarea class="reply-draft" id="reply-' + id + '" data-id="' + id + '" spellcheck="false">' + escapeHtml(item.replyDraft || "") + '</textarea>' +
    '<div class="candidate-actions"><button class="mini-button" data-action="copy" data-id="' + id + '">复制回复</button>' +
    '<button class="mini-button" data-action="reset-reply" data-id="' + id + '">恢复模板</button>' + activeActions + '</div>' +
    '</article>';
}

function enqueueSave(changes) {
  const snapshot = structuredClone(changes);
  saveQueue = saveQueue.then(() => chrome.storage.local.set(snapshot)).catch(() => {
    notice("本地保存失败，请重新打开扩展确认数据。");
  });
  return saveQueue;
}

function notice(message) {
  elements.notice.textContent = message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
}
