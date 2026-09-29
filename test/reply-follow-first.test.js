import test from "node:test";
import assert from "node:assert/strict";

test("待关注帖子先关注成功，再向原帖评论", async () => {
  const postUrl = "https://x.com/alice/status/123";
  const storage = {
    replyCandidates: [{ handle: "alice", postUrl, text: "#互关", status: "detected" }]
  };
  let listener;
  let removed = 0;
  const actions = [];
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
      async create() { return { id: 31 }; },
      async update(id, options) {
        actions.push(options.url);
        for (const fn of [...updatedListeners]) fn(id, { status: "complete" });
      },
      async sendMessage(_id, message) {
        if (message.type === "discover-own-handle") return { ok: true, handle: "me" };
        if (message.type === "inspect-profile") {
          actions.push("follow");
          assert.equal(message.follow, true);
          return { ok: true, data: { status: "followed" } };
        }
        if (message.type === "submit-reply") {
          actions.push("reply");
          return { ok: true, data: { status: "sent" } };
        }
        throw new Error("unexpected message");
      },
      async remove() { removed += 1; }
    }
  };
  await import("../background.js");
  const response = await new Promise((resolve) => {
    assert.equal(listener({ type: "run-reply-batch", text: "已关注，互关！", postUrls: [postUrl] }, null, resolve), true);
  });
  assert.equal(response.ok, true);
  for (let attempt = 0; attempt < 200 && (storage.activeReplyJob?.status !== "complete" || !removed); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(storage.activeReplyJob.status, "complete");
  assert.equal(storage.replyCandidates[0].status, "done");
  assert.ok(storage.followingHandles.includes("alice"));
  assert.deepEqual(actions, ["https://x.com/home", "https://x.com/alice", "follow", postUrl, "reply"]);
  assert.equal(removed, 1);
});
