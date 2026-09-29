import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");

function replyPage({ execSucceeds = true, inputAllowed = true, inlineDisabled = false, editorSuffix = "", showNewReply = true, initialDraft = "", originalStatusLinks = ["https://x.com/target/status/123"],
  originalAuthorLink = true, originalAuthorHandle = "target", lateDuplicate = false, duplicateFirstInsert = false } = {}) {
  let sendCount = 0;
  let now = 0;
  let ownReplyVisible = false;
  let selectionReady = false;
  let manualInsertions = 0;
  let insertCommands = 0;
  let document;
  const editor = {
    textContent: initialDraft,
    focus() { document.activeElement = editor; },
    closest: () => null,
    dispatchEvent(event) {
      if (event.type === "beforeinput" && !execSucceeds && inputAllowed) editor.textContent = event.data + editorSuffix;
      return inputAllowed;
    }
  };
  const composerContainer = {
    getAttribute: () => null,
    querySelector: (selector) => selector === '[contenteditable="true"]' ? editor : null
  };
  const range = {
    selectNodeContents() {},
    collapse() {},
    insertNode(node) { manualInsertions += 1; editor.textContent += node.textContent; }
  };
  const selection = {
    rangeCount: 1,
    removeAllRanges() { selectionReady = false; },
    addRange() { selectionReady = true; },
    getRangeAt: () => range
  };
  const sendButton = {
    disabled: inlineDisabled,
    getAttribute: () => null,
    click: () => { sendCount += 1; ownReplyVisible = showNewReply; }
  };
  const original = {
    querySelector(selector) {
      if (selector === '[data-testid="User-Name"]')
        return { textContent: "@" + originalAuthorHandle, querySelectorAll: () => originalAuthorLink ? [{ href: "https://x.com/" + originalAuthorHandle }] : [] };
      if (selector === '[data-testid="reply"]') return { click() {} };
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'a[href*="/status/"]'
        ? originalStatusLinks.map((href) => ({ href })) : [];
    }
  };
  const own = {
    querySelector(selector) {
      if (selector === '[data-testid="tweetText"]') return { textContent: "X 页面呈现的回复文字" };
      if (selector === '[data-testid="User-Name"]')
        return { querySelectorAll: () => [{ href: "https://x.com/me" }] };
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'a[href*="/status/"]'
        ? [{ href: "https://x.com/me/status/789" }] : [];
    }
  };
  const previousOwnReply = {
    querySelector(selector) {
      if (selector === '[data-testid="User-Name"]')
        return { querySelectorAll: () => [{ href: "https://x.com/me" }] };
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'a[href*="/status/"]'
        ? [{ href: "https://x.com/me/status/500" }] : [];
    }
  };
  document = {
    activeElement: null,
    hasFocus: () => true,
    createRange: () => range,
    createTextNode: (text) => ({ textContent: text }),
    querySelectorAll(selector) {
      return selector === 'article[data-testid="tweet"]'
        ? ownReplyVisible ? [original, previousOwnReply, own] : [original, previousOwnReply] : [];
    },
    querySelector(selector) {
      if (selector === '[data-testid="tweetTextarea_0"]') return composerContainer;
      if (selector === '[data-testid="tweetButtonInline"]') return sendButton;
      if (selector === '[data-testid="tweetButton"]') return { ...sendButton, disabled: false };
      return null;
    },
    execCommand(command, _showUI, value) {
      if (command === "insertText") insertCommands += 1;
      if (command !== "insertText" || !selectionReady || !execSucceeds) return false;
      editor.textContent = value + (duplicateFirstInsert && insertCommands === 1 ? value : editorSuffix);
      return true;
    }
  };
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    document,
    window: { getSelection: () => selection },
    InputEvent: class InputEvent {
      constructor(type, init) { this.type = type; this.data = init.data; }
    },
    location: { pathname: "/target/status/123", origin: "https://x.com" },
    URL,
    Date: class extends Date { static now() { return now; } },
    advance: (duration) => {
      now += duration;
      if (lateDuplicate && now === 750) editor.textContent += editor.textContent;
    },
    setTimeout
  });
  vm.runInContext(source, context);
  vm.runInContext("delay = async (duration) => { advance(duration); };", context);
  return { context, getSendCount: () => sendCount, getManualInsertions: () => manualInsertions,
    getInsertCommands: () => insertCommands };
}

test("嵌套编辑框获得焦点及光标后，只点击一次发送", async () => {
  const { context, getSendCount } = replyPage();
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "sent");
  assert.equal(getSendCount(), 1);
});

