import test from "node:test";
import assert from "node:assert/strict";

test("saved default reply is restored on reopening despite later temporary edits", async () => {
  const storage = { replyTemplate: "old draft", replyCandidates: [] };
  globalThis.chrome = {
    storage: { local: {
      async get() { return { ...storage }; },
      async set(value) { Object.assign(storage, value); }
    } },
    runtime: {
      onMessage: { addListener() {} },
      async sendMessage(message) {
        if (message.type === "audit-info") return { ok: false };
        return { job: null };
      }
    }
  };
  async function openPopup(suffix) {
    const elements = new Map();
    let ready;
    globalThis.document = {
      activeElement: null,
      addEventListener(type, callback) { if (type === "DOMContentLoaded") ready = callback; },
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, {
          value: "", textContent: "", innerHTML: "", hidden: false, disabled: false,
          style: {}, addEventListener(type, callback) { this[type] = callback; }
        });
        return elements.get(selector);
      }
    };
    globalThis.window = { confirm() { return true; } };
    await import("../popup.js?" + suffix);
    await ready();
    return elements;
  }
  const first = await openPopup("default-first");
  assert.equal(first.get("#replyTemplate").value, "old draft");
  first.get("#replyTemplate").value = "已关注，欢迎互关！";
  first.get("#replyTemplate").input();
  await first.get("#setDefaultReplyButton").click();
  assert.equal(storage.defaultReply, "已关注，欢迎互关！");
  assert.equal(first.get("#setDefaultReplyButton").disabled, true);
  first.get("#replyTemplate").value = "仅本次使用";
  first.get("#replyTemplate").input();
  assert.equal(storage.replyTemplate, "仅本次使用");
  const reopened = await openPopup("default-second");
  assert.equal(reopened.get("#replyTemplate").value, "已关注，欢迎互关！");
  assert.equal(reopened.get("#setDefaultReplyButton").textContent, "已设为默认");
});
