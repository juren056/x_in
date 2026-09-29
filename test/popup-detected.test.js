import test from "node:test";
import assert from "node:assert/strict";

test("只有待关注帖子时一键评论可点击并提示先关注", async () => {
  const postUrl = "https://x.com/alice/status/123";
  const storage = {
    replyTemplate: "已关注，互关！",
    replyCandidates: [{ handle: "alice", postUrl, status: "detected", text: "#互关" }]
  };
  const elements = new Map();
  let onReady;
  let confirmText = "";
  let batchMessage;
  globalThis.document = {
    activeElement: null,
    addEventListener(type, callback) { if (type === "DOMContentLoaded") onReady = callback; },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        value: "", textContent: "", innerHTML: "", hidden: false, disabled: false,
        style: {}, addEventListener(type, callback) { this[type] = callback; }
      });
      return elements.get(selector);
    }
  };
  globalThis.window = { confirm(message) { confirmText = message; return true; } };
  globalThis.chrome = {
    storage: { local: {
      async get() { return { ...storage }; },
      async set(value) { Object.assign(storage, value); }
    } },
    runtime: {
      onMessage: { addListener() {} },
      async sendMessage(message) {
        if (message.type === "run-reply-batch") {
          batchMessage = message;
          return { ok: true, job: { status: "running", total: 1, processed: 0, sent: 0 } };
        }
        return { job: null };
      }
    },
    tabs: { async create() {} }
  };
  await import("../popup.js");
  await onReady();
  assert.equal(elements.get("#timelineScrollLimit").value, "30");
  assert.equal(elements.get("#replyBatchButton").disabled, false);
  assert.match(elements.get("#replyBatchStatus").textContent, /待关注 1 条/);
  await elements.get("#replyBatchButton").click();
  assert.match(confirmText, /先关注账号/);
  assert.deepEqual(batchMessage.postUrls, [postUrl]);
});
