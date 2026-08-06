import test from "node:test";
import assert from "node:assert/strict";
import { filterNotFollowingUrls, parseXUrls } from "../url-utils.js";

test("只保留有效 X 主页并去重", () => {
  assert.deepEqual(parseXUrls("https://x.com/alice\nhttps://twitter.com/bob, https://x.com/alice"), [
    "https://x.com/alice",
    "https://x.com/bob"
  ]);
});

test("过滤 X 导航页和无效地址", () => {
  assert.deepEqual(parseXUrls("https://x.com/home\nhttps://example.com/user\nnot-a-url"), []);
});

test("支持中文逗号和空格分隔", () => {
  assert.deepEqual(parseXUrls("https://x.com/a，https://x.com/b https://x.com/c"), [
    "https://x.com/a",
    "https://x.com/b",
    "https://x.com/c"
  ]);
});

test("忽略序号、中文备注，并把推文地址还原为主页", () => {
  assert.deepEqual(parseXUrls("22. 小龙成Hu https://x.com/AIJonHu/status/2084240192278503595?s=20\nhttps://x.com/LynneBuilds有关必回"), [
    "https://x.com/AIJonHu",
    "https://x.com/LynneBuilds"
  ]);
});

test("先根据我的关注列表过滤已关注账号", () => {
  assert.deepEqual(filterNotFollowingUrls([
    "https://x.com/AlreadyFollowed",
    "https://x.com/new_account"
  ], ["alreadyfollowed"]), ["https://x.com/new_account"]);
});
