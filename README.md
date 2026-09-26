# X Follow Audit / X 关注巡检台

A local Chrome / Edge Manifest V3 extension for collecting X account links, checking your following list, and processing up to 10 follow attempts per batch.

## English

### Workflow

1. Click **Read For You**. The extension opens X Home in a background tab, selects the For You feed, scrolls, and collects unique post authors into the input list. You can also paste X profile or post URLs manually.
2. Click **Scan status** or **Follow 10**. The extension reads your own following list first and removes accounts already followed from the pending list.
3. It reuses one background tab to inspect remaining profiles. Follow 10 stops after 10 follow attempts and queues the rest. Stop preserves completed results.
4. Progress, remaining URLs, results, and the last batch time are saved locally in the browser.

The For You feed is infinite. A single import stops after at most 40 scrolls or five scrolls without finding a new account. The result is the accounts encountered during that run, not every account that could ever appear on X.

An editable reply helper is available below the results. It saves text locally and copies it to the clipboard. It does not post comments automatically.

### Installation

1. Open chrome://extensions or edge://extensions.
2. Enable Developer mode and choose Load unpacked.
3. Select this repository directory and log in to X.

### Tests and limitations

Run npm test. The test suite covers link parsing, the batch limit, and For You account collection. X can change its page structure or button labels; browser verification in a logged-in X session is still needed. Use the extension in line with X rules and applicable limits.

## 中文说明

### 工作流程

1. 点击“读取首页为你推荐”。插件会在后台打开 X 首页、切换到“为你推荐”、滚动收集帖子作者，并把去重后的主页地址填入原来的输入框。也可以继续手动粘贴主页或帖子链接。
2. 点击“只检测状态”或“一键关注 10 个”。插件先读取自己的 following 列表，过滤已关注账号。
3. 插件复用一个后台标签页逐个检查剩余账号。“一键关注 10 个”最多尝试关注 10 个，剩余账号标为待下批。手动停止会保留已完成结果。
4. 进度、待处理地址、结果和上次批次时间保存在浏览器本地。

“为你推荐”是无限时间线。单次读取最多滚动 40 次，或连续 5 次没有新账号时提前结束；得到的是本次实际遇到的账号，不代表 X 上可能出现的全部账号。

结果下方有独立的可编辑回复辅助框。文字保存在本地，可复制后自行到 X 原帖发送；插件不会自动评论。

### 安装和验证

打开 Chrome 或 Edge 扩展管理页，开启开发者模式并加载本目录。先登录 X，再运行插件。运行 npm test 可以检查解析、批次限制和账号收集逻辑。X 的页面结构可能变化，仍需在已登录的浏览器中验证页面读取与关注状态识别。
