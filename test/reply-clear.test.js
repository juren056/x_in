import test from "node:test";
import assert from "node:assert/strict";

test("清零累计列表后旧帖不回填，新扫描帖重新累计", async () => {
  let listener;
  const postUrl = "https://x.com/alice/status/1";
  const storage = {
    replyAssistEnabled: true,
    draftUrls: "https://x.com/alice",
    followingHandles: ["alice"],
    timelinePosts: [{ handle: "alice", postUrl, text: "#互关" }],
    replyCandidates: [{
      handle: "alice", postUrl, text: "#互关", status: "done"
    }]
  };
  globalThis.chrome = {
    storage: { local: {
      async get() { return { ...storage }; },
      async set(value) { Object.assign(storage, value); }
    } },
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage() {}
    }
  };
  await import("../background.js");
  const call = (type) => new Promise((resolve) => listener({ type }, null, resolve));
  assert.equal((await call("clear-reply-history")).ok, true);
  assert.equal(storage.replyCandidates.length, 0);
  assert.equal(storage.draftUrls, "https://x.com/alice");
  assert.equal(storage.timelinePosts.length, 1);
  await call("get-reply-batch");
  assert.equal(storage.replyCandidates.length, 0);

  storage.timelinePosts[0] = {
    ...storage.timelinePosts[0],
    collectedAt: new Date(Date.parse(storage.replyClearedAt) + 1000).toISOString()
  };
  await call("get-reply-batch");
  assert.equal(storage.replyCandidates.length, 1);
  assert.equal(storage.replyCandidates[0].status, "pending");
});
