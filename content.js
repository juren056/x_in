chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "discover-own-handle") {
    discoverOwnHandle().then((handle) => {
      sendResponse({ ok: true, handle });
    }).catch((error) => {
      sendResponse({ ok: false, message: error instanceof Error ? error.message : "无法识别当前账号" });
    });
    return true;
  }
  if (message?.type === "collect-following") {
    collectFollowing().then((handles) => {
      sendResponse({ ok: true, handles });
    }).catch((error) => {
      sendResponse({ ok: false, message: error instanceof Error ? error.message : "无法读取关注列表" });
    });
    return true;
  }
  if (message?.type === "collect-for-you") {
    collectForYou(message.scrollLimit).then((data) => sendResponse({ ok: true, ...data })).catch((error) => {
      sendResponse({ ok: false, message: error instanceof Error ? error.message : "无法读取为你推荐" });
    });
    return true;
  }
  if (message?.type === "submit-reply") {
    submitReply(message).then((data) => sendResponse({ ok: true, data })).catch((error) => {
      sendResponse({ ok: false, message: error instanceof Error ? error.message : "评论操作失败" });
    });
    return true;
  }
  if (message?.type !== "inspect-profile") return;
  inspectProfile(Boolean(message.follow)).then((data) => {
    sendResponse({ ok: true, data });
  }).catch((error) => {
    sendResponse({ ok: false, message: error instanceof Error ? error.message : "检测失败" });
  });
  return true;
});

async function collectFollowing() {
  if (!/\/following\/?$/i.test(location.pathname)) {
    throw new Error("未打开我的关注列表");
  }
  await waitForPageReady();
  const handles = new Set();
  for (let attempt = 0; attempt < 12 && !handles.size; attempt += 1) {
    collectVisibleProfileLinks(handles);
    if (!handles.size) await delay(400);
  }
  let stagnantRounds = 0;
  let previousSize = handles.size;
  for (let round = 0; round < 40; round += 1) {
    collectVisibleProfileLinks(handles);
    stagnantRounds = handles.size === previousSize ? stagnantRounds + 1 : 0;
    previousSize = handles.size;
    if (stagnantRounds >= 4) break;
    window.scrollBy({ top: Math.max(window.innerHeight * 0.85, 560), behavior: "auto" });
    await delay(650);
  }
  if (!handles.size) throw new Error("未找到关注列表，请确认已登录 X");
  return [...handles];
}

async function discoverOwnHandle() {
  await waitForPageReady();
  const selectors = [
    'a[data-testid="AppTabBar_Profile_Link"]',
    'a[aria-label="Profile"]',
    'a[aria-label="个人资料"]'
  ];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const selector of selectors) {
      const link = document.querySelector(selector);
      const handle = profileHandleFromHref(link?.href);
      if (handle) return handle;
    }
    await delay(600);
  }
  throw new Error("无法识别当前登录账号，请确认已登录 X");
}

function profileHandleFromHref(href) {
  if (!href) return null;
  try {
    const [handle] = new URL(href).pathname.split("/").filter(Boolean);
    return /^[A-Za-z0-9_]{1,15}$/.test(handle || "") ? handle : null;
  } catch {
    return null;
  }
}

function collectVisibleProfileLinks(handles) {
  const reserved = new Set(["home", "explore", "notifications", "messages", "i", "settings", "search", "compose"]);
  for (const anchor of document.querySelectorAll('main a[href^="/"]')) {
    try {
      const path = new URL(anchor.href).pathname.split("/").filter(Boolean);
      if (path.length !== 1) continue;
      const handle = path[0].replace(/^@/, "");
      if (/^[A-Za-z0-9_]{1,15}$/.test(handle) && !reserved.has(handle.toLowerCase())) {
        handles.add(handle.toLowerCase());
      }
    } catch {}
  }
}

function waitForPageReady() {
  return new Promise((resolve) => {
    if (document.readyState === "complete") {
      setTimeout(resolve, 800);
      return;
    }
    window.addEventListener("load", () => setTimeout(resolve, 800), { once: true });
  });
}

