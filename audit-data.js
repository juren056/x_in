import { classifyFriendPost } from "./reply-rules.js";
export const AUDIT_SCHEMA_VERSION = 1;
export const CLASSIFIER_VERSION = "0.5.19";
export function auditPost(post, previous, seenAt) {
  const result = classifyFriendPost(post?.text);
  const value = String(post?.text || "");
  const reason = !value.trim() ? "unreadable" : result.matched ? result.reason : "no-match";
  return { postUrl: String(post.postUrl), handle: String(post.handle || ""), text: value,
    matched: result.matched, tags: result.tags, reason,
    firstSeenAt: previous?.firstSeenAt || previous?.collectedAt || seenAt,
    lastSeenAt: seenAt, classifierVersion: CLASSIFIER_VERSION };
}
export function reclassifyAuditPosts(posts) {
  return (posts || []).map((post) => {
    if (post?.classifierVersion === CLASSIFIER_VERSION) return post;
    const result = classifyFriendPost(post?.text);
    const reason = !String(post?.text || "").trim() ? "unreadable" : result.matched ? result.reason : "no-match";
    return { ...post, matched: result.matched, tags: result.tags, reason,
      classifierVersion: CLASSIFIER_VERSION };
  });
}

export function mergeAuditPosts(previous, posts, seenAt) {
  const map = new Map((previous || []).filter((post) => post?.postUrl).map((post) => [post.postUrl.toLowerCase(), post]));
  for (const post of posts || []) {
    if (!post?.postUrl) continue;
    const key = post.postUrl.toLowerCase();
    map.set(key, auditPost(post, map.get(key), seenAt));
  }
  return [...map.values()];
}
export function labelAuditPost(labels, postUrl, shouldMatch, note, markedAt, postSnapshot = null) {
  const key = String(postUrl || "").toLowerCase();
  const current = (labels || []).find((item) => item.postUrl.toLowerCase() === key);
  const next = { postUrl, shouldMatch: Boolean(shouldMatch), note: String(note || ""),
    firstMarkedAt: current?.firstMarkedAt || markedAt, markedAt,
    postSnapshot: postSnapshot || current?.postSnapshot || null };
  return [...(labels || []).filter((item) => item.postUrl.toLowerCase() !== key), next];
}
export function buildFeedbackExport(posts, labels, exportedAt) {
  const currentPosts = reclassifyAuditPosts(posts);
  const byUrl = new Map(currentPosts.map((post) => [post.postUrl.toLowerCase(), post]));
  const samples = (labels || []).map((label) => {
    const source = byUrl.get(label.postUrl.toLowerCase()) || label.postSnapshot;
    // A cleared post may only survive in a label snapshot. Re-evaluate that
    // snapshot too, so exports do not report already-fixed old decisions again.
    const post = source ? reclassifyAuditPosts([source])[0] : null;
    const { postSnapshot, ...annotation } = label;
    return { ...post, ...annotation, predictedMatch: post?.matched ?? null,
      correction: post ? (post.matched === label.shouldMatch ? "agrees" : label.shouldMatch ? "false-negative" : "false-positive") : "post-missing" };
  });
  return { schemaVersion: AUDIT_SCHEMA_VERSION, classifierVersion: CLASSIFIER_VERSION, exportedAt,
    summary: { posts: currentPosts.length, rejected: currentPosts.filter((post) => !post.matched).length,
      labels: samples.length, falseNegatives: samples.filter((s) => s.correction === "false-negative").length,
      falsePositives: samples.filter((s) => s.correction === "false-positive").length },
    samples };
}

export function restoreAuditData(posts, labels, fileData, clearedAt = null) {
  const postMap = new Map((posts || []).filter((post) => post?.postUrl).map((post) => [post.postUrl.toLowerCase(), post]));
  const labelMap = new Map((labels || []).filter((label) => label?.postUrl).map((label) => [label.postUrl.toLowerCase(), label]));
  for (const sample of Array.isArray(fileData?.samples) ? fileData.samples : []) {
    if (!/^https:\/\/(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(sample?.postUrl || "")) continue;
    const key = sample.postUrl.toLowerCase();
    const snapshot = typeof sample.text === "string" ? {
      postUrl: sample.postUrl, handle: sample.handle || "", text: sample.text,
      matched: sample.predictedMatch === true, tags: sample.tags || [], reason: sample.reason || "restored",
      firstSeenAt: sample.firstSeenAt || sample.firstMarkedAt, lastSeenAt: sample.lastSeenAt || sample.markedAt,
      classifierVersion: sample.classifierVersion || fileData.classifierVersion
    } : null;
    if (!postMap.has(key) && snapshot &&
        (!clearedAt || Date.parse(snapshot.lastSeenAt) > Date.parse(clearedAt))) {
      postMap.set(key, snapshot);
    }
    if (typeof sample.shouldMatch !== "boolean") continue;
    const existing = labelMap.get(key);
    if (!existing || String(sample.markedAt || "") > String(existing.markedAt || "")) {
      labelMap.set(key, { postUrl: sample.postUrl, shouldMatch: sample.shouldMatch,
        note: String(sample.note || ""), firstMarkedAt: sample.firstMarkedAt || sample.markedAt,
        markedAt: sample.markedAt, postSnapshot: snapshot || existing?.postSnapshot || null });
    }
  }
  return { posts: [...postMap.values()], labels: [...labelMap.values()] };
}

export function backfillAuditPosts(auditPosts, timelinePosts, fallbackTime, clearedAt = null) {
  const map = new Map((auditPosts || []).filter((post) => post?.postUrl).map((post) => [post.postUrl.toLowerCase(), post]));
  for (const post of timelinePosts || []) {
    if (!post?.postUrl || map.has(post.postUrl.toLowerCase())) continue;
    const seenAt = post.collectedAt || fallbackTime;
    if (clearedAt && (!post.collectedAt || !(Date.parse(seenAt) > Date.parse(clearedAt)))) continue;
    map.set(post.postUrl.toLowerCase(), auditPost(post, null, seenAt));
  }
  return [...map.values()];
}
