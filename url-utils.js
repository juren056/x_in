const POST_URL_PATTERN = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:[^\s，,]*)?/gi;
const NEGATIVE_INTENT_PATTERN = /不互关|不互粉|不回关|拒绝互关|禁止互关|互关骗局|互粉骗局/i;
const FOLLOW_BACK_PATTERN = /互关|互粉|回关|求关注.*回|关注.*必回|follow\s*back|f4f|互fo/i;

export function parsePostCandidates(value) {
  const lines = String(value || "").split(/\r?\n/);
  const byAccount = new Map();

  for (const line of lines) {
    const matches = [...line.matchAll(POST_URL_PATTERN)];
    if (!matches.length) continue;
    const postText = line.replace(POST_URL_PATTERN, "").trim().replace(/^[\s,，;；:：-]+|[\s,，;；:：-]+$/g, "");
    for (const match of matches) {
      const handle = match[1];
      const postId = match[2];
      const key = handle.toLowerCase();
      const candidate = {
        id: key + ":" + postId,
        handle,
        postId,
        postUrl: "https://x.com/" + handle + "/status/" + postId,
        profileUrl: "https://x.com/" + handle,
        postText,
        intent: postText && FOLLOW_BACK_PATTERN.test(postText) && !NEGATIVE_INTENT_PATTERN.test(postText) ? "matched" : "review"
      };
      const previous = byAccount.get(key);
      if (!previous || (previous.intent !== "matched" && candidate.intent === "matched")) {
        byAccount.set(key, candidate);
      }
    }
  }
  return [...byAccount.values()];
}

export function normalizeHandle(value) {
  return String(value || "").replace(/^@/, "").trim().toLowerCase();
}