function delay(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function inspectProfile(shouldFollow) {
  await waitForProfileControls();
  const handle = getHandle();
  const control = findFollowControl();
  if (!control) {
    return {
      handle,
      status: "unavailable",
      message: "未找到关注按钮，可能需要登录或页面受限"
    };
  }

  const initial = getFollowState(control);
  if (initial === "following") return { handle, status: "following", message: "已在关注" };
  if (initial !== "not-following") return { handle, status: "unavailable", message: "无法确认关注状态" };
  if (!shouldFollow) return { handle, status: "not-following", message: "尚未关注" };

  control.click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  const updated = findFollowControl();
  if (updated && getFollowState(updated) === "following") {
    return { handle, status: "followed", message: "本次已关注" };
  }
  return { handle, status: "failed", message: "点击后未确认成功" };
}

function waitForProfileControls() {
  return new Promise((resolve) => {
    if (findFollowControl()) {
      setTimeout(resolve, 700);
      return;
    }
    const observer = new MutationObserver(() => {
      if (findFollowControl()) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 7000);
  });
}

function findFollowControl() {
  const exactSelectors = [
    'button[data-testid="followButton"]',
    'button[data-testid="unfollowButton"]',
    'button[data-testid="removeFollowerButton"]'
  ];
  for (const selector of exactSelectors) {
    const element = document.querySelector(selector);
    if (element && isVisible(element)) return element;
  }
  const scope = document.querySelector("main") || document;
  const candidates = [...scope.querySelectorAll('button, [role="button"]')];
  return candidates.find((element) => {
    if (!isVisible(element)) return false;
    const testId = element.getAttribute("data-testid") || "";
    const aria = element.getAttribute("aria-label") || "";
    const text = element.textContent || "";
    return /follow/i.test(testId) || /^(follow|following|unfollow|关注|正在关注|取消关注)/i.test(`${aria} ${text}`.trim());
  }) || null;
}

function isVisible(element) {
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().width > 0;
}

function getFollowState(element) {
  const testId = element.getAttribute("data-testid") || "";
  const aria = element.getAttribute("aria-label") || "";
  const text = element.textContent || "";
  const label = `${testId} ${aria} ${text}`.trim();
  if (/(unfollow|removeFollower|following)/i.test(testId)) return "following";
  if (/follow/i.test(testId)) return "not-following";
  if (/(following|unfollow|正在关注|取消关注)/i.test(label)) return "following";
  if (/(^|[-_ ])follow(\b|[-_ ])|^关注$|关注$/i.test(label)) return "not-following";
  return "unknown";
}

function getHandle() {
  const [handle] = location.pathname.split("/").filter(Boolean);
  return handle ? `@${handle.replace(/^@/, "")}` : "未知账号";
}

async function collectForYou(requestedScrollLimit = 30) {
  const scrollLimit = Number(requestedScrollLimit);
  if (!Number.isInteger(scrollLimit) || scrollLimit < 1 || scrollLimit > 200) {
    throw new Error("滚动次数须为 1–200 的整数");
  }
  if (location.pathname !== "/home") throw new Error("未打开 X 首页");
  await waitForPageReady();
  let forYouTab = null;
  for (let attempt = 0; attempt < 15 && !forYouTab; attempt += 1) {
    forYouTab = [...document.querySelectorAll('[role="tab"]')].find((tab) =>
      /^(为你推荐|For you)$/i.test((tab.textContent || "").trim()));
    if (!forYouTab) await delay(400);
  }
  if (!forYouTab) throw new Error("找不到首页“为你推荐”标签，请确认已登录 X");
  if (forYouTab.getAttribute("aria-selected") !== "true") {
    forYouTab.click();
    await delay(1200);
  }

  const handles = new Set();
  const seenPosts = new Set();
  const postsByUrl = new Map();
  const visibilityState = document.visibilityState || "unknown";
  await waitForTimelinePosts(handles, seenPosts, postsByUrl, 20000);
  const scanDeadline = Date.now() + 240000;
  let rounds = 0;
  let stalledRounds = 0;
  let postlessRounds = 0;
  let scrollDistance = 0;
  let stopReason = "limit";
  for (let round = 0; round < scrollLimit; round += 1) {
    if (Date.now() >= scanDeadline) {
      stopReason = "time";
      break;
    }
    collectVisibleTimelineAuthors(handles, seenPosts, postsByUrl);
    const scroller = findTimelineScroller();
    const beforePosts = seenPosts.size;
    const beforePosition = timelineScrollPosition(scroller);
    const beforeHeight = timelineScrollHeight(scroller);
    const step = Math.max(window.innerHeight * 0.75, 480);
    if (scroller && scroller !== document.scrollingElement && typeof scroller.scrollBy === "function") {
      scroller.scrollBy({ top: step, behavior: "auto" });
    } else {
      window.scrollBy({ top: step, behavior: "auto" });
    }
    rounds = round + 1;
    const newPosts = await waitForTimelinePosts(handles, seenPosts, postsByUrl, 4000, beforePosts);
    let afterPosition = timelineScrollPosition(scroller);
    let afterHeight = timelineScrollHeight(scroller);
    if (!newPosts && afterPosition <= beforePosition + 2 && afterHeight <= beforeHeight + 2) {
      await waitForTimelinePosts(handles, seenPosts, postsByUrl, 6000, beforePosts);
      afterPosition = timelineScrollPosition(scroller);
      afterHeight = timelineScrollHeight(scroller);
    }
    scrollDistance += Math.max(0, afterPosition - beforePosition);
    postlessRounds = seenPosts.size > beforePosts ? 0 : postlessRounds + 1;
    const progressed = seenPosts.size > beforePosts || afterPosition > beforePosition + 2 || afterHeight > beforeHeight + 2;
    stalledRounds = progressed ? 0 : stalledRounds + 1;
    if (stalledRounds >= 3) {
      stopReason = "stalled";
      break;
    }
  }
  if (stopReason === "limit" && (seenPosts.size === 0 || postlessRounds >= 6)) stopReason = "no-new-posts";
  return {
    handles: [...handles], scannedPosts: seenPosts.size, rounds, posts: [...postsByUrl.values()],
    stopReason, visibilityState, scrollDistance: Math.round(scrollDistance)
  };
}

function timelineScope() {
  return document.querySelector('[data-testid="primaryColumn"]') || document.querySelector("main") || document;
}

function findTimelineScroller() {
  let node = timelineScope().querySelector('article[data-testid="tweet"]')?.parentElement;
  while (node && node !== document.body) {
    if (node.scrollHeight > node.clientHeight + 80 && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
    node = node.parentElement;
  }
  return document.scrollingElement || null;
}

function timelineScrollPosition(scroller) {
  if (scroller && scroller !== document.scrollingElement) return scroller.scrollTop || 0;
  return window.scrollY || document.scrollingElement?.scrollTop || 0;
}

function timelineScrollHeight(scroller) {
  return scroller?.scrollHeight || document.scrollingElement?.scrollHeight || 0;
}

async function waitForTimelinePosts(handles, seenPosts, postsByUrl, timeoutMs, previousCount = 0) {
  const deadline = Date.now() + timeoutMs;
  do {
    collectVisibleTimelineAuthors(handles, seenPosts, postsByUrl);
    if (seenPosts.size > previousCount) return true;
    await delay(300);
  } while (Date.now() < deadline);
  return false;
}

function collectVisibleTimelineAuthors(handles, seenPosts, postsByUrl) {
  const scope = timelineScope();
  for (const article of scope.querySelectorAll('article[data-testid="tweet"]')) {
    const userName = article.querySelector('[data-testid="User-Name"]');
    let handle = null;
    for (const link of userName?.querySelectorAll('a[href]') || []) {
      handle = timelineHandleFromHref(link.href);
      if (handle) break;
    }
    if (!handle) {
      for (const link of article.querySelectorAll('a[href*="/status/"]')) {
        handle = timelineHandleFromHref(link.href);
        if (handle) break;
      }
    }
    if (!handle) continue;
    handles.add(handle.toLowerCase());
    const statusLinks = [...article.querySelectorAll('a[href*="/status/"]')];
    const fallback = article.querySelector('a[href*="/status/"]');
    if (fallback && !statusLinks.includes(fallback)) statusLinks.unshift(fallback);
    const statusLink = statusLinks.find((link) =>
      timelineHandleFromHref(link.href)?.toLowerCase() === handle.toLowerCase());
    if (statusLink) {
      const postUrl = new URL(statusLink.href, location.origin).origin +
        new URL(statusLink.href, location.origin).pathname;
      seenPosts.add(postUrl);
      postsByUrl?.set(postUrl, {
        handle: handle.toLowerCase(),
        postUrl,
        text: article.querySelector('[data-testid="tweetText"]')?.textContent || ""
      });
    }
  }
}

function timelineHandleFromHref(href) {
  try {
    const url = new URL(href, location.origin);
    if (!["x.com", "twitter.com"].includes(url.hostname.toLowerCase().replace(/^www\./, ""))) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (!/^[A-Za-z0-9_]{1,15}$/.test(parts[0] || "")) return null;
    if (["home", "explore", "notifications", "messages", "i", "search"].includes(parts[0].toLowerCase())) return null;
    if (parts.length === 1 || (parts[1] === "status" && /^\d+$/.test(parts[2] || ""))) return parts[0];
  } catch {}
  return null;
}

async function submitReply({ postUrl, text, ownHandle }) {
  let clickedSend = false;
  try {
    const target = new URL(postUrl);
    if (!["x.com", "twitter.com"].includes(target.hostname.toLowerCase()) ||
        !/^\/[A-Za-z0-9_]{1,15}\/status\/\d+\/?$/.test(target.pathname) ||
        location.pathname.replace(/\/$/, "") !== target.pathname.replace(/\/$/, "")) {
      return { status: "failed", message: "当前页面不是指定原帖" };
    }
    if (!/^[A-Za-z0-9_]{1,15}$/.test(ownHandle || "") ||
        !text?.trim() || [...text].length > 280) {
      return { status: "failed", message: "评论内容或登录账号无效" };
    }
    const article = await waitForReplyElement(() => findOriginalArticle(target.pathname), 7000);
    if (!article) return { status: "failed", message: "找不到指定原帖" };
    const existingOwnReplyIds = ownReplyIds(ownHandle);

    const replyButton = article.querySelector('[data-testid="reply"]');
    if (!replyButton) return { status: "failed", message: "找不到原帖回复按钮" };
    replyButton.click();
    const composer = await waitForReplyElement(findReplyComposer, 6000);
    if (!composer) return { status: "failed", message: "回复编辑框未出现" };
    if (!await writeReplyText(composer, text)) {
      return { status: "failed", message: "未能把评论写入编辑框；未点击发送" };
    }
    const findSendButton = () => {
      const dialog = (findReplyComposer() || composer).closest('[role="dialog"]');
      const scope = dialog || document;
      const selectors = dialog
        ? ['[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]']
        : ['[data-testid="tweetButtonInline"]', '[data-testid="tweetButton"]'];
      return selectors.map((selector) => scope.querySelector(selector)).find((button) =>
        button && !button.disabled && button.getAttribute("aria-disabled") !== "true") || null;
    };
    if (!await waitForReplyElement(findSendButton, 4000)) {
      return { status: "failed", message: "发送按钮不可用" };
    }
    await delay(250);
    const currentComposer = findReplyComposer() || composer;
    if (repeatedReplyText(visibleReplyText(currentComposer), text) && !await repairRepeatedReplyText(currentComposer, text)) {
      return { status: "failed", message: "编辑框重复回复且无法恢复单份，未点击发送" };
    }
    const sendButton = findSendButton();
    if (!sendButton) return { status: "failed", message: "发送按钮不可用" };
    sendButton.click();
    clickedSend = true;
    const confirmed = await waitForReplyElement(() =>
      [...ownReplyIds(ownHandle)].some((id) => !existingOwnReplyIds.has(id)), 15000);
    return confirmed
      ? { status: "sent", message: "已在页面确认回复" }
      : { status: "uncertain", message: "已调用回复按钮，但 15 秒内未看到已发布的评论；标签页已保留，请检查原帖" };
  } catch (error) {
    return {
      status: clickedSend ? "uncertain" : "failed",
      message: error instanceof Error ? error.message : "评论操作失败"
    };
  }
}

function findReplyComposer() {
  const dialog = document.querySelector('[role="dialog"]');
  const scope = dialog || document;
  const container = scope.querySelector('[data-testid="tweetTextarea_0"]');
  if (!container) return null;
  if (container.getAttribute?.("contenteditable") === "true") return container;
  return container.querySelector?.('[contenteditable="true"]') || null;
}

function visibleReplyText(composer) {
  return String(composer.innerText ?? composer.textContent ?? "");
}

function normalizedReplyText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function repeatedReplyText(value, expected) {
  const actual = normalizedReplyText(value);
  const target = normalizedReplyText(expected);
  if (!target || !actual) return false;
  let remainder = actual;
  let copies = 0;
  while (remainder.startsWith(target)) {
    remainder = remainder.slice(target.length).trimStart();
    copies += 1;
  }
  return copies >= 2 && !remainder;
}

function selectReplyContents(composer) {
  composer.focus();
  const selection = window.getSelection?.();
  if (!selection || !document.createRange) return false;
  const range = document.createRange();
  range.selectNodeContents(composer);
  selection.removeAllRanges();
  selection.addRange(range);
  return document.activeElement === composer || !document.hasFocus?.();
}

async function repairRepeatedReplyText(composer, text) {
  // Replace the whole editor through its native editing command. Direct DOM writes
  // leave X's editor state out of sync and can reintroduce the duplicate on render.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentComposer = findReplyComposer() || composer;
    if (!selectReplyContents(currentComposer) || !document.execCommand?.("insertText", false, text)) return false;
    await delay(500);
    if (normalizedReplyText(visibleReplyText(findReplyComposer() || currentComposer)) !== normalizedReplyText(text)) continue;
    await delay(300);
    if (normalizedReplyText(visibleReplyText(findReplyComposer() || currentComposer)) === normalizedReplyText(text)) return true;
  }
  return false;
}

async function writeReplyText(composer, text) {
  composer.focus();
  const initial = visibleReplyText(composer);
  if (repeatedReplyText(initial, text)) {
    if (!await repairRepeatedReplyText(composer, text)) throw new Error("编辑框重复回复且无法恢复单份，未点击发送");
    return true;
  }
  if (normalizedReplyText(initial) === normalizedReplyText(text)) return true;
  const hadDraft = Boolean(initial.trim());
  const selection = window.getSelection?.();
  if (selection && document.createRange) {
    const range = document.createRange();
    range.selectNodeContents(composer);
    if (!hadDraft) range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (document.activeElement !== composer && document.hasFocus?.()) return false;

  const inserted = document.execCommand?.("insertText", false, text);
  await delay(500);
  const afterInsert = visibleReplyText(composer);
  if (repeatedReplyText(afterInsert, text)) {
    if (!await repairRepeatedReplyText(composer, text)) throw new Error("编辑框重复回复且无法恢复单份，未点击发送");
    return true;
  }
  if (hadDraft) return Boolean(inserted && afterInsert.trim());
  if (afterInsert.trim()) return true;
  if (inserted) return false;

  // Let X's editor handle one input event. Do not also mutate the DOM.
  composer.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true, cancelable: true, inputType: "insertText", data: text
  }));
  await delay(500);
  const afterFallback = visibleReplyText(composer);
  if (repeatedReplyText(afterFallback, text)) {
    if (!await repairRepeatedReplyText(composer, text)) throw new Error("编辑框重复回复且无法恢复单份，未点击发送");
    return true;
  }
  return Boolean(afterFallback.trim());
}

