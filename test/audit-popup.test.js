import test from "node:test";
import assert from "node:assert/strict";

test("audit panel renders every accumulated rejection and clear empties only that list", async () => {
  const auditPosts = Array.from({ length: 65 }, (_, index) => ({
    postUrl: "https://x.com/user/status/" + (index + 100),
    handle: "user", text: "ordinary " + index, matched: false,
    reason: "no-match", firstSeenAt: "2026-09-26T00:00:00.000Z",
    lastSeenAt: "2026-09-26T00:00:00.000Z"
  }));
  auditPosts.push({ postUrl: "https://x.com/blue/status/999", handle: "blue",
    text: "不求互关刷量，只想认识真诚的蓝朋友。#蓝V互关",
    matched: false, reason: "no-match", classifierVersion: "0.5.11",
    firstSeenAt: "2026-09-26T00:00:00.000Z", lastSeenAt: "2026-09-26T00:00:00.000Z" });
  const storage = {
    auditPosts, auditLabels: [{ postUrl: auditPosts[0].postUrl, shouldMatch: true, markedAt: "2026-09-26T01:00:00.000Z" }],
    timelinePosts: [], replyCandidates: [], draftUrls: "https://x.com/user"
  };
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
  globalThis.chrome = {
    storage: { local: {
      async get() { return { ...storage }; },
      async set(value) { Object.assign(storage, value); }
    } },
    runtime: {
      onMessage: { addListener() {} },
      async sendMessage(message) {
        if (message.type === "audit-load") return { ok: true };
        if (message.type === "clear-audit-history") {
          storage.auditPosts = [];
          storage.auditClearedAt = new Date().toISOString();
          return { ok: true };
        }
        if (message.type === "audit-info") return { ok: true, path: "C:\\Audit" };
        return { job: null };
      }
    }
  };
  await import("../popup.js");
  await ready();
  assert.equal(elements.get("#auditCount").textContent, "65 条未通过");
  assert.equal((elements.get("#auditList").innerHTML.match(/<article class="audit-item">/g) || []).length, 65);
  assert.equal(storage.auditPosts.find((post) => post.handle === "blue").matched, true);
  await elements.get("#clearAuditButton").click();
  assert.equal(elements.get("#auditCount").textContent, "0 条未通过");
  assert.equal(storage.auditLabels.length, 1);
  assert.equal(storage.draftUrls, "https://x.com/user");
});
