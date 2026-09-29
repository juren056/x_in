import test from "node:test";
import assert from "node:assert/strict";

test("当前 X 首页扫描不创建或关闭用户标签页", async () => {
  const storage = { draftUrls: "", replyAssistEnabled: false };
  let listener;
  let created = 0;
  let removed = 0;
  let queried = 0;
  globalThis.chrome = {
    storage: { local: {
      async get() { return { ...storage }; },
      async set(value) { Object.assign(storage, value); }
    } },
    runtime: { onMessage: { addListener(fn) { listener = fn; } }, async sendMessage() {} },
    tabs: {
      async query() { queried += 1; return [{ id: 41, url: "https://x.com/home" }]; },
      async create() { created += 1; throw new Error("must not create"); },
      async remove() { removed += 1; },
      async sendMessage(id, message) {
        assert.equal(id, 41);
        assert.equal(message.type, "collect-for-you");
        assert.equal(message.scrollLimit, 30);
        return { ok: true, handles: ["alice"], posts: [], scannedPosts: 1, rounds: 30,
          stopReason: "limit", visibilityState: "visible", scrollDistance: 18000 };
      }
    }
  };
  await import("../background.js");
  const response = await new Promise((resolve) => {
    assert.equal(listener({ type: "collect-timeline", mode: "current", scrollLimit: 30 }, null, resolve), true);
  });
  assert.equal(response.ok, true);
  assert.equal(queried, 1);
  assert.equal(created, 0);
  assert.equal(removed, 0);
  assert.equal(storage.timelineScan.status, "complete");
  assert.equal(storage.timelineScan.mode, "current");
});
