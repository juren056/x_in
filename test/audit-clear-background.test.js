import test from "node:test";
import assert from "node:assert/strict";
import { mergeAuditPosts, labelAuditPost, buildFeedbackExport } from "../audit-data.js";

test("audit clear keeps reply queue and human labels without restoring old posts", async () => {
  const oldTime = "2026-09-26T00:00:00.000Z";
  const post = { postUrl: "https://x.com/alice/status/123", handle: "alice", text: "ordinary", collectedAt: oldTime };
  const auditPosts = mergeAuditPosts([], [post], oldTime);
  const auditLabels = labelAuditPost([], post.postUrl, true, "reviewed", oldTime, auditPosts[0]);
  const disk = buildFeedbackExport(auditPosts, auditLabels, oldTime);
  const storage = {
    auditPosts, auditLabels, timelinePosts: [post],
    replyCandidates: [{ postUrl: "https://x.com/bob/status/456", status: "pending" }],
    draftUrls: "https://x.com/alice"
  };
  let listener;
  globalThis.chrome = {
    storage: { local: {
      async get() { return { ...storage }; },
      async set(value) { Object.assign(storage, value); }
    } },
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage() {},
      sendNativeMessage(_host, message, callback) {
        assert.equal(message.action, "read");
        callback({ ok: true, path: "C:\\Audit", data: disk });
      }
    }
  };
  await import("../background.js");
  const call = (type) => new Promise((resolve) => listener({ type }, null, resolve));
  assert.equal((await call("clear-audit-history")).ok, true);
  assert.equal(storage.auditPosts.length, 0);
  assert.equal(storage.replyCandidates.length, 1);
  assert.equal(storage.draftUrls, "https://x.com/alice");
  assert.equal((await call("audit-load")).ok, true);
  assert.equal(storage.auditPosts.length, 0);
  assert.equal(storage.auditLabels.length, 1);
});
