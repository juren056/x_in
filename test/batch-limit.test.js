import test from "node:test";
import assert from "node:assert/strict";

function statusesAfterBatch(statuses, limit = 10) {
  let attempted = 0;
  return statuses.map((status) => {
    if (status !== "not-following") return status;
    if (attempted >= limit) return "queued";
    attempted += 1;
    return "followed";
  });
}

test("一键关注最多处理十个未关注账号", () => {
  const statuses = Array.from({ length: 12 }, () => "not-following");
  const result = statusesAfterBatch(statuses);
  assert.equal(result.filter((status) => status === "followed").length, 10);
  assert.equal(result.filter((status) => status === "queued").length, 2);
});

test("已经关注的账号不占用本批次名额", () => {
  const statuses = ["following", ...Array.from({ length: 10 }, () => "not-following"), "not-following"];
  const result = statusesAfterBatch(statuses);
  assert.equal(result.filter((status) => status === "followed").length, 10);
  assert.equal(result.at(-1), "queued");
  assert.equal(result[0], "following");
});
