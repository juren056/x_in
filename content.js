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
    collectForYou().then((data) => sendResponse({ ok: true, ...data })).catch((error) => {
      sendResponse({ ok: false, message: error instanceof Error ? error.message : "无法读取为你推荐" });
    });
    return true;
  }  if (message?.type !== "inspect-profile") return;
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
    await delay(400);
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

async function collectForYou() {
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
  let stagnantRounds = 0;
  let rounds = 0;
  for (let round = 0; round < 40; round += 1) {
    collectVisibleTimelineAuthors(handles, seenPosts);
    rounds = round + 1;
    if (handles.size === 0 && round < 3) {
      await delay(600);
      continue;
    }
    const before = handles.size;
    window.scrollBy({ top: Math.max(window.innerHeight * 0.85, 560), behavior: "auto" });
    await delay(700);
    collectVisibleTimelineAuthors(handles, seenPosts);
    stagnantRounds = handles.size === before ? stagnantRounds + 1 : 0;
    if (stagnantRounds >= 5) break;
  }
  if (!handles.size) throw new Error("未找到为你推荐中的帖子账号");
  return { handles: [...handles], scannedPosts: seenPosts.size, rounds };
}

function collectVisibleTimelineAuthors(handles, seenPosts) {
  const scope = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector("main") || document;
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
    const statusLink = article.querySelector('a[href*="/status/"]');
    if (statusLink) seenPosts.add(statusLink.href);
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
