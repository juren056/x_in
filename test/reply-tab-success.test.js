import test from "node:test";
import assert from "node:assert/strict";

test("确认评论已发布后才关闭扩展创建的标签页", async () => {
  const postUrl = "https://x.com/alice/status/123";
  const storage = {
    replyCandidates: [{ handle: "alice", postUrl, text: "#互关", status: "pending" }]
  };
  let listener;
  let removed = 0;
  let submitCalls = 0;
  const updatedListeners = new Set();
  const removedListeners = new Set();
  globalThis.chrome = {
    storage: { local: {
      async get() { return { ...storage }; },
      async set(value) { Object.assign(storage, value); }
    } },
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage() {}
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
      async create() { return { id: 9 }; },
      async update(id) {
        for (const fn of [...updatedListeners]) fn(id, { status: "complete" });
      },
      async sendMessage(_id, message) {
        if (message.type === "discover-own-handle") return { ok: true, handle: "me" };
        if (message.type === "submit-reply") {
          submitCalls += 1;
          return { ok: true, data: { status: "sent", message: "已在页面确认回复" } };
        }
        throw new Error("unexpected message");
      },
      async remove() { removed += 1; }
    }
  };
  await import("../background.js");
  const response = await new Promise((resolve) => {
    assert.equal(listener({ type: "run-reply-batch", text: "已关注", postUrls: [postUrl] }, null, resolve), true);
  });
  assert.equal(response.ok, true);
  for (let attempt = 0; attempt < 200 && (storage.activeReplyJob?.status !== "complete" || removed === 0); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(storage.activeReplyJob.status, "complete");
  assert.equal(storage.replyCandidates[0].status, "done");
  assert.equal(submitCalls, 1);
  assert.equal(removed, 1);
});