function findOriginalArticle(pathname) {
  const expected = pathname.replace(/\/$/, "").toLowerCase();
  const expectedHandle = pathname.split("/").filter(Boolean)[0].toLowerCase();
  const primary = document.querySelector('[data-testid="primaryColumn"]');
  const articles = [...(primary?.querySelectorAll('article[data-testid="tweet"]') ||
    document.querySelectorAll('article[data-testid="tweet"]'))];
  const authorMatches = (article) => {
    const userName = article.querySelector('[data-testid="User-Name"]');
    const links = userName?.querySelectorAll('a[href]') || [];
    if ([...links].some((link) => {
      try { return new URL(link.href, location.origin).pathname.toLowerCase() === "/" + expectedHandle; }
      catch { return false; }
    })) return true;
    return (userName?.textContent || "").match(/@[A-Za-z0-9_]{1,15}/)?.[0].toLowerCase() === "@" + expectedHandle;
  };
  const ownStatusPaths = (article) => [...article.querySelectorAll('a[href*="/status/"]')]
    .map((link) => {
      try { return new URL(link.href, location.origin).pathname.replace(/\/$/, "").toLowerCase(); }
      catch { return ""; }
    })
    .filter((path) => path.startsWith("/" + expectedHandle + "/status/"));
  const exact = articles.find((article) => authorMatches(article) && ownStatusPaths(article).includes(expected));
  if (exact) return exact;
  // X can omit or rewrite an edited post's internal permalink. The browser URL
  // was checked against the requested post; the first primary tweet is that page's
  // post, provided its author also matches. Other tweets are never a fallback.
  const first = articles[0];
  return first && authorMatches(first) && first.querySelector('[data-testid="reply"]') ? first : null;
}

function ownReplyIds(handle) {
  const expectedHandle = handle.toLowerCase();
  const ids = new Set();
  for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
    const authorLinks = article.querySelector('[data-testid="User-Name"]')?.querySelectorAll('a[href]') || [];
    const ownArticle = [...authorLinks].some((link) => {
      try {
        return new URL(link.href, location.origin).pathname.toLowerCase() === "/" + expectedHandle;
      } catch { return false; }
    });
    if (!ownArticle) continue;
    for (const link of article.querySelectorAll('a[href*="/status/"]')) {
      try {
        const url = new URL(link.href, location.origin);
        if (url.pathname.toLowerCase().startsWith("/" + expectedHandle + "/status/")) ids.add(url.pathname);
      } catch {}
    }
  }
  return ids;
}

async function waitForReplyElement(read, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await delay(300);
  }
  return null;
}
