import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyFriendPost, discoverReplyCandidates, matchReplyTags } from "../reply-rules.js";
import { buildFeedbackExport } from "../audit-data.js";

const feedback = JSON.parse(fs.readFileSync(
  new URL("./fixtures/classifier-feedback-2026-09-27.json", import.meta.url), "utf8"));
const laterFeedback = JSON.parse(fs.readFileSync(
  new URL("./fixtures/classifier-feedback-2026-09-28.json", import.meta.url), "utf8"));

test("23 manually confirmed false negatives now pass the classifier", () => {
  assert.equal(feedback.samples.length, 23);
  const incorrect = feedback.samples.filter((sample) =>
    classifyFriendPost(sample.text).matched !== sample.shouldMatch);
  assert.deepEqual(incorrect.map((sample) => sample.handle), []);
  const candidates = discoverReplyCandidates([], feedback.samples);
  assert.equal(candidates.length, 23);
  assert.equal(new Set(candidates.map((item) => item.postUrl.toLowerCase())).size, 23);
});

test("9 new manually confirmed false negatives pass without hardcoding post URLs", () => {
  assert.equal(laterFeedback.samples.length, 9);
  const missed = laterFeedback.samples.filter((sample) =>
    classifyFriendPost(sample.text).matched !== sample.shouldMatch);
  assert.deepEqual(missed.map((sample) => sample.handle), []);
  assert.equal(discoverReplyCandidates([], laterFeedback.samples).length, 9);
});

test("all 32 labeled examples export as corrected under the current classifier", () => {
  const labels = [...feedback.samples, ...laterFeedback.samples].map((sample) => ({
    postUrl: sample.postUrl, shouldMatch: true,
    postSnapshot: { ...sample, matched: false, classifierVersion: "0.5.18" }
  }));
  const exported = buildFeedbackExport([], labels, "2026-09-28T05:00:00.000Z");
  assert.equal(exported.summary.labels, 32);
  assert.equal(exported.summary.falseNegatives, 0);
  assert.ok(exported.samples.every((sample) => sample.correction === "agrees"));
});

test("new hashtag variants match as whole tags", () => {
  assert.deepEqual(matchReplyTags("#蓝V互浇 #浇蓝朋友 #蓝V互关互粉 #浇友 #蓝V互关互粉群"),
    ["蓝V互关互粉", "蓝V互浇", "浇蓝朋友", "浇友"]);
});

test("refusing follow-for-numbers still allows a genuine invitation", () => {
  assert.equal(classifyFriendPost("不想互关刷量，只想认识真诚的蓝朋友。#蓝朋友").matched, true);
  assert.equal(classifyFriendPost("不想互关刷量，只聊技术").matched, false);
});

test("nearby unrelated or explicitly refusing posts stay out of the reply queue", () => {
  const negatives = [
    "今天和朋友吃饭，晚上看电影",
    "不互关，请勿打扰 #蓝朋友",
    "不求互关刷量，只聊技术",
    "我们计划涨粉 2000，产品还在开发",
    "X 平台更新了推荐算法",
    "#新人 旅行记录",
    "关注列表里有不少人",
    "蓝朋友这个词是什么意思？",
    "马上破4000了，给电脑加油",
    "不要浇朋友，请勿评论",
    "不要浇个蓝朋友，也不要互动",
    "蓝朋友难找，但我不想交朋友",
    "今天认识了一个新朋友",
    "扩大交际圈的书籍推荐",
    "X 上蓝V认真互动才能提升曝光",
    "保持关注，继续交友项目的研发进度"
  ];
  assert.deepEqual(negatives.filter((text) => classifyFriendPost(text).matched), []);
});
