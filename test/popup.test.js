import test from "node:test";
import assert from "node:assert/strict";
import { parsePostCandidates } from "../url-utils.js";

test("保留帖子链接、原文并识别明确互关文字", () => {
  assert.deepEqual(parsePostCandidates("求互关，关注必回 https://twitter.com/Alice/status/123?s=20"), [{
    id: "alice:123",
    handle: "Alice",
    postId: "123",
    postUrl: "https://x.com/Alice/status/123",
    profileUrl: "https://x.com/Alice",
    postText: "求互关，关注必回",
    intent: "matched"
  }]);
});

test("只有链接时保留候选但要求人工核对", () => {
  const result = parsePostCandidates("https://x.com/bob/status/456");
  assert.equal(result.length, 1);
  assert.equal(result[0].intent, "review");
  assert.equal(result[0].postText, "");
});

test("同一账号去重，优先保留明确求互关的帖子", () => {
  const result = parsePostCandidates("https://x.com/Alice/status/1\n互粉 https://x.com/alice/status/2");
  assert.equal(result.length, 1);
  assert.equal(result[0].postId, "2");
  assert.equal(result[0].intent, "matched");
});

test("忽略主页、非 X 链接和没有数字帖子 ID 的地址", () => {
  assert.deepEqual(parsePostCandidates("https://x.com/home\nhttps://example.com/a/status/1\nhttps://x.com/a/status/nope"), []);
});

test("否定互关意图需要人工核对", () => {
  const result = parsePostCandidates("不互关，请勿打扰 https://x.com/alice/status/9");
  assert.equal(result[0].intent, "review");
});
