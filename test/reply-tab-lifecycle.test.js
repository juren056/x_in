import test from "node:test";
import assert from "node:assert/strict";

test("uncertain reply is skipped, its tab stays open, and the next post is processed", async () => {
  const firstUrl = "https://x.com/alice/status/123";
  const secondUrl = "https://x.com/bob/status/456";
  const storage = {
    replyCandidates: [
      { handle: "alice", postUrl: firstUrl, text: "#互关", status: "pending" },
      { handle: "bob", postUrl: secondUrl, text: "#互关", status: "pending" }
    ]
  };
  let listener;
  const removed = [];
  let created = 0;
  const submitted = [];
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
      async create() { created += 1; return { id: created + 6 }; },
      async update(id) {
        for (const fn of [...updatedListeners]) fn(id, { status: "complete" });
      },
      async sendMessage(_id, message) {
        if (message.type === "discover-own-handle") return { ok: true, handle: "me" };
        if (message.type === "submit-reply") {
          submitted.push(message.postUrl);
          return { ok: true, data: message.postUrl === firstUrl
            ? { status: "uncertain", message: "已调用回复按钮，未确认发布" }
            : { status: "sent", message: "已确认发布" } };
        }
        throw new Error("unexpected message");
      },
      async remove(id) { removed.push(id); }
    }
  };
  await import("../background.js");
  const response = await new Promise((resolve) => {
    assert.equal(listener({ type: "run-reply-batch", text: "已关注", postUrls: [firstUrl, secondUrl] }, null, resolve), true);
  });
  assert.equal(response.ok, true);
  for (let attempt = 0; attempt < 300 && storage.activeReplyJob?.status !== "complete"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(storage.activeReplyJob.status, "complete");
  assert.equal(storage.activeReplyJob.sent, 1);
  assert.equal(storage.activeReplyJob.uncertain, 1);
  assert.equal(storage.activeReplyJob.reviewItems[0].tabId, 7);
  assert.deepEqual(submitted, [firstUrl, secondUrl]);
  assert.equal(storage.replyCandidates[0].status, "uncertain");
  assert.equal(storage.replyCandidates[1].status, "done");
  assert.deepEqual(removed, [8]);
});
