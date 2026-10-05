# 🐛 书虫 Bookworm

英语文献与书籍桌面/移动阅读器。专为阅读英文书籍、论文文献设计，内置逐句朗读、中英对照、批注体系与全文翻译。同一套代码同时支持 **Windows 桌面版（Electron）** 与 **Android 版（WebView）**。

![Version](https://img.shields.io/badge/version-1.3.0-blue) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android-lightgrey) ![License](https://img.shields.io/badge/license-MIT-green)

## ✨ 功能

- **本地导入** — TXT / EPUB / PDF / **DOCX** / **MOBI·AZW·AZW3** / MD / HTML，支持文件对话框与拖放导入，自动识别编码与章节
- **书架** — 封面网格展示（书名/作者/格式/阅读进度条），按书名·作者·分类搜索，最近阅读，「继续上次的阅读」，导入后自动弹出**编辑信息/分类**对话框，删除书籍及其全部笔记
- **阅读** — 分页（左右半屏点击翻页，划选不误翻）与连续滚动两种模式；←/→、PageUp/PageDown 快捷键；目录跳转；全书进度条拖拽；窗口缩放自适应重排；随时保存进度
- **显示设置** — 默认正楷(KaiTi)·分页·夜间模式；系统字体/楷体/宋体/黑体；字号 14–36；日间/夜间/护眼配色；自定义日间背景色
- **双击查词** — 双击正文中的任意英语单词，立即播放标准读音（默认美音）并弹出中文翻译、音标与词典释义
- **搜索与翻译** — Ctrl+F 全文搜索并跳回原文；选中即可在 Bing/百度/Google/维基百科搜索；选中单词/语句弹出中文翻译 + 发音
- **批注体系** — 黄/绿高亮、直线、波浪线、批注（金黄/草绿/天蓝/樱粉四色 × 色块/直线/波浪三样式）、书签；笔记面板可查看/搜索/编辑/删除/跳转
- **导出笔记** — 按书导出 Markdown（书名、章节、摘录、批注、时间）
- **系统语音朗读** — 开始/暂停/继续/停止，0.5–2 倍速，声音按美音(默认)/英音分组，逐句高亮跟读、自动跨章（安卓端桥接系统 TTS 引擎）
- **中英对照** — 每段英文下方附中文翻译（句子级对齐，带缓存），选中英语句子时对应中文高亮提示
- **自动检查更新** — 启动时自动检查 GitHub Releases，发现新版本弹出下载横幅；设置面板可手动检查

## 📱 Android 版

从 [Releases](../../releases) 下载 `Bookworm-x.y.z.apk` 安装（需要允许安装未知来源应用）。

- 数据存于应用自身的 IndexedDB，与桌面版相互独立
- 朗读使用系统 TTS 引擎（设置 → 朗读声音 可选美音/英音；手机未预装 KaiTi 时字形以可用字体渲染）
- 导入书籍点「＋ 导入书籍」选取文件即可；笔记导出保存到下载目录

## 🚀 桌面版使用

从 [Releases](../../releases) 下载 `Bookworm-x.y.z.exe`（单文件便携版，无需安装），双击即可运行。书籍、笔记、进度保存在 `%APPDATA%\书虫`，替换 exe 不丢失数据。

## 🛠 开发

```bash
npm install          # 安装依赖 (Electron 33 + pdf.js + JSZip)
npm start            # 开发运行
npm run smoke        # Electron 自动化冒烟测试
npm run webtest      # 浏览器模式 (IndexedDB shim) 自动化测试
npm run dist         # 打包 Windows 便携 exe (dist/书虫.exe)
bash scripts/build-apk.sh    # 构建安卓 APK (自动下载 JDK/SDK, 无需 Gradle)
bash scripts/sync-desktop.sh # 同步到桌面 (优雅关闭旧版 → 替换 → 校验)
```

## 📦 发布新版本

1. 修改 `package.json` 中的 `version` 与 `android/AndroidManifest.xml` 中的 `versionName/versionCode`
2. `npm run dist` 打包 exe；`bash scripts/build-apk.sh` 构建 APK
3. `git tag vX.Y.Z && git push --tags`
4. `gh release create vX.Y.Z dist/书虫.exe dist/书虫.apk` 发布，应用内即可检查到更新

> 翻译服务默认走 Google → MyMemory 自动回退，可在设置中配置自定义翻译接口（兼容 Google translate_a/single 格式）。

## License

[MIT](LICENSE)
