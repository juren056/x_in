import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");

function makeContext(options = {}) {
  let stage = 0;
  let clicked = false;
  const tab = {
    textContent: "为你推荐",
    getAttribute: () => clicked ? "true" : "false",
    click: () => { clicked = true; }
  };
  const article = (handle, postId) => ({
    querySelector(selector) {
      if (selector === '[data-testid="User-Name"]') {
        return { querySelectorAll: () => [{ href: "https://x.com/" + handle }] };
      }
      if (selector === 'a[href*="/status/"]') {
        return { href: "https://x.com/" + handle + "/status/" + postId };
      }
      return null;
    },
    querySelectorAll: () => []
  });
  const scope = {
    querySelectorAll: () => stage === 0
      ? [article("Alice", "1")]
      : [article("Alice", "1"), article("Bob", "2")]
  };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    document: {
      querySelector: () => scope,
      querySelectorAll: () => options.noTab ? [] : [tab]
    },
    location: { pathname: "/home", origin: "https://x.com" },
    window: { innerHeight: 800, scrollBy: () => { stage += 1; } },
    URL,
    setTimeout
  });
  vm.runInContext(source, context);
  vm.runInContext("waitForPageReady = async () => {}; delay = async () => {};", context);
  return { context, wasClicked: () => clicked };
}

test("只提取 X 主页或帖子作者链接", () => {
  const { context } = makeContext();
  const call = (href) => vm.runInContext("timelineHandleFromHref(" + JSON.stringify(href) + ")", context);
  assert.equal(call("https://x.com/Alice"), "Alice");
  assert.equal(call("https://twitter.com/Bob/status/123"), "Bob");
  assert.equal(call("https://example.com/Alice"), null);
  assert.equal(call("https://x.com/home"), null);
});

test("切到为你推荐并滚动收集出现的发帖账号，按账号去重", async () => {
  const { context, wasClicked } = makeContext();
  const result = await vm.runInContext("collectForYou()", context);
  assert.equal(wasClicked(), true);
  assert.deepEqual([...result.handles], ["alice", "bob"]);
  assert.equal(result.scannedPosts, 2);
  assert.ok(result.rounds <= 40);
});
