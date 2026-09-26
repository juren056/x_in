export function mergeCandidates(existing, imported, defaultReply) {
  const byAccount = new Map(existing.map((item) => [item.handle.toLowerCase(), item]));
  let added = 0;
  let updated = 0;

  for (const candidate of imported) {
    const key = candidate.handle.toLowerCase();
    const previous = byAccount.get(key);
    if (!previous) {
      byAccount.set(key, {
        ...candidate,
        followStatus: "unknown",
        replyStatus: "pending",
        replyDraft: defaultReply,
        customReply: false,
        addedAt: new Date().toISOString()
      });
      added += 1;
      continue;
    }
    if (previous.replyStatus === "replied" || previous.replyStatus === "skipped") continue;
    if (previous.intent === "review" && candidate.intent === "matched" && !previous.customReply) {
      byAccount.set(key, { ...previous, ...candidate });
      updated += 1;
    }
  }
  return { candidates: [...byAccount.values()], added, updated };
}

export function updateCandidate(candidates, id, changes) {
  return candidates.map((candidate) => candidate.id === id ? { ...candidate, ...changes } : candidate);
}

export function summarizeCandidates(candidates) {
  return {
    total: candidates.length,
    pending: candidates.filter((item) => item.replyStatus === "pending").length,
    replied: candidates.filter((item) => item.replyStatus === "replied").length,
    skipped: candidates.filter((item) => item.replyStatus === "skipped").length
  };
}
