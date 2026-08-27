# 简单阅读 · 纯静态小说阅读站

一套**纯前端 + GitHub API + jsdelivr CDN** 驱动的中文电子书阅读站：无后端、无数据库、无服务器，托管于 GitHub Pages，全程零成本。站点名「简单阅读」，蓝白玻璃风 UI，功能一律纯文字按钮（不使用 emoji / 图标字体）。

> 在线地址：https://trischick.github.io/novel/
>
> 源码仓库：https://github.com/TrisChick/novel

## 功能特性

- **多页结构**：首页（书架列表）/ 详情页（目录）/ 阅读页。
- **书架**：用 GitHub API `git/trees` 枚举 `novel/` 下书籍，展示作者与章节数，支持按书名 / 作者搜索。
- **目录**：支持按卷分组（`mode === "volumes"` 时渲染卷标题 + 卷下章节，其余按 `chapters` 平铺）。
- **阅读页**：字号 A- / A+ 即时调节；正文经外部 `marked` 解析 Markdown 渲染。章节正文按**每页最多 10 万字**分页：短章显示「上一章 / 目录 / 下一章」，超长章（>10 万字）自动分页并显示「上一页 / 目录 / 下一页」，两组导航互斥、不同时出现。
- **阅读设置**：默认字号 / 行距 / 页边距，日间 / 夜间单按钮切换；设置持久化于 `localStorage`（键 `simple_reader_setting`）。
- **全站主题**：蓝白玻璃拟态，移动端适配（`@media(max-width:640px)`），顶部导航吸顶。
- **访问口令门**：`CONFIG.ACCESS_PWD` 非空时进入站点前弹出全屏口令层（`sessionStorage` 同会话免重复），口令正确才加载。

## 页面结构

| 文件 | 用途 | 页面标记 |
|---|---|---|
| `index.html` | 首页 = 书架列表 | `body[data-page="home"]` |
| `detail.html?book=书名` | 详情 + 目录 | `body[data-page="detail"]` |
| `reader.html?book=书名&ch=章节文件` | 阅读页 | `body[data-page="reader"]` |
| `app.js` | 全局配置 `CONFIG`、主题/设置、页面分发器（`body[data-page]`）、口令门 | — |
| `style.css` | 蓝白玻璃风样式 | — |

## 数据与目录约束

```
novel/<书名>/NNN.txt    # UTF-8 章节正文；头部含 <!-- ZW_META: {title,author,book} -->
novel/<书名>/toc.json   # {"mode":"chapters|volumes|single","chapters":[{file,title,volume?}],"volumes":[...]}
novel/sort.json         # {"order":["书名", ...]}，由导入工作流维护
```

- **首页枚举**：书架列表用 GitHub API `git/trees/main?recursive=1` 扫描 `novel/<书>/*.txt|.md`。
- **章节读取**：用 `CONFIG.CDN_BASE`（jsdelivr）+ `toc.json` 按需取。
- **`sort.json`**：仅由导入工作流维护（记录导入顺序）；页面当前按书名排序，不直接依赖它。
- **`ZW_META`**：以注释形式内嵌元信息，不影响正文；阅读页会解析其中的 `title / author / book`。

## 上架新书（_inbox 自助导入）

把小说 `.txt` 上传到 `_inbox/`（GitHub 网页 "Add file" 即可），push 到 `main` 后触发 **Auto import novels from _inbox** 工作流：

1. 逐本运行 `tools/import_novel.mjs`，完成编码识别 / 章节与卷识别 / 段落切分 / 生成章节文件与 `toc.json` / 更新 `sort.json`；
2. 成功则删除 `_inbox` 下已处理文件并统一提交上架；
3. 某本失败会跳过并保留在 `_inbox` 供修复，不影响其余书目。

详细说明见 `_inbox/README.md`。

## 本地命令行导入

```bash
node tools/import_novel.mjs "path\小说.txt" [选项]
```

| 参数 | 说明 |
|---|---|
| `--book 书名` | 指定书名（默认自动提取） |
| `--author 作者` | 指定作者（默认自动提取） |
| `--out 目录` | 输出目录（默认 `novel/<书名>/`） |
| `--pattern 正则` | 强制自定义章节标题正则 |
| `--single` | 强制整本当作单篇导入 |
| `--min-chapters n` | 章节数低于 n 时降级为单篇（默认 1） |
| `--verbose` | 输出更详细检测报告 |
| `--dry-run` | 只分析不写文件 |

导入后 `git add -A && git commit && git push` 即上线；建议先用 `--dry-run --verbose` 预览。

## 访问口令门

- `app.js` 的 `CONFIG.ACCESS_PWD` 存口令的 **SHA-256 十六进制哈希**；留空字符串 = 不启用（公开）。
- 生成哈希：`node tools/gen_pwd.mjs 你的口令`，把输出填入 `CONFIG.ACCESS_PWD` 后推送即生效。

## 工具

- `tools/import_novel.mjs`：通用自动导入。
- `tools/gen_pwd.mjs`：生成口令 SHA-256 哈希。
- `tools/test_site.mjs`：无头 Chrome 回归测试（需 `npm i puppeteer-core`）。

## GitHub Actions

- **Auto import novels from _inbox**：`_inbox` 自助导入（容错批量，失败跳过并保留在 `_inbox`）。
- **Deploy static content to Pages**：GitHub Pages 部署。

## 注意事项与避坑

- **jsdelivr 缓存**：对「已存在」文件有约 12h 缓存；更新某书 `toc.json` 或章节文件后，用 `https://purge.jsdelivr.net/gh/TrisChick/novel@main/novel/<书>/<文件>` 强制刷新（新文件即时生效）。
- **GitHub 分支树缓存**：枚举 / 计数偶有缓存；核对时用具体 commit 的树。
- 仅支持 `.txt` / `.md` 章节文件，其他格式无法解析。
- 国内直连 GitHub 概率超时，可用 `CONFIG.CDN_BASE` 走 jsdelivr 缓解；修改后请强制刷新（`Ctrl+Shift+R`）。
- 请勿在公开场合泄露口令；口令存 SHA-256 哈希，但纯前端门对懂行者可绕过，适合拦截随手点开的路人。

---

开源免费，仅供个人学习、自用与二次开发；请遵循仓库开源协议。