test("标准文字插入失败时通过输入事件写入，成功后才发送", async () => {
  const { context, getSendCount, getManualInsertions } = replyPage({ execSucceeds: false });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "sent");
  assert.equal(getSendCount(), 1);
  assert.equal(getManualInsertions(), 0);
});

test("页面地址不是待回复原帖时不发送", async () => {
  const { context, getSendCount } = replyPage();
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/456", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "failed");
  assert.equal(getSendCount(), 0);
});
test("编辑框拒绝写入时保持失败状态，不点击发送", async () => {
  const { context, getSendCount } = replyPage({ execSucceeds: false, inputAllowed: false });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "failed");
  assert.equal(getSendCount(), 0);
});
test("优先按钮不可用时尝试另一个可用回复按钮", async () => {
  const { context, getSendCount } = replyPage({ inlineDisabled: true });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "sent");
  assert.equal(getSendCount(), 1);
});
test("原帖链接一致时非重复的编辑框附加文字不阻止发送", async () => {
  const { context, getSendCount } = replyPage({ editorSuffix: " 页面补充" });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "sent");
  assert.equal(getSendCount(), 1);
});

test("旧回复不能冒充本次发送成功", async () => {
  const { context, getSendCount } = replyPage({ showNewReply: false });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "uncertain");
  assert.equal(getSendCount(), 1);
});

test("已有草稿时选中并替换后继续发送", async () => {
  const { context, getSendCount } = replyPage({ initialDraft: "上次留下的草稿" });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "sent");
  assert.equal(getSendCount(), 1);
});

test("edited post without an internal permalink uses first tweet on the verified status page", async () => {
  const { context, getSendCount } = replyPage({ originalStatusLinks: [], originalAuthorLink: false });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注", ownHandle:"me"})', context);
  assert.equal(result.status, "sent");
  assert.equal(getSendCount(), 1);
});

test("已验证的页面链接与作者一致时允许原帖内部链接不同", async () => {
  const { context, getSendCount } = replyPage({ originalStatusLinks: ["https://x.com/target/status/999"] });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注", ownHandle:"me"})', context);
  assert.equal(result.status, "sent");
  assert.equal(getSendCount(), 1);
});

test("页面首帖作者与目标链接不一致时不发送", async () => {
  const { context, getSendCount } = replyPage({ originalAuthorHandle: "other", originalStatusLinks: ["https://x.com/other/status/999"] });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注", ownHandle:"me"})', context);
  assert.equal(result.status, "failed");
  assert.equal(result.message, "找不到指定原帖");
  assert.equal(getSendCount(), 0);
});

test("已有相同草稿直接使用，不再次插入", async () => {
  const text = "已关注，互关！";
  const { context, getSendCount, getInsertCommands } = replyPage({ initialDraft: text });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "sent");
  assert.equal(getInsertCommands(), 0);
  assert.equal(getSendCount(), 1);
});

test("标准插入造成整段重复时不点击发送", async () => {
  const text = "已关注，互关！";
  const { context, getSendCount } = replyPage({ editorSuffix: text });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "failed");
  assert.match(result.message, /重复回复/);
  assert.equal(getSendCount(), 0);
});

test("已有两份相同草稿时替换成单份后发送", async () => {
  const text = "已关注，互关！";
  const { context, getSendCount, getInsertCommands } = replyPage({ initialDraft: text + text });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "sent");
  assert.equal(getInsertCommands(), 1);
  assert.equal(getSendCount(), 1);
});

test("首次插入被编辑器重复渲染时替换成单份后发送", async () => {
  const { context, getSendCount, getInsertCommands } = replyPage({ duplicateFirstInsert: true });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "sent");
  assert.equal(getInsertCommands(), 2);
  assert.equal(getSendCount(), 1);
});

test("备用输入事件造成整段重复时不点击发送", async () => {
  const text = "已关注，互关！";
  const { context, getSendCount } = replyPage({ execSucceeds: false, editorSuffix: text });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "failed");
  assert.match(result.message, /重复回复/);
  assert.equal(getSendCount(), 0);
});

test("发送前编辑器再次显示重复文字时修复后只发送一次", async () => {
  const { context, getSendCount, getInsertCommands } = replyPage({ lateDuplicate: true });
  const result = await vm.runInContext('submitReply({postUrl:"https://x.com/target/status/123", text:"已关注，互关！", ownHandle:"me"})', context);
  assert.equal(result.status, "sent");
  assert.equal(getInsertCommands(), 2);
  assert.equal(getSendCount(), 1);
});
