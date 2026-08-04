import test from "node:test";
import assert from "node:assert/strict";

function parseUrls(value) {
  return [...new Set(value.split(/[\s,，]+/).map((item) => item.trim()).filter((item) => {
    try {
      const url = new URL(item);
      const [handle] = url.pathname.split("/").filter(Boolean);
      return /^https?:$/.test(url.protocol) && /^(www\.)?(x\.com|twitter\.com)$/i.test(url.hostname) && handle && !["home", "explore", "notifications", "messages", "i", "settings"].includes(handle.toLowerCase());
    } catch { return false; }
  }))];
}

test("只保留有效 X 主页并去重", () => {
  assert.deepEqual(parseUrls("https://x.com/alice\nhttps://twitter.com/bob, https://x.com/alice"), [
    "https://x.com/alice",
    "https://twitter.com/bob"
  ]);
});

test("过滤 X 导航页和无效地址", () => {
  assert.deepEqual(parseUrls("https://x.com/home\nhttps://example.com/user\nnot-a-url"), []);
});

test("支持中文逗号和空格分隔", () => {
  assert.deepEqual(parseUrls("https://x.com/a，https://x.com/b https://x.com/c"), [
    "https://x.com/a",
    "https://x.com/b",
    "https://x.com/c"
  ]);
});
