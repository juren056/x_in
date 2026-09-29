import test from "node:test";
import assert from "node:assert/strict";
import { resetReplyCandidate, selectPendingReplies, updateReplyCandidate, validPostUrl } from "../reply-batch.js";

test("评论批次只取十条有效且唯一的待回复原帖", () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    postUrl: "https://x.com/person/status/" + (index + 100),
    status: "pending"
  }));
  candidates.push({ ...candidates[0] });
  candidates.push({ postUrl: "https://x.com/person", status: "pending" });
  candidates.push({ postUrl: "https://x.com/person/status/500", status: "done" });
  const selected = selectPendingReplies(candidates);
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected.map((item) => item.postUrl)).size, 10);
  assert.equal(selected.at(-1).postUrl, "https://x.com/person/status/109");
  assert.equal(selectPendingReplies(candidates, null, Number.POSITIVE_INFINITY).length, 12);
});

test("仅处理确认时列出的待回复帖子", () => {
  const candidates = [
    { postUrl: "https://x.com/a/status/1", status: "pending" },
    { postUrl: "https://x.com/b/status/2", status: "pending" }
  ];
  assert.deepEqual(selectPendingReplies(candidates, ["https://x.com/b/status/2"]).map((item) => item.postUrl),
    ["https://x.com/b/status/2"]);
  assert.equal(validPostUrl("https://evil.example/a/status/1"), false);
  assert.equal(validPostUrl("https://x.com/a/status/1"), true);
});

test("更新单个回复状态，不影响其他候选项", () => {
  const candidates = [
    { postUrl: "https://x.com/a/status/1", status: "pending" },
    { postUrl: "https://x.com/b/status/2", status: "pending" }
  ];
  const changed = updateReplyCandidate(candidates, candidates[0].postUrl, { status: "done" });
  assert.equal(changed[0].status, "done");
  assert.equal(changed[1].status, "pending");
  assert.equal(candidates[0].status, "pending");
});
test("重置失败或待核查状态后重新进入待回复队列", () => {
  for (const status of ["failed", "uncertain"]) {
    const postUrl = "https://x.com/a/status/1";
    const original = {
      postUrl, status, error: "评论未写入", attemptedAt: "yesterday",
      completedAt: "yesterday", addedAt: "earlier"
    };
    const candidates = [original, { postUrl: "https://x.com/b/status/2", status: "done" }];
    const reset = resetReplyCandidate(candidates, postUrl);
    assert.equal(reset[0].status, "pending");
    assert.equal(reset[0].error, undefined);
    assert.equal(reset[0].attemptedAt, undefined);
    assert.equal(reset[0].completedAt, undefined);
    assert.equal(reset[0].addedAt, "earlier");
    assert.equal(reset[1], candidates[1]);
    assert.equal(selectPendingReplies(reset).length, 1);
    assert.equal(original.status, status);
  }
});

test("已回复和正在发布的记录不能被重置", () => {
  const postUrl = "https://x.com/a/status/1";
  for (const status of ["done", "posting", "pending"]) {
    const original = { postUrl, status };
    assert.equal(resetReplyCandidate([original], postUrl)[0], original);
  }
});

test("待关注帖子也进入评论批次，关注阶段失败后重置仍需关注", () => {
  const postUrl = "https://x.com/a/status/3";
  const selected = selectPendingReplies([{ postUrl, status: "detected" }]);
  assert.equal(selected.length, 1);
  const reset = resetReplyCandidate([{ postUrl, status: "failed", failedStage: "follow" }], postUrl);
  assert.equal(reset[0].status, "detected");
  assert.equal(reset[0].failedStage, undefined);
});
