import test from "node:test";
import assert from "node:assert/strict";
import { mergeAuditPosts, labelAuditPost, buildFeedbackExport, restoreAuditData, backfillAuditPosts, reclassifyAuditPosts, CLASSIFIER_VERSION } from "../audit-data.js";

const time1 = "2026-09-26T01:00:00.000Z";
const time2 = "2026-09-26T02:00:00.000Z";
const post = { postUrl: "https://x.com/a/status/123", handle: "a", text: "普通日常" };

test("rejected posts are retained with reason and first/last scan times", () => {
  const first = mergeAuditPosts([], [post], time1);
  const second = mergeAuditPosts(first, [{ ...post, text: "#互关 一起来" }], time2);
  assert.equal(first[0].matched, false);
  assert.equal(first[0].reason, "no-match");
  assert.equal(second.length, 1);
  assert.equal(second[0].matched, true);
  assert.equal(second[0].firstSeenAt, time1);
  assert.equal(second[0].lastSeenAt, time2);
});

test("manual correction survives rescan and export identifies false negatives", () => {
  const posts = mergeAuditPosts([], [post], time1);
  const labels = labelAuditPost([], post.postUrl, true, "This is a friend invitation", time2);
  const rescanned = mergeAuditPosts(posts, [post], time2);
  const data = buildFeedbackExport(rescanned, labels, time2);
  assert.equal(data.summary.falseNegatives, 1);
  assert.equal(data.samples[0].correction, "false-negative");
  assert.equal(data.samples[0].firstMarkedAt, time2);
  assert.equal(data.samples[0].postUrl, post.postUrl);
  assert.equal(data.samples[0].text, post.text);
});

test("existing local feedback is restored before the next save", () => {
  const file = buildFeedbackExport(mergeAuditPosts([], [post], time1),
    labelAuditPost([], post.postUrl, true, "reviewed", time2), time2);
  const restored = restoreAuditData([], [], file);
  assert.equal(restored.posts.length, 1);
  assert.equal(restored.labels[0].shouldMatch, true);
  assert.equal(restored.labels[0].markedAt, time2);
  const backfilled = backfillAuditPosts(restored.posts,
    [{ postUrl: "https://x.com/b/status/7", handle: "b", text: "ordinary", collectedAt: time1 }], time2);
  assert.equal(backfilled.length, 2);
  assert.equal(backfilled[1].firstSeenAt, time1);
});

test("clear cutoff blocks old browser and local posts while preserving correction detail", () => {
  const original = mergeAuditPosts([], [post], time1);
  const labels = labelAuditPost([], post.postUrl, true, "reviewed", time1, original[0]);
  const file = buildFeedbackExport(original, labels, time1);
  const restored = restoreAuditData([], [], file, time2);
  assert.equal(restored.posts.length, 0);
  assert.equal(restored.labels.length, 1);
  assert.equal(restored.labels[0].postSnapshot.text, post.text);
  assert.equal(buildFeedbackExport([], restored.labels, time2).samples[0].text, post.text);
  assert.equal(backfillAuditPosts([], [{ ...post, collectedAt: time1 }], time2, time2).length, 0);
  assert.equal(backfillAuditPosts([], [post], time2, time2).length, 0);
  assert.equal(backfillAuditPosts([], [{ ...post, collectedAt: "2026-09-26T03:00:00.000Z" }], time2, time2).length, 1);
});

test("old audit decisions are reclassified without losing dates or human labels", () => {
  const older = { postUrl: "https://x.com/blue/status/9", handle: "blue",
    text: "还在活跃的蓝V吗？不求互关刷量，就想认识几个朋友。#蓝V互关",
    matched: false, tags: ["蓝V互关"], reason: "no-match", classifierVersion: "0.5.11",
    firstSeenAt: time1, lastSeenAt: time2 };
  const labels = labelAuditPost([], older.postUrl, true, "人工确认", time2, older);
  const [updated] = reclassifyAuditPosts([older]);
  assert.equal(updated.matched, true);
  assert.equal(updated.reason, "tag");
  assert.equal(updated.classifierVersion, CLASSIFIER_VERSION);
  assert.equal(updated.firstSeenAt, time1);
  assert.equal(updated.lastSeenAt, time2);
  const exported = buildFeedbackExport([updated], labels, time2);
  assert.equal(exported.summary.falseNegatives, 0);
  assert.equal(exported.samples[0].correction, "agrees");
  assert.equal(exported.samples[0].shouldMatch, true);
});

test("export rechecks historical snapshots so fixed labels stop appearing as false negatives", () => {
  const older = { postUrl: "https://x.com/blue/status/11", handle: "blue",
    text: "不求互关刷量，只想认识真诚的蓝朋友。#蓝V互关",
    matched: false, classifierVersion: "0.5.11" };
  const newer = { postUrl: "https://x.com/friend/status/12", handle: "friend",
    text: "来点新朋友吧", matched: false, classifierVersion: "0.5.18" };
  const stillMissed = { postUrl: "https://x.com/other/status/13", handle: "other",
    text: "普通日常", matched: false, classifierVersion: "0.5.18" };
  const labels = [older, newer, stillMissed].map((sample) =>
    labelAuditPost([], sample.postUrl, true, "", time2, sample)[0]);
  const exported = buildFeedbackExport([], labels, time2);
  assert.equal(exported.summary.falseNegatives, 1);
  assert.deepEqual(exported.samples.map((sample) => sample.correction),
    ["agrees", "agrees", "false-negative"]);
  assert.ok(exported.samples.every((sample) => sample.classifierVersion === CLASSIFIER_VERSION));
  assert.equal(older.matched, false);
  assert.equal(newer.matched, false);
});
