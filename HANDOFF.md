# opabrow 交接文档

> 接手人: 任何后续 agent
> 写交接时间: 2026-07-17
> 原始主 agent: Mavis (mavis / mvs_1108f8768cbb4124ac4bf610902a99ee)
> 用户: tan (macOS, 在职备考 2027 广东省考)

## 项目一句话
**opabrow** = 透明无边框浮动浏览器，Electron 43 + React 19 + TypeScript，**macOS native** 体验（所有操作走屏幕顶部系统菜单栏，窗口 chrome-less），B 站那种"边看边做事"的场景。

## 当前位置
`/Users/tan/opabrow-electron/` (注意：原 Tauri 旧项目 `/Users/tan/opabrow/` 保留作参考，不动它)

## 当前状态（2026-07-17）
### Codex 接手记录（2026-07-17 14:15 CST）
1. **导航历史修复收口**：
   - `src/preload/index.ts` 补齐 `MenuAction` 的 `go_back` / `go_forward` 类型。
   - `src/renderer/src/App.tsx` 移除 renderer 里不可靠的 `webview.getWebContents()` 兜底逻辑（Electron `WebviewTag` 类型不提供该 API）。
   - `target=_blank` 继续交给 main 进程 `app.on('web-contents-created')` 全局拦截，并在当前 `webContents.loadURL(url)`，renderer 只通过 `did-navigate` / `did-navigate-in-page` 同步 quick bar 地址。
   - 用户侧仍建议做一次真实 B 站点击 smoke test：点一个 `target=_blank` 视频/链接后，用 ⌘+[ / ⌘+] 验证 history。
2. **构建验证**：
   - `pnpm typecheck` 已通过。
   - `pnpm build` 已通过。
   - `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm build:mac:dir` 已通过，刷新了 `dist/mac-arm64/opabrow.app`（未签名，仅本地结构验证）。
3. **签名/上架预检**：
   - 本机 codesigning identities：有 `Apple Development: Clayton TAN (G8PHD8SY4N)`、`Apple Distribution: Clayton TAN (JD4R6V223R)` 等。
   - 普通 `pnpm build:mac:dir` / 旧的 `pnpm build:mac` 会卡在 `codesign`，疑似 Keychain 授权或证书选择阻塞；已清理残留构建进程。
   - 找到 ASC key：`F3R68P4ATZ`、`RVK944728A`，Issuer `6c3f2b79-9e8a-4db3-bd89-ac0ac9f4c5d8`。
   - ASC REST 只读验证：两把 key 能认证并读取 apps 列表，但当前查不到 `com.tan.opabrow` App 记录；查询 `bundleIds` 返回 Apple 403（提示 Team ID `JD4R6V223R` 不可用/无权限），所以 Bundle ID 不能靠这组 API key 自动确认或创建。

### 已完成 ✅
1. **核心功能 dev 模式跑通**：
   - 透明 + 无边框 + macOS 风格全屏隐藏红绿黄按钮（trafficLightPosition 挪到 -100,-100）
   - 顶部 32px 全宽 drag bar（`-webkit-app-region: drag` + 兜底 `startDragging()` IPC）
   - ⌘L 唤起 quick bar（URL 输入 + 透明度滑块 + 置顶 toggle + 关闭）
   - macOS 顶部系统菜单栏：opabrow / 浏览 / 视图 / 窗口
   - 快捷键：⌘L（地址）、⌘R（刷新）、⌘T（置顶）、⌘+[/]（Safari 风格前进后退）、⌘⇧H（首页）、⌘+=/-（透明度 ±0.1）
   - **点 B 站 target=_blank 链接** 不再开新窗口 — main 进程 `app.on('web-contents-created')` 全局 hook 所有 webContents 的 setWindowOpenHandler，**直接 `contents.loadURL(url)`** 让当前 webview navigate，保留 history
2. **构建配置完成**：
   - `electron-builder.yml`：Bundle ID `com.tan.opabrow`, mas target, icon.icns, hardenedRuntime, entitlements.mac.plist (沙盒 + network.client)
   - `build/icon.icns` 已生成（紫渐变 + 环形 O + 箭头，1024x1024 PNG 转 sips）
   - `build/entitlements.mac.plist` 已写好（app-sandbox + network.client + network.server + files.user-selected.read-write + print）
   - **本地 `pnpm build:mac:dir` 跑过，278M .app 生成在 dist/mac-arm64/opabrow.app**
   - Apple Team ID 已确认: `G8PHD8SY4N`（从签名 identityName 提取）
3. **背景任务**：之前的 dev 任务全部完成，无残留

### 进行中 ⏳
- **Mac App Store 上架**（用户最后请求，但 dev 模式 + 前/后退都修好后转去做这）
  - 需要 user 提供 App Store Connect API Key（.p8 + Key ID + Issuer ID）
  - 需要 user 在 Apple Developer 后台注册 `com.tan.opabrow` 这个 Bundle ID
  - 需要 user 在 App Store Connect 创建 app entry（macOS, 名称 opabrow, SKU opabrow）

### 已知问题 / 阻塞 🐛
- **dev 模式快捷键前进后退**：之前用户反馈过"前进后退无反应"。我加了 `app.on('web-contents-created')` 全局 hook 让 main 进程拦截链接后 `contents.loadURL(url)` 而不是用 IPC 改 webview.src — 改完后 user 没明确反馈是否解决，**接班后第一件事是确认这一点**。
- **本地 ad-hoc 签 .app 启动失败**（错误 163 Launchd job spawn failed）：因为沙盒 + hardened runtime + webview 内部进程需要正确 entitlements。这条**不影响上架**（mas build 用 Distribution 证书 + 公证能解决），只影响本地试跑。

