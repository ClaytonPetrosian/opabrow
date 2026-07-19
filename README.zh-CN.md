<p align="center">
  <img src="./opabrow-icon.png" width="96" alt="opabrow 图标" />
</p>

<h1 align="center">opabrow</h1>

<p align="center">适用于 macOS 的透明浮层浏览器。</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong> · <a href="./README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/ClaytonPetrosian/opabrow/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MPL--2.0-3B82F6?style=flat-square" alt="MPL-2.0 许可证" /></a>
  <img src="https://img.shields.io/badge/platform-macOS-111827?style=flat-square&logo=apple" alt="macOS" />
  <img src="https://img.shields.io/badge/runtime-Electron-47848F?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/status-early%20preview-2EA44F?style=flat-square" alt="早期预览版" />
</p>

<p align="center">让网页留在身边，而不是占满整个桌面。</p>

<p align="center">
  <img src="./docs/opabrow-preview.svg" width="100%" alt="opabrow 浮层浏览器预览" />
</p>

## 为什么是 opabrow

多数浏览器窗口会占据整个工作空间。opabrow 适合那些需要随手可见的网页：参考资料、实时看板、播放列表，或任何你想在其他工作旁边保留的小任务。

标题栏默认透明，鼠标移动到顶部边缘时才显示。它拥有独立的 32px 区域，因此显示控件时不会覆盖网页，也不会让页面发生位移。

| 保持安静 | 快速抵达 |
| --- | --- |
| 无边框透明窗口，标题栏悬停显示 | 地址栏、本地历史建议、前进、后退、刷新和主页 |
| 可调透明度与可选置顶 | 移动端 User-Agent 模式，用于检查响应式网页 |
| 本地优先的浏览历史，无账号或云端同步 | 原生 macOS 菜单命令与熟悉的快捷键 |

## 下载

前往 [最新发布版本](https://github.com/ClaytonPetrosian/opabrow/releases/latest) 下载 macOS、Windows 或 Linux 安装包。每个版本会提供：

- macOS Apple Silicon (`arm64`) 和 Intel (`x64`)
- Windows x64（`.exe` 安装器）
- Linux x64（`.AppImage`）

## 快速开始

### 环境要求

- macOS
- Node.js 22 或更高版本
- pnpm 9 或更高版本

### 本地运行

```bash
git clone https://github.com/ClaytonPetrosian/opabrow.git
cd opabrow
pnpm install
pnpm dev
```

### 构建

```bash
pnpm build
pnpm build:mac
```

## 小巧但完整的浏览体验

### 地址栏与历史记录

将鼠标移动到窗口顶部，或按下 `Cmd+L`。输入时，opabrow 会从本地导航历史中给出匹配建议；使用方向键选择，再按 `Enter` 打开。

### 不抢占网页空间的窗口控件

关闭与最小化控件会在悬停时平滑出现。webview 始终从标题栏下方开始，因此显示控件时不会与网页内容重叠，也不会改变页面布局。

### 桌面与移动模式

从 macOS 菜单切换至移动端 User-Agent，即可检查网站的响应式体验；切回桌面模式时不会丢失当前页面。

## 键盘快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Cmd+L` | 聚焦地址栏 |
| `Cmd+[` / `Cmd+]` | 后退 / 前进 |
| `Cmd+R` | 刷新 |
| `Cmd+Shift+H` | 打开主页 |
| `Cmd+T` | 切换置顶 |
| `Cmd+=` / `Cmd+-` | 调整窗口透明度 |
| `Cmd+K` | 打开命令面板 |

## 开发

```bash
pnpm typecheck
pnpm build
```

项目基于 Electron 和 React。Electron 主进程负责原生窗口与 macOS 菜单；渲染进程负责标题栏、地址栏、本地历史记录和 webview 交互。

## 路线图

免费核心专注于打磨浮层浏览体验。未来的 Pro 探索可能加入工作区、配置档案、可选同步和自动化，但不会移除本地优先的核心能力。

## 参与贡献

欢迎提交 Bug 报告、设计反馈和聚焦的 Pull Request。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

opabrow 采用 [Mozilla Public License 2.0](LICENSE) 发布。
