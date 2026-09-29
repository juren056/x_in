import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");

function makeContext(options = {}) {
  let stage = 0;
  let now = 0;
  let clicked = false;
  const scrollingElement = { scrollTop: 0, scrollHeight: options.blocked ? 800 : 100000, clientHeight: 800 };
  const nestedScroller = {
    scrollTop: 0, scrollHeight: 100000, clientHeight: 500, parentElement: null,
    scrollBy({ top }) { stage += 1; this.scrollTop += top; }
  };
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
      if (selector === '[data-testid="tweetText"]') return { textContent: handle === "Alice" ? "#互关" : "普通帖子" };
      if (selector === 'a[href*="/status/"]') {
        return { href: "https://x.com/" + handle + "/status/" + postId };
      }
      return null;
    },
    querySelectorAll: () => []
  });
  const scope = {
    querySelector: () => options.nestedScroller ? { parentElement: nestedScroller } : null,
    querySelectorAll: () => options.delayedPosts
      ? now < 1200 ? [] : [article("Alice", "1"), ...(stage > 0 && now >= 3000 ? [article("Bob", "2")] : [])]
      : options.sameAuthorPosts
      ? [
        article("Alice", "1"),
        ...(stage >= 4 ? [article("Alice", "2")] : []),
        ...(stage >= 8 ? [article("Alice", "3")] : [])
      ]
      : stage === 0
        ? [article("Alice", "1")]
        : [article("Alice", "1"), article("Bob", "2")]
  };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    document: {
      querySelector: () => scope,
      querySelectorAll: () => options.noTab ? [] : [tab],
      scrollingElement,
      body: {}
    },
    location: { pathname: "/home", origin: "https://x.com" },
    window: { innerHeight: 800, scrollY: 0, scrollBy: ({ top }) => {
      stage += 1;
      if (!options.blocked) scrollingElement.scrollTop += top;
    } },
    getComputedStyle: () => ({ overflowY: "auto" }),
    URL,
    Date: class extends Date { static now() { return now; } },
    advance: (duration) => { now += duration; },
    setTimeout
  });
  vm.runInContext(source, context);
  vm.runInContext("waitForPageReady = async () => {}; delay = async (duration) => { advance(duration); };", context);
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
  assert.equal(result.posts.length, 2);
  assert.equal(result.posts[0].text, "#互关");
  assert.ok(result.rounds <= 30);
});
test("账号数不增加时继续收集后续出现的同账号帖子", async () => {
  const { context } = makeContext({ sameAuthorPosts: true });
  const result = await vm.runInContext("collectForYou()", context);
  assert.deepEqual([...result.handles], ["alice"]);
  assert.deepEqual(Array.from(result.posts, (post) => post.postUrl), [
    "https://x.com/Alice/status/1",
    "https://x.com/Alice/status/2",
    "https://x.com/Alice/status/3"
  ]);
});

test("等待 X 延迟加载首批和后续帖子，不因短暂空白提前停止", async () => {
  const { context } = makeContext({ delayedPosts: true });
  const result = await vm.runInContext("collectForYou()", context);
  assert.deepEqual([...result.handles], ["alice", "bob"]);
  assert.equal(result.scannedPosts, 2);
  assert.ok(result.rounds > 1);
});

test("自定义滚动次数实际限制扫描循环", async () => {
  const { context } = makeContext();
  const result = await vm.runInContext("collectForYou(2)", context);
  assert.equal(result.rounds, 2);
  await assert.rejects(vm.runInContext("collectForYou(0)", context), /1–200/);
  await assert.rejects(vm.runInContext("collectForYou(201)", context), /1–200/);
});

test("后台页滚动与加载均停滞时标记为部分结果", async () => {
  const { context } = makeContext({ blocked: true });
  const result = await vm.runInContext("collectForYou(30)", context);
  assert.equal(result.stopReason, "stalled");
  assert.equal(result.rounds, 4);
  assert.equal(result.scrollDistance, 0);
});

test("可滚动容器内的时间线也能推进扫描", async () => {
  const { context } = makeContext({ nestedScroller: true });
  const result = await vm.runInContext("collectForYou(2)", context);
  assert.equal(result.rounds, 2);
  assert.ok(result.scrollDistance > 0);
});
