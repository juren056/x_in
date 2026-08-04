chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "inspect-profile") return;
  inspectProfile(Boolean(message.follow)).then((data) => {
    sendResponse({ ok: true, data });
  }).catch((error) => {
    sendResponse({ ok: false, message: error instanceof Error ? error.message : "检测失败" });
  });
  return true;
});

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
