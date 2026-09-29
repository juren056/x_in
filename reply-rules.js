import { validPostUrl } from "./reply-batch.js";

export const REPLY_TAGS = [
  "互关", "互评", "互粉", "交个朋友", "浇个朋友",
  "浇朋友", "交朋友", "蓝V互关", "蓝V互关互粉", "蓝V互浇",
  "有美必回", "蓝朋友", "浇蓝朋友", "浇友"
];

// A direct refusal differs from rejecting follow-for-numbers ("不求互关刷量")
// or criticizing follow-then-unfollow behavior; both can still invite genuine peers.
const DIRECT_REJECTION = /(?:不|别|拒绝|谢绝|禁止|请勿)(?:要|想)?(?:互关|互粉|互评|交朋友|浇(?:个)?(?:蓝)?朋友|扩列|互动)/u;
const REFUSES_METRIC_CHASING = /(?:不求|不想|不要).{0,3}(?:互关|互粉).{0,4}(?:刷量|数字|数据)/u;
const FRIEND_INVITATIONS = [
  /(?:来|欢迎|想|一起|找|等).{0,12}(?:交朋友|扩列|蓝朋友|互关|互粉|互评|认识新朋友|互动)/u,
  /(?:交朋友|扩列|蓝朋友|互关|互粉|互评).{0,12}(?:来|欢迎|一起|求|认识|关注|评论|私信)/u,
  /(?:关注|互关).{0,4}(?:必回|互回)/u,
  /浇(?:个)?(?:蓝)?朋友/u,
  /点赞.{0,8}评论.{0,8}交朋友/u,
  /蓝朋友.{0,65}认识更多新朋友/u,
  /(?:来点|求认识|想认识).{0,5}新朋友吧?/u,
  /(?:爱|愿意).{0,6}互动的朋友.{0,30}把我算上/u,
  /(?:粉丝|关注).{0,25}加我.{0,35}留言.{0,45}有来必有往/u
];

// The feedback corpus also treats posts about joining and engaging with the X
// community as relevant, even when they do not contain a literal invitation.
const COMMUNITY_ENGAGEMENT = [
  /关注.{0,16}(?:限制|上限).{0,24}(?:一天|几个|多少)/u,
  /蓝朋友们/u,
  /新人报[到道].{0,80}(?:粉丝|玩X|学习成长|新朋友)/iu,
  /(?:破|冲)\s*\d{3,}.{0,20}(?:兄弟|朋友)/u,
  /(?:推|转发|点赞|评论).{0,8}我的帖子/u,
  /X友.{0,12}(?:早上好|大家好|打招呼)/iu,
  /蓝朋友.{0,60}(?:粉丝|关注量|兄弟们|谢谢)/u,
  /(?:X|时间线).{0,25}(?:推送|推荐).{0,12}新朋友/iu,
  /[#＃]大家好\s+[#＃]新人|[#＃]新人\s+[#＃]大家好/u,
  /互关.{0,20}取关/u,
  /新人第.{1,4}天.{0,30}目标\s*\d+/u,
  /(?:跟|和).{0,30}(?:小蓝V|蓝V朋友).{0,15}认真互动/iu,
  /继续交友.{0,6}互动/u
];

export function matchReplyTags(text) {
  const hashtags = new Set(
    [...String(text || "").matchAll(/[#＃]([\p{L}\p{N}_]+)/gu)]
      .map((match) => match[1].toLowerCase())
  );
  return REPLY_TAGS.filter((tag) => hashtags.has(tag.toLowerCase()));
}

export function classifyFriendPost(text) {
  const content = String(text || "").replace(/\s+/gu, " ").trim();
  const tags = matchReplyTags(content);
  if (!content || (DIRECT_REJECTION.test(content) && !REFUSES_METRIC_CHASING.test(content))) {
    return { matched: false, tags, reason: null };
  }
  if (tags.length) return { matched: true, tags, reason: "tag" };
  const invitationText = content.replace(new RegExp(REFUSES_METRIC_CHASING.source, "gu"), " ");
  const invitation = [...FRIEND_INVITATIONS, ...COMMUNITY_ENGAGEMENT]
    .some((pattern) => pattern.test(invitationText));
  return { matched: invitation, tags, reason: invitation ? "content" : null };
}

function normalizedHandle(handle) {
  return String(handle || "").replace(/^@/, "").toLowerCase();
}

export function findReplyPosts(posts, handle) {
  const normalized = normalizedHandle(handle);
  return (posts || []).filter((post) =>
    normalizedHandle(post?.handle) === normalized &&
    validPostUrl(post?.postUrl) &&
    classifyFriendPost(post?.text).matched
  );
}

export function findReplyPost(posts, handle) {
  return findReplyPosts(posts, handle)[0] || null;
}

export function postsSinceReplyClear(posts, clearedAt) {
  if (!clearedAt) return posts || [];
  const cutoff = Date.parse(clearedAt);
  if (!Number.isFinite(cutoff)) return posts || [];
  return (posts || []).filter((post) => {
    const collected = Date.parse(post?.collectedAt);
    return Number.isFinite(collected) && collected > cutoff;
  });
}
export function discoverReplyCandidates(candidates, posts, followedHandles = [], addedAt = new Date().toISOString()) {
  const followed = new Set((followedHandles || []).map(normalizedHandle));
  const merged = (candidates || []).map((item) =>
    item.status === "detected" && followed.has(normalizedHandle(item.handle))
      ? { ...item, status: "pending" } : item);
  const seen = new Set(merged.map((item) => String(item.postUrl || "").toLowerCase()));
  for (const post of posts || []) {
    const handle = normalizedHandle(post?.handle);
    const postUrl = String(post?.postUrl || "");
    const classification = classifyFriendPost(post?.text);
    if (!handle || !validPostUrl(postUrl) || !classification.matched || seen.has(postUrl.toLowerCase())) continue;
    seen.add(postUrl.toLowerCase());
    merged.push({
      handle, postUrl, text: post.text, tags: classification.tags,
      matchReason: classification.reason,
      status: followed.has(handle) ? "pending" : "detected",
      addedAt
    });
  }
  return merged;
}

export function appendReplyCandidates(candidates, posts, handles, addedAt = new Date().toISOString()) {
  const eligible = new Set((handles || []).map(normalizedHandle));
  const relevantPosts = (posts || []).filter((post) => eligible.has(normalizedHandle(post?.handle)));
  return discoverReplyCandidates(candidates, relevantPosts, handles, addedAt);
}
