import test from "node:test";
import assert from "node:assert/strict";

test("打开弹窗时从已保存时间线补齐同账号的其他匹配帖", async () => {
  let listener;
  const storage = {
    replyAssistEnabled: true,
    replyCandidates: [{
      handle: "alice", postUrl: "https://x.com/alice/status/1",
      text: "#互关", tags: ["互关"], status: "done"
    }],
    timelinePosts: [
      { handle: "alice", postUrl: "https://x.com/alice/status/1", text: "#互关" },
      { handle: "alice", postUrl: "https://x.com/alice/status/2", text: "#互评" },
      { handle: "bob", postUrl: "https://x.com/bob/status/3", text: "#互关" }
    ]
  };
  globalThis.chrome = {
    storage: { local: {
      async get() { return { ...storage }; },
      async set(value) { Object.assign(storage, value); }
    } },
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      async sendMessage() {}
    }
  };
  await import("../background.js");
  const response = await new Promise((resolve) => {
    assert.equal(listener({ type: "get-reply-batch" }, null, resolve), true);
  });
  assert.equal(response.job, null);
  assert.equal(storage.replyCandidates.length, 3);
  assert.equal(storage.replyCandidates[0].status, "done");
  assert.equal(storage.replyCandidates[1].postUrl, "https://x.com/alice/status/2");
  assert.equal(storage.replyCandidates[1].status, "pending");
  assert.equal(storage.replyCandidates[2].postUrl, "https://x.com/bob/status/3");
  assert.equal(storage.replyCandidates[2].status, "detected");
  storage.replyCandidates = [];
  await new Promise((resolve) => {
    listener({ type: "get-reply-batch" }, null, resolve);
  });
  assert.equal(storage.replyCandidates.length, 3);
  assert.ok(storage.replyCandidates.every((item) => item.status === "detected"));
  storage.replyCandidates = [];
  storage.timelinePosts = [{ handle: "blue", postUrl: "https://x.com/blue/status/4",
    text: "不求互关刷量，就想认识真诚的蓝朋友。#蓝V互关" }];
  await new Promise((resolve) => {
    listener({ type: "get-reply-batch" }, null, resolve);
  });
  assert.equal(storage.replyCandidates.length, 1);
  assert.equal(storage.replyCandidates[0].postUrl, "https://x.com/blue/status/4");
  assert.equal(storage.replyCandidates[0].status, "detected");
});
