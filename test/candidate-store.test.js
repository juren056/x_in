import test from "node:test";
import assert from "node:assert/strict";
import { mergeCandidates, summarizeCandidates, updateCandidate } from "../candidate-store.js";
import { parsePostCandidates } from "../url-utils.js";

test("新候选继承默认回复，但单条编辑不会改动默认模板", () => {
  const imported = parsePostCandidates("互关 https://x.com/Alice/status/1");
  const first = mergeCandidates([], imported, "你好，互关吗？");
  assert.equal(first.added, 1);
  assert.equal(first.candidates[0].replyDraft, "你好，互关吗？");
  const edited = updateCandidate(first.candidates, "alice:1", { replyDraft: "你好 Alice", customReply: true });
  assert.equal(edited[0].replyDraft, "你好 Alice");
  assert.equal(first.candidates[0].replyDraft, "你好，互关吗？");
});

test("重复导入保留已处理记录和单条草稿", () => {
  const original = mergeCandidates([], parsePostCandidates("https://x.com/Alice/status/1"), "默认").candidates;
  const edited = updateCandidate(original, "alice:1", { replyDraft: "单独写的回复", customReply: true, replyStatus: "replied" });
  const merged = mergeCandidates(edited, parsePostCandidates("互关 https://x.com/alice/status/2"), "新默认");
  assert.equal(merged.added, 0);
  assert.equal(merged.candidates[0].replyStatus, "replied");
  assert.equal(merged.candidates[0].replyDraft, "单独写的回复");
  assert.equal(merged.candidates[0].postId, "1");
});

test("候选状态统计准确", () => {
  const candidates = [
    { replyStatus: "pending" },
    { replyStatus: "replied" },
    { replyStatus: "skipped" }
  ];
  assert.deepEqual(summarizeCandidates(candidates), { total: 3, pending: 1, replied: 1, skipped: 1 });
});

test("同账号新帖子不覆盖已经单独编辑的待处理草稿", () => {
  const first = mergeCandidates([], parsePostCandidates("https://x.com/Alice/status/1"), "模板").candidates;
  const edited = updateCandidate(first, "alice:1", { replyDraft: "针对旧帖的回复", customReply: true });
  const merged = mergeCandidates(edited, parsePostCandidates("互关 https://x.com/alice/status/2"), "模板");
  assert.equal(merged.candidates[0].postId, "1");
  assert.equal(merged.candidates[0].replyDraft, "针对旧帖的回复");
});
