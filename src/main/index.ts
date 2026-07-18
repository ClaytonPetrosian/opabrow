import { app, BrowserWindow, shell, ipcMain, Menu, MenuItemConstructorOptions, screen } from 'electron';
import { join } from 'node:path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';

// ---------- 窗口引用 ----------
let mainWindow: BrowserWindow | null = null;

// ---------- 全局拦截所有 webContents 的新窗口请求 ----------
// 关键:webview 标签内的 <a target="_blank"> 链接会创建新的 BrowserWindow
// setWindowOpenHandler 只对 BrowserWindow 主 webContents 生效,
// 但通过 app.on('web-contents-created') 可以拦截所有 webContents(包括 webview guest)
app.on('web-contents-created', (_event, contents) => {
  // 用 try/catch 保护:某些 macOS 上 webview guest 初始化时设 setWindowOpenHandler 会抛
  // (虽然有 -3 errorno log 但不影响渲染)
  try {
    contents.setWindowOpenHandler((details) => {
      console.log('[opabrow] setWindowOpenHandler intercepted:', details.url, 'in wc', contents.id, 'type=', contents.getType());
      // 在当前 webContents 内直接 navigate —— 这样 history 累积,前进后退能用
      contents.loadURL(details.url);
      return { action: 'deny' };
    });
  } catch (e: any) {
    console.warn('[opabrow] setWindowOpenHandler failed for wc', contents.id, 'type=', contents.getType(), ':', e?.message);
  }
  try {
    contents.on('will-navigate', (_event, url, isInPlace, isMainFrame) => {
      console.log('[opabrow] will-navigate:', url, 'isInPlace=', isInPlace, 'isMainFrame=', isMainFrame, 'wc=', contents.id);
    });
  } catch (e: any) {}
});

// macOS 现代 Chrome UA(避免 B 站"浏览器版本过低")
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 opabrow/0.1';

