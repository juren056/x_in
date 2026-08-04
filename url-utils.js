const RESERVED_HANDLES = new Set(["home", "explore", "notifications", "messages", "i", "settings"]);
const X_HANDLE_PATTERN = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/?@?([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/gi;

export function parseXUrls(value) {
  const text = Array.isArray(value) ? value.join("\n") : String(value || "");
  const handles = [];
  for (const match of text.matchAll(X_HANDLE_PATTERN)) {
    const handle = match[1];
    if (!RESERVED_HANDLES.has(handle.toLowerCase())) handles.push(handle);
  }
  return [...new Set(handles.map((handle) => `https://x.com/${handle}`))];
}
