import test from "node:test";
import assert from "node:assert/strict";

test("后台加载不完整时显示当前 X 首页扫描入口", async () => {
  const storage = {
    draftUrls: "https://x.com/old",
    replyAssistEnabled: false,
    timelineScrollLimit: 30,
    timelineScan: { status: "partial", mode: "background", scrollLimit: 30,
      found: 4, total: 4, scannedPosts: 4, rounds: 8, stopReason: "stalled" },
    replyCandidates: []
  };
  const elements = new Map();
  let onReady;
  let scanMessage;
  globalThis.document = {
    activeElement: null,
    addEventListener(type, callback) { if (type === "DOMContentLoaded") onReady = callback; },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        value: "", textContent: "", innerHTML: "", hidden: false, disabled: false,
        style: {}, addEventListener(type, callback) { this[type] = callback; }, focus() {}
      });
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
        if (message.type === "collect-timeline") {
          scanMessage = message;
          return { ok: true, urls: ["https://x.com/new"], scannedPosts: 12,
            rounds: 30, stopReason: "limit" };
        }
        return { job: null };
      }
    },
    tabs: { async create() {} }
  };
  await import("../popup.js");
  await onReady();
  assert.equal(elements.get("#replyAssistToggle").checked, false);
  const fallback = elements.get("#collectCurrentTimelineButton");
  assert.equal(fallback.hidden, false);
  assert.match(elements.get("#actionNote").textContent, /扫描 8 \/ 30 次/);
  await fallback.click();
  assert.equal(scanMessage.mode, "current");
  assert.equal(scanMessage.scrollLimit, 30);
  assert.equal(fallback.hidden, true);
});
