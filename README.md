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

1. 点击“读取首页为你推荐”。插件会在后台标签页打开 X 首页，不切换当前页面、切换到“为你推荐”、滚动收集帖子作者，并把去重后的主页地址填入原来的输入框。也可以继续手动粘贴主页或帖子链接。
2. 点击“只检测状态”或“一键关注 10 个”。插件先读取自己的 following 列表，过滤已关注账号。
3. 插件复用一个后台标签页逐个检查剩余账号。“一键关注 10 个”最多尝试关注 10 个，剩余账号标为待下批。手动停止会保留已完成结果。
4. 进度、待处理地址、结果和上次批次时间保存在浏览器本地。

“为你推荐”是无限时间线。单次读取的滚动次数可在弹窗中设置为 1–200 次（默认 30 次）。扫描会检测实际滚动位置和新帖子；页面连续多次既不滚动也不加载时，会标记为部分结果并显示停止原因，整次扫描最多约 4 分钟。若后台页面无法继续加载，可先在当前标签页打开 X 首页，再点击“在当前 X 首页扫描”；此方式不创建或关闭标签页，但会自动滚动当前页面。得到的是本次实际遇到的账号，不代表 X 上可能出现的全部账号。

结果下方有独立的可编辑回复辅助框。文字保存在本地，可复制后自行发送，也可确认批次后由扩展自动发布。

### 安装和验证

打开 Chrome 或 Edge 扩展管理页，开启开发者模式并加载本目录。先登录 X，再运行插件。运行 npm test 可以检查解析、批次限制和账号收集逻辑。X 的页面结构可能变化，仍需在已登录的浏览器中验证页面读取与关注状态识别。

## 回复候选 / Reply candidates

开启“自动筛选待回复帖子”后，扩展会累计识别带指定完整话题标签或明确交友邀请的原帖。未关注账号显示“待关注”，已关注账号显示“待回复”。每次自动评论前仍需确认本批账号和回复内容。

When filtering is enabled, matching original posts are kept in a local review list. Confirm the selected accounts and reply text before starting each batch.

## 一键评论 10 个

在回复辅助区编辑 1–280 字的回复内容。开启自动筛选后，累计采集到且符合标签或明确交友邀请的原帖会进入候选列表。点击“一键评论 10 个”后，先确认候选池和回复内容，再按列表顺序逐条处理，直到确认成功 10 条或候选用完。可停止批次。每条结果会保存为待回复、正在发布、已回复、发布失败或结果待核查。对于结果待核查的帖子，先打开原帖确认未发布，再手动重新排队，避免重复发送。

同一已关注账号在已采集时间线中有多条匹配帖子时，待回复列表按原帖地址逐条显示并去重；旧列表中的账号会在打开弹窗时从本地时间线补齐其他匹配帖。列表显示全部记录，每批最多确认成功 10 条；失败的候选会顺延。

评论批次遇到单条失败时会记录错误并跳到下一条；结果无法确认时不计成功，保留该原帖标签页供核查，同时在新的工作标签页处理下一条。用户核查后可标记已回复或重置状态。达到 10 条确认成功、候选用完或手动停止时结束批次，并关闭当前工作标签页。

识别机制：首页已采集的原帖先按指定完整话题标签、明确交友邀请或 X 社区互动语境识别，并在本地列表中按帖子地址去重。支持 #蓝V互浇、#蓝V互关互粉、#浇蓝朋友、#浇友 等完整标签，以及新人互动、寻找新朋友、互相关注和评论交流等表达；明确拒绝互关或交友的帖子仍排除。“不求互关刷量”与拒绝交友不同，结合正文和标签判定。识别与关注状态分离：尚未确认关注的记录显示“待关注”；关注列表已确认或新关注成功后变为“待回复”，才可进入每批最多 10 条的自动评论。旧复核记录在扩展打开时按当前规则重新判定，原始时间和人工标注保留。导出时连已清零列表中保留的人工标注快照也重新判定，避免把旧版本已修复的帖子反复计为当前误判。

回复区“累计匹配”显示多次首页采集中所有已识别的原帖及其状态，按帖子地址去重，不受每批 10 条的发布上限限制。“清零”只清空本地累计匹配与回复状态，不清除账号导入列表或已经在 X 发布的评论；旧缓存不会立即回填，清零后再次采集到的帖子重新累计。

评论输入先尝试在获得焦点的 X 编辑框中插入一次；若编辑器不接受，则只派发一次输入事件，不再同时直接修改 DOM，以免重复出现回复内容。如编辑框有旧草稿则先选中替换；写入非空内容且发送按钮可用后点击“回复”，不再逐字比较编辑框与模板；页面出现本次新发布的账号回复后关闭工作标签页，无法确认时保留。

## 筛选复核与本地误判文件

扫描“为你推荐”后，打开默认折叠的“05 / 筛选复核”，可查看累计未通过筛选的原帖正文、作者、链接、原因和首次/最近采集时间。列表按原帖链接去重，直接显示全部累计记录，可在列表中滚动查看。正文无法读取的帖子会单独标明，避免把它误认为普通未命中。

未通过的帖子可点“误判：应当通过”；已通过的帖子可在回复候选列表点“误判：不应通过”。标注可填写说明和时间，立即存在浏览器本地；成功连接本地助手后，每次标注会同步覆盖所选文件夹中的 misclassifications.json。人工标注不会直接改变自动评论名单。若本地写入失败，界面会明确显示“尚未同步”，可在保存地址后重试。“一键导出给 Codex”会在同一文件夹生成带日期时间的 classifier-feedback-*.json，包含帖子正文、链接、原判定、人工判定和误判类型。

### Windows 本地助手安装

扩展不能直接写入任意绝对路径，因此需要本目录中的 Native Messaging 辅助程序。先在 chrome://extensions 加载本目录，复制扩展详情页的 32 位 ID，然后在 PowerShell 运行：

    powershell -ExecutionPolicy Bypass -File E:\GitHub\x_in\native-host\install.ps1 -ExtensionId <扩展ID>

安装脚本用 Windows 自带的 C# 编译器构建 AuditHost.exe（若尚不存在），在当前用户的 Chrome Native Messaging 注册表项登记辅助程序。重载扩展后，展开“筛选复核”，默认地址会显示在“本地保存文件夹”；可改为任意绝对文件夹路径并点击“保存地址并同步”。更换文件夹时会将当前标注同步到新地址，旧文件保留。若使用 Edge，在安装命令末尾加 -Browser Edge。浏览器本地缓存随扩展卸载可能删除；已写入的 JSON 文件不会随扩展卸载而删除。

运行 npm test 验证采集、误判数据、Native Messaging 协议、路径变更和导出。已登录 X 的实际页面仍需在浏览器中试扫一轮。

第 05 区“清零”会清空当前累计的筛选复核帖子，并记下清零时间；旧时间线缓存和本地误判文件不会自动回填旧帖。人工误判标注及其本地 JSON 文件保留，重新扫描到的帖子可再次累计。

回复辅助区可点击“设为默认回复”保存当前 1–280 字内容。之后每次打开弹窗都会自动填入该默认回复；临时改写只影响当前弹窗，要更换默认内容需再次点击按钮。

回复输入会先检查是否已有相同草稿，避免再次插入。若 X 编辑框在输入后或发送前出现整段重复，扩展会选中编辑框全部内容并通过原生输入命令恢复成单份，稳定后才点击“回复”；两次恢复仍失败则跳过该条，避免发布重复正文。已验证的原帖页面 URL 和首帖作者一致时，不再要求帖子卡片内部的状态链接完全相同。
