import test from "node:test";
import assert from "node:assert/strict";

test("one failed reply is skipped and later candidates fill ten confirmed successes", async () => {
  const urls = Array.from({ length: 12 }, (_, index) => "https://x.com/user/status/" + (100 + index));
  const storage = {
    replyCandidates: urls.map((postUrl) => ({
      handle: "user", postUrl, text: "#互关", status: "pending"
    }))
  };
  let listener;
  let removed = 0;
  const submitted = [];
  const updatedListeners = new Set();
  const removedListeners = new Set();
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, ms, ...args) =>
    realSetTimeout(callback, ms === 1500 ? 0 : ms, ...args);
  try {
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
        async create() { return { id: 41 }; },
        async update(id) {
          for (const fn of [...updatedListeners]) fn(id, { status: "complete" });
        },
        async sendMessage(_id, message) {
          if (message.type === "discover-own-handle") return { ok: true, handle: "me" };
          if (message.type === "submit-reply") {
            submitted.push(message.postUrl);
            return { ok: true, data: message.postUrl === urls[0]
              ? { status: "failed", message: "找不到指定原帖" }
              : { status: "sent", message: "已确认发布" } };
          }
          throw new Error("unexpected message");
        },
        async remove() { removed += 1; }
      }
    };
    await import("../background.js");
    const response = await new Promise((resolve) =>
      listener({ type: "run-reply-batch", text: "已关注", postUrls: urls }, null, resolve));
    assert.equal(response.ok, true);
    for (let attempt = 0; attempt < 300 && (storage.activeReplyJob?.status !== "complete" || !removed); attempt += 1) {
      await new Promise((resolve) => realSetTimeout(resolve, 10));
    }
    assert.equal(storage.activeReplyJob.status, "complete");
    assert.equal(storage.activeReplyJob.sent, 10);
    assert.equal(storage.activeReplyJob.failed, 1);
    assert.equal(storage.activeReplyJob.processed, 11);
    assert.deepEqual(submitted, urls.slice(0, 11));
    assert.equal(storage.replyCandidates[0].status, "failed");
    assert.ok(storage.replyCandidates.slice(1, 11).every((item) => item.status === "done"));
    assert.equal(storage.replyCandidates[11].status, "pending");
    assert.equal(removed, 1);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});
