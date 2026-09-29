import test from "node:test";
import assert from "node:assert/strict";

test("首页扫描使用非活动标签页且保存结果", async () => {
  const storage = { draftUrls: "https://x.com/existing" };
  let listener;
  let created;
  let removed = false;
  let keptLoaded = false;
  const updatedListeners = new Set();
  const removedListeners = new Set();
  globalThis.chrome = {
    storage: { local: {
      async get() { return { ...storage }; },
      async set(value) { Object.assign(storage, value); }
    } },
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage() {},
      sendNativeMessage(_host, message, callback) { callback({ ok: true, path: "C:\\Audit", file: "C:\\Audit\\misclassifications.json", savedAt: "2026-09-26T00:00:00Z" }); }
    },
    tabs: {
      onUpdated: {
        addListener(fn) { updatedListeners.add(fn); },
        removeListener(fn) { updatedListeners.delete(fn); }
      },
      onRemoved: {
        addListener(fn) { removedListeners.add(fn); },
        removeListener(fn) { removedListeners.delete(fn); }
      },
      async create(options) { created = options; return { id: 21 }; },
      async update(id, options) {
        if (options.autoDiscardable === false) {
          keptLoaded = true;
          return;
        }
        for (const fn of [...updatedListeners]) fn(id, { status: "complete" });
      },
      async sendMessage(_id, message) {
        assert.equal(message.type, "collect-for-you");
        assert.equal(message.scrollLimit, 7);
        return { ok: true, handles: ["alice"], scannedPosts: 2, rounds: 7,
          posts: [{ handle: "alice", postUrl: "https://x.com/alice/status/1", text: "#互关" },
            { handle: "bob", postUrl: "https://x.com/bob/status/2", text: "Ordinary post" }],
          stopReason: "limit", visibilityState: "hidden", scrollDistance: 5600 };
      },
      async remove() { removed = true; }
    }
  };
  await import("../background.js");
  const response = await new Promise((resolve) => {
    assert.equal(listener({ type: "collect-timeline", scrollLimit: 7 }, null, resolve), true);
  });
  assert.equal(response.ok, true);
  assert.equal(created.active, false);
  assert.equal(keptLoaded, true);
  assert.equal(storage.timelineScan.status, "complete");
  assert.equal(storage.timelineScan.scrollLimit, 7);
  assert.equal(storage.timelineScan.found, 1);
  assert.equal(storage.timelineScan.total, 2);
  assert.equal(storage.replyCandidates[0].status, "detected");
  assert.equal(storage.auditPosts.length, 2);
  assert.equal(storage.auditPosts.find((post) => post.handle === "bob").matched, false);
  const label = await new Promise((resolve) => listener({
    type: "audit-label", postUrl: "https://x.com/bob/status/2", shouldMatch: true, note: "friend post"
  }, null, resolve));
  assert.equal(label.ok, true);
  assert.equal(storage.auditLabels[0].shouldMatch, true);
  assert.equal(storage.auditSyncPending, false);
  assert.match(storage.draftUrls, /https:\/\/x.com\/alice/);
  assert.equal(removed, true);
});
