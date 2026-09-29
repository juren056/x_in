import test from "node:test";
import assert from "node:assert/strict";

test("点击重置状态后，列表和一键评论按钮同步恢复", async () => {
  const postUrl = "https://x.com/a/status/1";
  const storage = {
    replyTemplate: "已关注，互关！",
    timelineScrollLimit: 25,
    activeReplyJob: { status: "paused", reviewPostUrl: postUrl },
    replyCandidates: [{
      handle: "a", postUrl, text: "#互关", tags: ["互关"],
      status: "failed", error: "编辑框写入失败", attemptedAt: "yesterday"
    }, {
      handle: "b", postUrl: "https://x.com/b/status/2",
      text: "#互评 第二条", tags: ["互评"], status: "done"
    }]
  };
  const elements = new Map();
  let onReady;
  globalThis.document = {
    activeElement: null,
    addEventListener(type, callback) {
      if (type === "DOMContentLoaded") onReady = callback;
    },
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, {
          value: "", textContent: "", innerHTML: "", hidden: false, disabled: false,
          style: {}, addEventListener(type, callback) { this[type] = callback; }
        });
      }
      return elements.get(selector);
    }
  };
  globalThis.window = { confirm: () => true };
  globalThis.chrome = {
    storage: { local: {
      async get() { return { ...storage }; },
      async set(value) { Object.assign(storage, value); }
    } },
    runtime: {
      onMessage: { addListener() {} },
      async sendMessage(message) {
        if (message.type === "clear-reply-history") {
          Object.assign(storage, { replyCandidates: [], activeReplyJob: null });
          return { ok: true };
        }
        return { job: null };
      }
    },
    tabs: { async create() {} }
  };
  await import("../popup.js");
  await onReady();
  assert.equal(elements.get("#replyAssistToggle").checked, true);
  const scrollInput = elements.get("#timelineScrollLimit");
  assert.equal(scrollInput.value, "25");
  scrollInput.value = "12";
  await scrollInput.change();
  assert.equal(storage.timelineScrollLimit, 12);
  const list = elements.get("#replyQueue");
  assert.match(list.innerHTML, /重置状态/);
  assert.equal(elements.get("#replyBatchButton").disabled, true);
  assert.match(list.innerHTML, /@b/);
  assert.match(elements.get("#replyBatchStatus").textContent, /已暂停/);
  await list.click({
    target: { closest: () => ({ dataset: { replyAction: "reset", url: postUrl } }) }
  });
  assert.equal(storage.replyCandidates[0].status, "pending");
  assert.equal(storage.replyCandidates[0].error, undefined);
  assert.equal(storage.replyCandidates[0].attemptedAt, undefined);
  assert.match(list.innerHTML, /待回复/);
  assert.doesNotMatch(list.innerHTML, /重置状态/);
  assert.equal(elements.get("#replyBatchButton").disabled, false);
  assert.match(elements.get("#replyBatchStatus").textContent, /累计匹配 2 条/);
  await elements.get("#clearReplyHistoryButton").click();
  assert.equal(storage.replyCandidates.length, 0);
  assert.match(elements.get("#replyBatchStatus").textContent, /累计匹配 0 条/);
  assert.equal(elements.get("#clearReplyHistoryButton").disabled, true);
});