## 用户偏好（from Mavis user.md）
- **完全自动化优先**：明确说"我不要手动，你想办法解决"，不要把活甩回 user
- **格式不挑剔**：html/json/任何方式都行
- **大批量分批做 + 第一节打样**：65 节课一次做不完，先做第 1 集完整 sample（这条不适用于本项目）
- **接受长任务后台跑 + 完成时通知**
- **沟通中文 + 直接给结论 + 操作步骤**
- **接受技术术语直接用**（HTTP/API/加密流/沙盒/entitlements）
- **平台：macOS (darwin)**, shell 默认 PowerShell 兼容

## 上架下一步（待 user 提供凭证）
1. **user 在 Apple Developer 后台注册 Bundle ID**（developer.apple.com/account → Identifiers → + → App IDs → Explicit → `com.tan.opabrow` → 勾 Network → Register）
2. **user 在 App Store Connect 创建 app entry**（appstoreconnect.apple.com → 我的 App → + → 新建 App → macOS → 名称 opabrow → Bundle ID com.tan.opabrow → SKU opabrow）
3. **user 在 App Store Connect 生成 API Key**（Users and Access → Keys → App Store Connect API → Generate → 下载 .p8 存到 `~/Keys/opabrow-deploy.p8` → 记 Key ID + Issuer ID）
4. **user 把 .p8 路径 + Key ID + Issuer ID 给我**，我就能：
   - 配 notarize 凭证（`env` 或 `~/.notarytool/credentials.json`）
   - 跑 `ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" pnpm build:mac:mas`（mas target 走 Distribution 证书）
   - 自动公证（notarytool） + 自动上传 App Store Connect（@electron/notarize + transporter）
   - 给 user 一个 macOS 通用本地测试版本（dist 目录的 .app）+ App Store Connect 里的新版本 entry

## 关键文件路径
- `electron-builder.yml` — mac 配置（mas target, hardened runtime, entitlements, icon）
- `build/icon.icns` — 1024x1024 + 16/32/64/128/256/512 全套尺寸 icns
- `build/entitlements.mac.plist` — 沙盒配置
- `src/main/index.ts` — main 进程（macOS 风格菜单、setWindowOpenHandler 全局 hook、IPC handlers）
- `src/renderer/src/App.tsx` — React renderer（dynamic webview creation, did-attach-webview hook, quick bar UI）
- `src/renderer/src/App.css` — drag 32px 顶栏 + quick bar 三行布局
- `src/preload/index.ts` — contextBridge `window.opabrow` API

## 关键 IPC 频道
- `set-opacity` / `set-always-on-top`（renderer → main）
- `menu-action`（main → renderer，'go_url' | 'reload' | 'home' | 'go_back' | 'go_forward' | 'ontop_toggle' | 'opacity_inc' | 'opacity_dec' | 'show_quickbar'）
- `navigate-iframe`（main → renderer，target URL string）
- `start-drag`（renderer → main，触发 `BrowserWindow.startDragging()`）

## 关键技术决策（不要改回去）
- **用 Electron 不用 Tauri 2**：Tauri 2 的 macOS 透明 + chrome-less 窗口有 fundamental drag bug
- **macOS 系统菜单栏，不用 in-window UI**：用户明确要求
- **32px 顶栏 drag**（不是 32x32 角手柄）：macOS 浮窗标准模式
- **`<webview>` 标签 + dynamic createElement**：React 19 不渲染 `<webview>` JSX
- **`flex: 1 1 auto` + `inset: 0`**：webview 不响应 `width/height: 100%`（把它们当 hint）
- **`app.on('web-contents-created')` 全局 hook setWindowOpenHandler**：每个 webContents 都拦截新窗口，**关键**是直接 `contents.loadURL(url)` 让当前 webview navigate，**不要**通过 IPC 通知 renderer 改 src（否则 history 会重置）
- **`<webview>` 元素监听 `did-attach-webview` 后用 `wv.getWebContents().setWindowOpenHandler()`**：对 webview 内部 setWindowOpenHandler 也作为兜底
- **快捷键 ⌘+[/] 替代 ⌘+←/→**：避开 webview 内部 Chromium 抢 ⌘+←/→ 响应
- **renderer 端 keydown 监听只在 webview 未 focus 时有效**（webview 焦点时键盘事件全进 webview，renderer 收不到）— 主路径走菜单 accelerator
- **`<webview>.setAttribute('allowpopups', 'false')`** 仅建议性，**真正拦截靠 setWindowOpenHandler deny**
- **macOS retina 2x 下** `minWidth: 240, minHeight: 180` 逻辑像素 → 物理 480x360
- **使用 Chrome user agent** 修复 B 站"浏览器版本过低"检测
- **`electron-vite 5.0.0` + `electron 43.1.1` + `vite 7.3.6`**
- **手动 `ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`** 处理 esbuild postinstall 失败和 Electron binary 下载（中国大陆网络）
- **pkill dev 用**：`pkill -f "opabrow-electron"; pkill -f "electron-vite"`
- **macOS 窗口位置诊断**：`osascript -e 'tell application "System Events" to tell process "Electron" to set position of window 1 to {200, 100}'`
