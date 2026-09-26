chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "inspect-profile") return;
  inspectProfile().then((status) => sendResponse({ ok: true, status })).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "无法检查关注状态" });
  });
  return true;
});

async function inspectProfile() {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const control = findFollowControl();
    if (control) return getFollowState(control);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return "unavailable";
}

function findFollowControl() {
  const scope = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector("main") || document;
  const selectors = [
    'button[data-testid="followButton"]',
    'button[data-testid="unfollowButton"]',
    'button[data-testid="removeFollowerButton"]'
  ];
  for (const selector of selectors) {
    const button = scope.querySelector(selector);
    if (button && isVisible(button)) return button;
  }
  return [...scope.querySelectorAll('button, [role="button"]')].find((button) => {
    if (!isVisible(button)) return false;
    const text = ((button.getAttribute("aria-label") || "") + " " + (button.textContent || "")).trim();
    return /^(follow|following|unfollow|关注|正在关注|取消关注)$/i.test(text);
  }) || null;
}

function isVisible(element) {
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().width > 0;
}

function getFollowState(element) {
  const testId = element.getAttribute("data-testid") || "";
  const label = ((element.getAttribute("aria-label") || "") + " " + (element.textContent || "")).trim();
  if (/unfollow|removeFollower/i.test(testId) || /following|unfollow|正在关注|取消关注/i.test(label)) return "following";
  if (/followButton/i.test(testId) || /^(follow|关注)$/i.test(label)) return "not-following";
  return "unavailable";
}
