# 发布到 GitHub

本文说明如何把整理好的 `Tonnetz-Lite` 文件夹发布为一个公开仓库，并生成 Release 与 GitHub Pages 站点。

## 1. 发布前检查

确认目录中**没有**以下内容：

- `demo-video/`、`vd/`、`release/`；
- `.runtime/`、`__pycache__/`；
- `Tonnetz Lite.lnk`；
- 录屏、音频中间文件、构建缓存；
- 个人路径、令牌、账号密码。

本项目提供的 `.gitignore` 已忽略运行时、快捷方式和压缩包。首次提交前仍建议执行：

```bash
git status --short
```

确认所有文件都是应该公开的。

## 2. 初始化仓库

在项目根目录执行：

```bash
git init -b main
git add .
git commit -m "Initial open-source release v0.1.0"
```

如果准备以个人或组织名义发布，先按实际情况修改 `LICENSE` 中的版权人（当前为 `Tonnetz Lite contributors`），再提交。

如果 Git 提示需要设置身份：

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

## 3. 创建 GitHub 仓库

1. 登录 GitHub，点击 **New repository**。
2. 仓库名建议：`tonnetz-lite`。
3. 选择 **Public**。
4. **不要**勾选“Add a README file”“Add .gitignore”“Choose a license”——这些文件已经在本地准备好。
5. 创建后复制仓库地址。

关联并推送：

```bash
git remote add origin https://github.com/yourname/tonnetz-lite.git
git push -u origin main
```

如果创建仓库时误加了 README，可先同步再推送：

```bash
git pull --rebase origin main
git push -u origin main
```

## 4. 仓库设置

建议在仓库首页右侧 **About** 中填写：

- **Description**：`Offline Tonnetz grid, harmony functions, SATB analysis and MIDI export — vanilla JS, no build step.`
- **Website**：GitHub Pages 部署后的地址。
- **Topics**：

```text
music-theory  harmony  tonnetz  web-audio  midi  satb
music-education  vanilla-javascript  canvas  offline-first
```

其他建议：

- 确认 GitHub 识别到 **MIT license**；
- 在 **Settings → General → Features** 中按需开启 Issues / Discussions；
- 在 **Settings → Social preview** 上传 1280×640 的界面截图或封面；
- 不需要开启 Wiki，文档已放在 `docs/`。

## 5. 发布 GitHub Pages

仓库已包含 `.github/workflows/pages.yml`。

1. 进入 **Settings → Pages**。
2. **Build and deployment → Source** 选择 **GitHub Actions**。
3. 打开 **Actions** 标签，等待 `Deploy static site to GitHub Pages` 运行。
4. 首次可点击 **Run workflow** 手动触发。
5. 部署完成后，在 Actions 的部署步骤或 Pages 设置中取得 URL。

无需构建命令，artifact 就是仓库根目录的静态文件。

> 如果默认分支不是 `main`，请修改 `.github/workflows/pages.yml` 的 `branches`。

## 6. 创建 Release

先打标签：

```bash
git tag -a v0.1.0 -m "Tonnetz Lite v0.1.0 — first open-source edition"
git push origin v0.1.0
```

然后在 GitHub：

1. 进入 **Releases → Draft a new release**。
2. 选择标签 `v0.1.0`。
3. 标题：`v0.1.0 — 首个开源整理版`。
4. 说明可参考 [CHANGELOG](../CHANGELOG.md)。
5. 上传源码压缩包（可选，GitHub 会自动提供 Source code zip/tar.gz）。

生成干净的源码压缩包（推荐用 Git，能包含隐藏文件并排除忽略项）：

```bash
git archive --format=zip --prefix=Tonnetz-Lite/ \
  -o ../Tonnetz-Lite-v0.1.0.zip HEAD
```

Windows PowerShell 若使用 `Compress-Archive`，注意默认通配符可能漏掉 `.github`、`.gitignore` 等点文件；优先使用 `git archive` 或 7-Zip。

## 7. 发布后验证

- 打开仓库首页，确认 README 图片、文档链接、LICENSE 均正常。
- 打开 Pages 地址，确认应用能加载、能发声、能导出 MIDI。
- 用无痕窗口测试，排除本地缓存影响。
- 检查 `git ls-files` 中没有 `vd/`、`demo-video/`、`.runtime/`。
- 检查 Release 附件可以下载并解压。
- 在手机或窄屏上打开一次，确认至少能阅读与基本操作（当前未专门优化小屏）。

## 8. 后续维护

- 修复问题后更新 `CHANGELOG.md`，打新标签并发布 Release。
- 若修改了输入语法、安装方式或 SATB 行为，同步更新 `docs/`。
- 合并 PR 前跑一遍 [开发与架构的验收清单](开发与架构.md#验收清单)。
- 不要强制推送已发布的标签；必要时发布新的补丁版本。

## 9. 可选：GitHub Actions 自动检查

当前只包含 Pages 部署。若希望增加 CI，可在 `.github/workflows/` 中加入一个无依赖检查：

```yaml
name: Smoke test
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: python -m py_compile serve.py
      - run: |
          python serve.py --port 8850 --no-browser --quiet &
          sleep 1
          curl --fail http://127.0.0.1:8850/
          curl --fail http://127.0.0.1:8850/assets/js/app.js
          curl --fail http://127.0.0.1:8850/api/ping
```

如加入该工作流，请先在本地验证，避免把不稳定的端口/后台进程写进默认分支。
