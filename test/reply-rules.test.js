import test from "node:test";
import assert from "node:assert/strict";
import { appendReplyCandidates, classifyFriendPost, discoverReplyCandidates, findReplyPost, findReplyPosts, matchReplyTags, postsSinceReplyClear } from "../reply-rules.js";

test("只匹配指定的完整话题标签", () => {
  assert.deepEqual(matchReplyTags("欢迎来互 #交个朋友 #互关"), ["互关", "交个朋友"]);
  assert.deepEqual(matchReplyTags("正文说互关但没有标签"), []);
  assert.deepEqual(matchReplyTags("#互关系 #蓝V"), []);
});

test("从同一账号的帖子中选择带匹配标签的原帖", () => {
  const posts = [
    { handle: "Alice", postUrl: "https://x.com/Alice/status/1", text: "日常内容" },
    { handle: "Alice", postUrl: "https://x.com/Alice/status/2", text: "#互评 欢迎来聊" },
    { handle: "Bob", postUrl: "https://x.com/Bob/status/3", text: "#互关" }
  ];
  assert.equal(findReplyPost(posts, "@alice")?.postUrl, "https://x.com/Alice/status/2");
  assert.equal(findReplyPost(posts, "@carol"), null);
});
test("同一账号的全部匹配帖子都入队，按帖子地址去重并保留既有状态", () => {
  const posts = [
    { handle: "Alice", postUrl: "https://x.com/Alice/status/1", text: "#互关 第一条" },
    { handle: "Alice", postUrl: "https://x.com/Alice/status/2", text: "#互评 第二条" },
    { handle: "Alice", postUrl: "https://x.com/Alice/status/3", text: "普通帖子" },
    { handle: "Bob", postUrl: "https://x.com/Bob/status/4", text: "#互关" }
  ];
  assert.deepEqual(findReplyPosts(posts, "@alice").map((post) => post.postUrl),
    [posts[0].postUrl, posts[1].postUrl]);
  const existing = [{ handle: "alice", postUrl: posts[0].postUrl, status: "done" }];
  const merged = appendReplyCandidates(existing, posts, ["@Alice"], "now");
  assert.equal(merged.length, 2);
  assert.equal(merged[0], existing[0]);
  assert.equal(merged[1].postUrl, posts[1].postUrl);
  assert.equal(merged[1].status, "pending");
  assert.equal(appendReplyCandidates(merged, posts, ["@Alice"]).length, 2);
});
test("蓝朋友示例按标签识别，明确交友邀请也能按正文识别", () => {
  const example = "大家都在过节吗？没有 #蓝朋友 的一天！浇不动了吗？等蓝朋友坐七彩祥云来拉我一把";
  assert.equal(classifyFriendPost(example).matched, true);
  assert.deepEqual(classifyFriendPost(example).tags, ["蓝朋友"]);
  assert.equal(classifyFriendPost("欢迎来交朋友，一起互动").reason, "content");
  assert.equal(classifyFriendPost("今天和朋友吃饭").matched, false);
  assert.equal(classifyFriendPost("不互关，请勿打扰").matched, false);
});

test("识别所有匹配帖，未关注先待关注，确认关注后再待回复", () => {
  const posts = [
    { handle: "alice", postUrl: "https://x.com/alice/status/1", text: "#蓝朋友 欢迎来认识" },
    { handle: "bob", postUrl: "https://x.com/bob/status/2", text: "欢迎来交朋友，一起互动" }
  ];
  const detected = discoverReplyCandidates([], posts);
  assert.deepEqual(detected.map((item) => item.status), ["detected", "detected"]);
  const ready = discoverReplyCandidates(detected, posts, ["@alice"]);
  assert.deepEqual(ready.map((item) => item.status), ["pending", "detected"]);
  assert.equal(discoverReplyCandidates(ready, posts, ["@alice"]).length, 2);
});
test("清零后旧缓存不回填，重新采集的帖子可以重新累计", () => {
  const cutoff = "2026-09-26T10:00:00.000Z";
  const posts = [
    { postUrl: "https://x.com/a/status/1" },
    { postUrl: "https://x.com/a/status/2", collectedAt: "2026-09-26T09:59:59.000Z" },
    { postUrl: "https://x.com/a/status/3", collectedAt: "2026-09-26T10:00:01.000Z" }
  ];
  assert.deepEqual(postsSinceReplyClear(posts, cutoff), [posts[2]]);
  assert.equal(postsSinceReplyClear(posts, null).length, 3);
});
