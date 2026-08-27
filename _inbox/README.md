# _inbox 自动导入

把要上架的小说 `.txt` 丢在这个文件夹里，提交/上传到 `main` 分支后，GitHub Actions 会自动执行：

1. 用 `tools/import_novel.mjs` 拆分成章节、自动识别书名/作者/卷、生成每章文件与 `novel/<书名>/toc.json`；
2. 更新 `novel/sort.json`；
3. 删除已处理的 `_inbox/*.txt`；
4. 提交并推回 `main`，GitHub Pages 自动部署上架。

## 怎么用
- 最简单：在 GitHub 网页打开 `_inbox` → "Add file" → 上传 `.txt` → 提交（Commit changes）。无需本地 git / 命令行。
- 也可以本地 `git push` 一个 `.txt` 到这里。

## 注意事项
- 只处理 `_inbox/` **根目录**下的一级 `.txt`（文件名以 `.txt` 结尾）。
- 书名/作者自动从书中 `《书名》` 与 `作者：xxx` 提取；识别不了时用文件名，作者显示"佚名"。
- 新书导入后即可上架（jsdelivr 对**新文件**即时生效）。
- 若导入失败（如格式特殊），工作流会报错，日志里能看到是哪个文件；`.txt` 会保留在 `_inbox` 供你处理。
- 特殊格式需要手动干预时，用 `node tools/import_novel.mjs <文件> --dry-run --verbose` 先看识别结果。
