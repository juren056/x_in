# X Follow Audit

> A small, local-first Manifest V3 browser extension for auditing X follow lists and following accounts in safe batches.

English is the default documentation. [中文说明](#中文说明) is included below.

## What it does

X Follow Audit accepts pasted text rather than requiring a clean URL list. Before checking targets, it first reads your own X following list once and filters out accounts you already follow. It then extracts X profile links from lines that contain numbering, Chinese or English display names, comments, tweet URLs, and mixed separators. Tweet links such as `/status/...` are normalized to the account homepage and duplicate accounts are removed.

The extension provides two workflows:

- **Scan status** — synchronizes your following list first, then opens only profiles not present in that list.
- **Follow 10** — scans only until 10 follow attempts have been made, then marks the remaining accounts as queued without opening their profiles.

The most recent batch time is displayed in the popup. URL lists, results, and timestamps stay in `chrome.storage.local`; the extension does not send them to a server.

## Features

- Extracts `x.com` and `twitter.com` links from unstructured pasted text.
- Ignores list numbers, names, notes, query strings, and tweet paths.
- Deduplicates accounts before scanning.
- Removes accounts from the saved pending list immediately after they are detected as Following or successfully followed.
- Enforces a hard maximum of 10 follow attempts per batch.
- Shows Following, Followed, Not followed, Queued, Unavailable, and Failed states.
- Reuses one temporary background tab instead of opening and closing a tab for every account.
- Adds a 3.5–5.3 second gap between profiles and a longer pause every 15 profiles.
- Pauses automatically after three consecutive page errors to protect the X session.
- Keeps manual Stop effective even if the extension service worker has restarted during a long task.
- Uses a dark, compact control-console popup designed for quick repeated batches.

## Installation (Chrome / Edge)

1. Clone or download this repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose this repository directory.
5. Log in to X, then open **X Follow Audit** from the browser toolbar.

## Usage

1. Paste any text containing X links into the input box. For example, all of the following are accepted:

   ```text
   1. https://x.com/example
   Alice https://x.com/another_user/status/123456789?s=20 必回关
   ```

2. Click **Scan status** to synchronize and audit without clicking Follow.
3. Click **Follow 10** to synchronize and process the next safe batch.
4. Click **Stop current task** whenever you need to stop; completed results are preserved and unprocessed accounts are queued.
5. Keep the X session logged in and avoid starting another batch until the current one finishes. The extension intentionally waits between profiles; this is expected.

## Development

The extension is intentionally dependency-free at runtime. The small Node test suite covers URL extraction and the 10-account batch limit.

```bash
npm test
```

The main pieces are:

- `popup.html`, `popup.css`, `popup.js` — popup UI and interaction.
- `background.js` — sequential tab orchestration, progress, and local persistence.
- `content.js` — Follow / Following detection and the guarded click action.
- `url-utils.js` — extraction and normalization of X account links.

## Important limitations

- X can change its DOM and button labels; selectors in `content.js` may need maintenance.
- You must already be logged in to X in the browser profile.
- A protected, unavailable, or rate-limited profile is reported instead of being forced.
- Large scans are deliberately slow. If three consecutive profiles cannot be read, the job pauses and preserves the completed results.
- This tool is provided for personal use. Follow X rules and applicable rate limits; review the list before starting a batch.

## License

Released under the [MIT License](./LICENSE).

---

## 中文说明

### 项目简介

X 关注巡检台是一个本地优先的 Manifest V3 浏览器插件，用于检测 X 账号关注状态，并以每批最多 10 个账号的节奏执行关注。

它支持直接粘贴带有序号、中文昵称、备注、推文链接的混合文本。插件只提取 `x.com` / `twitter.com` 链接中的账号名，把 `/status/...` 还原成账号主页，并自动去重。

### 功能

- **先比对关注列表**：先识别当前登录账号并读取 `/<用户名>/following`，已关注账号直接标记，不再打开其主页。
- **只检测状态**：对比后只复用一个临时后台标签页读取未关注账号状态，不点击按钮。
- **一键关注 10 个**：只处理到本批次 10 次关注尝试，剩余账号直接标记为“待下批”，不会继续打开主页。
- **状态展示**：已关注、刚刚关注、未关注、待下批、无法确认、检测失败。
- **自动清理**：检测为已关注或本次关注成功后，立即从本地待处理列表移除，后续批次不再重复打开。
- **安全节流**：复用一个后台标签页，账号之间自动等待，每 15 个账号长暂停一次；连续 3 个主页异常会自动暂停。
- **可靠停止**：后台 service worker 重启后仍能恢复任务状态，手动停止会保留已完成结果并清理工作标签页。
- **本地存储**：地址列表、结果和最近一次批次时间只保存在浏览器本地，不上传服务器。

### 安装与使用

1. 打开 Chrome 或 Edge 扩展管理页并开启开发者模式。
2. 选择“加载已解压的扩展程序”，指向本仓库目录。
3. 登录 X 后打开插件，粘贴任意包含 X 链接的文本。
4. 点击“只检测状态”或“一键关注 10 个”，插件会先同步你的 following 列表。
5. 任务运行时可以点击“停止当前任务”，已完成结果会保留。

### 开发测试

```bash
npm test
```

本项目运行时不依赖第三方库，核心逻辑位于 `background.js`、`content.js`、`popup.js` 和 `url-utils.js`。

### 注意事项

X 页面结构和按钮文案可能变化，必要时需要维护 `content.js` 中的选择器。请确保已登录 X，并遵守 X 的平台规则和频率限制。

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。