// ---------- 创建主窗口 ----------
function createMainWindow(): BrowserWindow {
  // 先确定 primary display 坐标,别让窗口跑到外接屏去
  const { screen } = require('electron');
  const primary = screen.getPrimaryDisplay();
  const db = primary.bounds;
  const w = Math.min(1000, db.width - 100);
  const h = Math.min(700, db.height - 100);
  const x = db.x + Math.floor((db.width - w) / 2);
  const y = db.y + Math.floor((db.height - h) / 2) + 20;
  console.log('[opabrow] primary display bounds:', JSON.stringify(db), '→ window', w, 'x', h, 'at', x, ',', y);

  const win = new BrowserWindow({
    x, y, width: w, height: h,
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
    titleBarStyle: 'hidden',
    backgroundColor: '#ffffff',
    hasShadow: false,
    movable: true,
    resizable: true,
    title: 'opabrow',
    visibleOnAllWorkspaces: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false, // iframe 用 allow-same-origin,需要这一关
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      webviewTag: true // 显式启用 <webview> tag
    }
  });

  // 自定义 UA
  win.webContents.setUserAgent(CHROME_UA);

  // 调试:把 renderer 的 console.log 转发到主进程 stdout
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log(`[renderer:${level}] ${message} (${source}:${line})`);
  });

  // 加载 dev / prod URL
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // 阻止 renderer 主页面新开窗口 —— 把 URL 交给当前 webview 导航
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      win.webContents.send('navigate-iframe', url);
    }
    return { action: 'deny' };
  });

  // 阻止外跳(在当前 webContents 内 navigate 到外部 URL)
  win.webContents.on('will-navigate', (event, url) => {
    // renderer 内的 webview 跳转不走这里
    // 这里拦截的是 renderer 主页面本身的导航
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'] ?? '';
    if (rendererUrl && url.startsWith(rendererUrl)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  // 拦截 iframe 内部 fullscreen request——B 站视频全屏限制在窗口内
  // (Electron 的 enter-full-screen 事件签名是 will-resize,需要换个方式)
  // 思路:拦截 webContents 'enter-html-full-screen',然后立刻让 window 退出 fullscreen
  // 这样视频虽然没全屏,但窗口不会被推到屏幕全屏
  win.webContents.on('enter-html-full-screen', () => {
    // 立刻退出 native fullscreen,让视频回到窗口内大小
    win.setFullScreen(false);
  });

  // ready-to-show:窗口准备好显示时
  win.once('ready-to-show', () => {
    // 显式设 alwaysOnTop,让窗口浮在普通窗口之上
    win.setAlwaysOnTop(true, 'pop-up-menu');

    // 强制隐藏 macOS 自己的 traffic lights —— macOS 15 + Electron 43 下
    // titleBarStyle: 'hidden' 仍然让 macOS 画 traffic lights (dimmed 状态)。
    // 三重保险:
    // 1. setWindowButtonVisibility(false) — 官方 API
    // 2. setWindowButtonPosition({x:-100, y:-100}) — 移到屏幕外
    // 3. 在多个生命周期事件 (show/focus/restore/move) 都调用一次
    //    (macOS 15 + Electron 43 的已知 bug,有时只在某个时机调用才生效)
    const hideMacButtons = (): void => {
      if (process.platform !== 'darwin') return;
      try {
        const w = win as unknown as {
          setWindowButtonVisibility?: (v: boolean) => void;
          setWindowButtonPosition?: (pos: { x: number; y: number }) => void;
        };
        w.setWindowButtonVisibility?.(false);
        w.setWindowButtonPosition?.({ x: -100, y: -100 });
      } catch (e) {
        // ignore
      }
    };
    hideMacButtons();
    win.on('show', hideMacButtons);
    win.on('focus', hideMacButtons);
    win.on('restore', hideMacButtons);
    win.on('move', hideMacButtons);

    win.show();
    win.focus();
    win.moveTop();
  });

  return win;
}

// ---------- macOS 顶部菜单栏 ----------
function buildAppMenu(win: BrowserWindow): Menu {
  const isMac = process.platform === 'darwin';

  const appMenu: MenuItemConstructorOptions = {
    label: 'opabrow',
    submenu: [
      { role: 'about', label: '关于 opabrow' },
      { type: 'separator' },
      { role: 'services', label: '服务' },
      { type: 'separator' },
      { role: 'hide', label: '隐藏 opabrow' },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '显示全部' },
      { type: 'separator' },
      { role: 'quit', label: '退出 opabrow' }
    ]
  };

  const browseMenu: MenuItemConstructorOptions = {
    label: '浏览',
    submenu: [
      {
        label: '前往 URL…',
        accelerator: 'CmdOrCtrl+L',
        click: () => win.webContents.send('menu-action', 'go_url')
      },
      { type: 'separator' },
      {
        label: '后退',
        // 用 ⌘+[ 而不是 ⌘+←,避免跟 webview 内部 Chromium 抢键盘事件
        // (⌘+← 会被 webview 内的 B 站自己响应)
        accelerator: 'CmdOrCtrl+[',
        click: () => win.webContents.send('menu-action', 'go_back')
      },
      {
        label: '前进',
        accelerator: 'CmdOrCtrl+]',
        click: () => win.webContents.send('menu-action', 'go_forward')
      },
      { type: 'separator' },
      {
        label: '刷新',
        accelerator: 'CmdOrCtrl+R',
        click: () => win.webContents.send('menu-action', 'reload')
      },
      {
        label: '回到主页',
        accelerator: 'CmdOrCtrl+Shift+H',
        click: () => win.webContents.send('menu-action', 'home')
      }
    ]
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: '视图',
    submenu: [
      {
        label: '切换置顶',
        accelerator: 'CmdOrCtrl+T',
        click: () => win.webContents.send('menu-action', 'ontop_toggle')
      },
      { type: 'separator' },
      {
        label: '增加透明度',
        accelerator: 'CmdOrCtrl+=',
        click: () => win.webContents.send('menu-action', 'opacity_inc')
      },
      {
        label: '降低透明度',
        accelerator: 'CmdOrCtrl+-',
        click: () => win.webContents.send('menu-action', 'opacity_dec')
      },
      { type: 'separator' },
      {
        label: '切换地址栏(临时)',
        accelerator: 'CmdOrCtrl+K',
        click: () => win.webContents.send('menu-action', 'show_quickbar')
      }
    ]
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: '窗口',
    submenu: [
      { role: 'minimize', label: '最小化' },
      { type: 'separator' },
      {
        label: '关闭窗口',
        accelerator: 'CmdOrCtrl+W',
        click: () => win.close()
      }
    ]
  };

  const template: MenuItemConstructorOptions[] = isMac
    ? [appMenu, browseMenu, viewMenu, windowMenu]
    : [browseMenu, viewMenu, windowMenu];

  return Menu.buildFromTemplate(template);
}

// ---------- IPC handlers ----------
function registerIpc(win: BrowserWindow): void {
  // 设置窗口透明度 0.1 - 1.0
  ipcMain.handle('set-opacity', (_e, opacity: number) => {
    const v = Math.max(0.1, Math.min(1.0, opacity));
    win.setOpacity(v);
    return v;
  });

  // 设置窗口置顶
  ipcMain.handle('set-always-on-top', (_e, onTop: boolean) => {
    win.setAlwaysOnTop(onTop, onTop ? 'floating' : 'normal');
    return onTop;
  });

  // 关闭
  ipcMain.handle('close-window', () => {
    win.close();
  });

  // 最小化
  ipcMain.handle('minimize-window', () => {
    win.minimize();
  });

  // 最大化切换(自绘 traffic lights 的 zoom 按钮用)
  ipcMain.handle('zoom-window', () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return win.isMaximized();
  });

  // 强制激活(透明窗口有时需要)
  ipcMain.handle('focus-window', () => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  // 手动开始拖动窗口 —— CSS -webkit-app-region: drag 在透明窗口上有时不灵,这里手动调
  // 主动获取当前鼠标位置(renderer 在 webview 之上收不到 mousemove,
  // 需要从主进程轮询)
  ipcMain.handle('get-cursor-pos', () => {
    try {
      const cursor = screen.getCursorScreenPoint();
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

  ipcMain.handle('start-drag', () => {
    try {
      (win as BrowserWindow & { startDragging?: () => void }).startDragging?.();
    } catch (e) {
      // 某些情况下 startDragging 抛错,忽略
    }
  });
}

// ---------- App 生命周期 ----------
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.opabrow.app');

  // 开启 chrome devtools 远程调试端口,方便诊断
  if (is.dev || process.env['OPABROW_DEVTOOLS']) {
    try {
      app.commandLine.appendSwitch('remote-debugging-port', '9333');
    } catch (e) {
      // ignore
    }
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  mainWindow = createMainWindow();
  registerIpc(mainWindow);

  Menu.setApplicationMenu(buildAppMenu(mainWindow));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      registerIpc(mainWindow);
      Menu.setApplicationMenu(buildAppMenu(mainWindow));
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 安全:阻止 navigation 到非 http(s) 协议
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsed = new URL(navigationUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'file:') {
      event.preventDefault();
    }
  });
});
