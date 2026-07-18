"use strict";
const electron = require("electron");
const node_path = require("node:path");
const is = {
  dev: !electron.app.isPackaged
};
const platform = {
  isWindows: process.platform === "win32",
  isMacOS: process.platform === "darwin",
  isLinux: process.platform === "linux"
};
const electronApp = {
  setAppUserModelId(id) {
    if (platform.isWindows)
      electron.app.setAppUserModelId(is.dev ? process.execPath : id);
  },
  setAutoLaunch(auto) {
    if (platform.isLinux)
      return false;
    const isOpenAtLogin = () => {
      return electron.app.getLoginItemSettings().openAtLogin;
    };
    if (isOpenAtLogin() !== auto) {
      electron.app.setLoginItemSettings({ openAtLogin: auto });
      return isOpenAtLogin() === auto;
    } else {
      return true;
    }
  },
  skipProxy() {
    return electron.session.defaultSession.setProxy({ mode: "direct" });
  }
};
const optimizer = {
  watchWindowShortcuts(window, shortcutOptions) {
    if (!window)
      return;
    const { webContents } = window;
    const { escToCloseWindow = false, zoom = false } = shortcutOptions || {};
    webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown") {
        if (!is.dev) {
          if (input.code === "KeyR" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "KeyI" && (input.alt && input.meta || input.control && input.shift)) {
            event.preventDefault();
          }
        } else {
          if (input.code === "F12") {
            if (webContents.isDevToolsOpened()) {
              webContents.closeDevTools();
            } else {
              webContents.openDevTools({ mode: "undocked" });
              console.log("Open dev tool...");
            }
          }
        }
        if (escToCloseWindow) {
          if (input.code === "Escape" && input.key !== "Process") {
            window.close();
            event.preventDefault();
          }
        }
        if (!zoom) {
          if (input.code === "Minus" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "Equal" && input.shift && (input.control || input.meta))
            event.preventDefault();
        }
      }
    });
  },
  registerFramelessWindowIpc() {
    electron.ipcMain.on("win:invoke", (event, action) => {
      const win = electron.BrowserWindow.fromWebContents(event.sender);
      if (win) {
        if (action === "show") {
          win.show();
        } else if (action === "showInactive") {
          win.showInactive();
        } else if (action === "min") {
          win.minimize();
        } else if (action === "max") {
          const isMaximized = win.isMaximized();
          if (isMaximized) {
            win.unmaximize();
          } else {
            win.maximize();
          }
        } else if (action === "close") {
          win.close();
        }
      }
    });
  }
};
let mainWindow = null;
electron.app.on("web-contents-created", (_event, contents) => {
  try {
    contents.setWindowOpenHandler((details) => {
      console.log("[opabrow] setWindowOpenHandler intercepted:", details.url, "in wc", contents.id, "type=", contents.getType());
      contents.loadURL(details.url);
      return { action: "deny" };
    });
  } catch (e) {
    console.warn("[opabrow] setWindowOpenHandler failed for wc", contents.id, "type=", contents.getType(), ":", e?.message);
  }
  try {
    contents.on("will-navigate", (_event2, url, isInPlace, isMainFrame) => {
      console.log("[opabrow] will-navigate:", url, "isInPlace=", isInPlace, "isMainFrame=", isMainFrame, "wc=", contents.id);
    });
  } catch (e) {
  }
});
const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 opabrow/0.1";
function createMainWindow() {
  const { screen: screen2 } = require("electron");
  const primary = screen2.getPrimaryDisplay();
  const db = primary.bounds;
  const w = Math.min(1e3, db.width - 100);
  const h = Math.min(700, db.height - 100);
  const x = db.x + Math.floor((db.width - w) / 2);
  const y = db.y + Math.floor((db.height - h) / 2) + 20;
  console.log("[opabrow] primary display bounds:", JSON.stringify(db), "→ window", w, "x", h, "at", x, ",", y);
  const win = new electron.BrowserWindow({
    x,
    y,
    width: w,
    height: h,
    minWidth: 240,
    minHeight: 180,
    show: true,
    // 真正的 iPhone Mirroring 风格浮窗:
    // - frame: true + titleBarStyle: 'hidden'  (macOS):
    //     * macOS 完全不画 title bar + traffic lights
    //     * contentView 从 0 开始
    //     * resizable: true 仍然有效,macOS 自动处理边框 resize
    // - 顶部的 traffic lights 完全由 React 自己画:
    //     * 平时 opacity: 0 (视觉上完全不可见,看上去就是 chrome-less 矩形窗口)
    //     * 鼠标 hover 窗口顶部 28px 时 opacity: 1,显示红黄绿三个按钮
    // macOS 15 + Electron 43 的 'customButtonsOnHover' 在我们环境实测是 traffic lights
    // 一直显示(hover 行为失效),所以改成自己控制
    frame: true,
    titleBarStyle: "hidden",
    backgroundColor: "#ffffff",
    hasShadow: false,
    movable: true,
    resizable: true,
    title: "opabrow",
    visibleOnAllWorkspaces: true,
    fullscreenable: false,
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      // iframe 用 allow-same-origin,需要这一关
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      webviewTag: true
      // 显式启用 <webview> tag
    }
  });
  win.webContents.setUserAgent(CHROME_UA);
  win.webContents.on("console-message", (_e, level, message, line, source) => {
    console.log(`[renderer:${level}] ${message} (${source}:${line})`);
  });
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      win.webContents.send("navigate-iframe", url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const rendererUrl = process.env["ELECTRON_RENDERER_URL"] ?? "";
    if (rendererUrl && url.startsWith(rendererUrl)) return;
    event.preventDefault();
    electron.shell.openExternal(url);
  });
  win.webContents.on("enter-html-full-screen", () => {
    win.setFullScreen(false);
  });
  win.once("ready-to-show", () => {
    win.setAlwaysOnTop(true, "pop-up-menu");
    const hideMacButtons = () => {
      if (process.platform !== "darwin") return;
      try {
        const w2 = win;
        w2.setWindowButtonVisibility?.(false);
        w2.setWindowButtonPosition?.({ x: -100, y: -100 });
      } catch (e) {
      }
    };
    hideMacButtons();
    win.on("show", hideMacButtons);
    win.on("focus", hideMacButtons);
    win.on("restore", hideMacButtons);
    win.on("move", hideMacButtons);
    win.show();
    win.focus();
    win.moveTop();
  });
  return win;
}
function buildAppMenu(win) {
  const isMac = process.platform === "darwin";
  const appMenu = {
    label: "opabrow",
    submenu: [
      { role: "about", label: "关于 opabrow" },
      { type: "separator" },
      { role: "services", label: "服务" },
      { type: "separator" },
      { role: "hide", label: "隐藏 opabrow" },
      { role: "hideOthers", label: "隐藏其他" },
      { role: "unhide", label: "显示全部" },
      { type: "separator" },
      { role: "quit", label: "退出 opabrow" }
    ]
  };
  const browseMenu = {
    label: "浏览",
    submenu: [
      {
        label: "前往 URL…",
        accelerator: "CmdOrCtrl+L",
        click: () => win.webContents.send("menu-action", "go_url")
      },
      { type: "separator" },
      {
        label: "后退",
        // 用 ⌘+[ 而不是 ⌘+←,避免跟 webview 内部 Chromium 抢键盘事件
        // (⌘+← 会被 webview 内的 B 站自己响应)
        accelerator: "CmdOrCtrl+[",
        click: () => win.webContents.send("menu-action", "go_back")
      },
      {
        label: "前进",
        accelerator: "CmdOrCtrl+]",
        click: () => win.webContents.send("menu-action", "go_forward")
      },
      { type: "separator" },
      {
        label: "刷新",
        accelerator: "CmdOrCtrl+R",
        click: () => win.webContents.send("menu-action", "reload")
      },
      {
        label: "回到主页",
        accelerator: "CmdOrCtrl+Shift+H",
        click: () => win.webContents.send("menu-action", "home")
      }
    ]
  };
  const viewMenu = {
    label: "视图",
    submenu: [
      {
        label: "切换置顶",
        accelerator: "CmdOrCtrl+T",
        click: () => win.webContents.send("menu-action", "ontop_toggle")
      },
      { type: "separator" },
      {
        label: "增加透明度",
        accelerator: "CmdOrCtrl+=",
        click: () => win.webContents.send("menu-action", "opacity_inc")
      },
      {
        label: "降低透明度",
        accelerator: "CmdOrCtrl+-",
        click: () => win.webContents.send("menu-action", "opacity_dec")
      },
      { type: "separator" },
      {
        label: "切换地址栏(临时)",
        accelerator: "CmdOrCtrl+K",
        click: () => win.webContents.send("menu-action", "show_quickbar")
      }
    ]
  };
  const windowMenu = {
    label: "窗口",
    submenu: [
      { role: "minimize", label: "最小化" },
      { type: "separator" },
      {
        label: "关闭窗口",
        accelerator: "CmdOrCtrl+W",
        click: () => win.close()
      }
    ]
  };
  const template = isMac ? [appMenu, browseMenu, viewMenu, windowMenu] : [browseMenu, viewMenu, windowMenu];
  return electron.Menu.buildFromTemplate(template);
}
function registerIpc(win) {
  electron.ipcMain.handle("set-opacity", (_e, opacity) => {
    const v = Math.max(0.1, Math.min(1, opacity));
    win.setOpacity(v);
    return v;
  });
  electron.ipcMain.handle("set-always-on-top", (_e, onTop) => {
    win.setAlwaysOnTop(onTop, onTop ? "floating" : "normal");
    return onTop;
  });
  electron.ipcMain.handle("close-window", () => {
    win.close();
  });
  electron.ipcMain.handle("minimize-window", () => {
    win.minimize();
  });
  electron.ipcMain.handle("zoom-window", () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return win.isMaximized();
  });
  electron.ipcMain.handle("focus-window", () => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  electron.ipcMain.handle("get-cursor-pos", () => {
    try {
      const cursor = electron.screen.getCursorScreenPoint();
      const bounds = win.getBounds();
      return {
        x: cursor.x - bounds.x,
        y: cursor.y - bounds.y,
        screenX: cursor.x,
        screenY: cursor.y,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
      };
    } catch (e) {
      return null;
    }
  });
  electron.ipcMain.handle("start-drag", () => {
    try {
      win.startDragging?.();
    } catch (e) {
    }
  });
}
electron.app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.opabrow.app");
  if (is.dev || process.env["OPABROW_DEVTOOLS"]) {
    try {
      electron.app.commandLine.appendSwitch("remote-debugging-port", "9333");
    } catch (e) {
    }
  }
  electron.app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });
  mainWindow = createMainWindow();
  registerIpc(mainWindow);
  electron.Menu.setApplicationMenu(buildAppMenu(mainWindow));
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      registerIpc(mainWindow);
      electron.Menu.setApplicationMenu(buildAppMenu(mainWindow));
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("web-contents-created", (_, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsed = new URL(navigationUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") {
      event.preventDefault();
    }
  });
});
