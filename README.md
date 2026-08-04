# X Follow Audit

> A small, local-first Manifest V3 browser extension for auditing X follow lists and following accounts in safe batches.

English is the default documentation. [中文说明](#中文说明) is included below.

## What it does

X Follow Audit accepts pasted text rather than requiring a clean URL list. It extracts X profile links from lines that contain numbering, Chinese or English display names, comments, tweet URLs, and mixed separators. Tweet links such as `/status/...` are normalized to the account homepage and duplicate accounts are removed.

The extension provides two workflows:

- **Scan status** — opens each profile in a temporary background tab and reports whether the account is already followed.
- **Follow 10** — scans the whole list, but clicks Follow for at most 10 not-followed accounts in the current batch. Remaining accounts are marked as queued for the next batch.

The most recent batch time is displayed in the popup. URL lists, results, and timestamps stay in `chrome.storage.local`; the extension does not send them to a server.

## Features

- Extracts `x.com` and `twitter.com` links from unstructured pasted text.
- Ignores list numbers, names, notes, query strings, and tweet paths.
- Deduplicates accounts before scanning.
- Enforces a hard maximum of 10 follow attempts per batch.
- Shows Following, Followed, Not followed, Queued, Unavailable, and Failed states.
- Uses temporary background tabs and closes them after each check.
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

2. Click **Scan status** to audit without clicking Follow.
3. Click **Follow 10** to process the next safe batch.
4. Keep the X session logged in and avoid starting another batch until the current one finishes.

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
- This tool is provided for personal use. Follow X rules and applicable rate limits; review the list before starting a batch.

## License

Released under the [MIT License](./LICENSE).

---

## 中文说明

### 项目简介

X 关注巡检台是一个本地优先的 Manifest V3 浏览器插件，用于检测 X 账号关注状态，并以每批最多 10 个账号的节奏执行关注。

它支持直接粘贴带有序号、中文昵称、备注、推文链接的混合文本。插件只提取 `x.com` / `twitter.com` 链接中的账号名，把 `/status/...` 还原成账号主页，并自动去重。

### 功能

- **只检测状态**：逐个打开临时后台标签页，读取 Follow / Following 状态，不点击按钮。
- **一键关注 10 个**：完整扫描当前列表，但每次最多点击 10 个未关注账号，其余标记为“待下批”。
- **状态展示**：已关注、刚刚关注、未关注、待下批、无法确认、检测失败。
- **本地存储**：地址列表、结果和最近一次批次时间只保存在浏览器本地，不上传服务器。

### 安装与使用

1. 打开 Chrome 或 Edge 扩展管理页并开启开发者模式。
2. 选择“加载已解压的扩展程序”，指向本仓库目录。
3. 登录 X 后打开插件，粘贴任意包含 X 链接的文本。
4. 点击“只检测状态”或“一键关注 10 个”。

### 开发测试

```bash
npm test
```

本项目运行时不依赖第三方库，核心逻辑位于 `background.js`、`content.js`、`popup.js` 和 `url-utils.js`。

### 注意事项

X 页面结构和按钮文案可能变化，必要时需要维护 `content.js` 中的选择器。请确保已登录 X，并遵守 X 的平台规则和频率限制。

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。
