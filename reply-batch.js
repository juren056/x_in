export const MAX_REPLIES_PER_BATCH = 10;

export function validPostUrl(value) {
  try {
    const url = new URL(value);
    return ["x.com", "twitter.com"].includes(url.hostname.toLowerCase()) &&
      /^\/[A-Za-z0-9_]{1,15}\/status\/\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function selectPendingReplies(candidates, requestedUrls = null, limit = MAX_REPLIES_PER_BATCH) {
  const requested = requestedUrls ? new Set(requestedUrls) : null;
  const seen = new Set();
  return (candidates || []).filter((item) => {
    if (!["pending", "detected"].includes(item.status) || !validPostUrl(item.postUrl)) return false;
    if (requested && !requested.has(item.postUrl)) return false;
    if (seen.has(item.postUrl)) return false;
    seen.add(item.postUrl);
    return true;
  }).slice(0, limit);
}

export function updateReplyCandidate(candidates, postUrl, changes) {
  return candidates.map((item) => item.postUrl === postUrl ? { ...item, ...changes } : item);
}
export function resetReplyCandidate(candidates, postUrl) {
  return candidates.map((item) => {
    if (item.postUrl !== postUrl || !["failed", "uncertain"].includes(item.status)) return item;
    const { error, attemptedAt, completedAt, failedStage, ...rest } = item;
    return { ...rest, status: failedStage === "follow" ? "detected" : "pending" };
  });
}
