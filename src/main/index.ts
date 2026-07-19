import { app, BrowserWindow, shell, ipcMain, Menu, MenuItemConstructorOptions, screen } from 'electron';
import { join } from 'node:path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';

// ---------- 窗口引用 ----------
let mainWindow: BrowserWindow | null = null;
const TITLEBAR_HEIGHT = 32;

// ---------- 全局拦截所有 webContents 的新窗口请求 ----------
// 关键:webview 标签内的 <a target="_blank"> 链接会创建新的 BrowserWindow
// setWindowOpenHandler 只对 BrowserWindow 主 webContents 生效,
// 但通过 app.on('web-contents-created') 可以拦截所有 webContents(包括 webview guest)
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler((details) => {
    console.log('[opabrow] setWindowOpenHandler intercepted:', details.url, 'in wc', contents.id);
    // 在当前 webContents 内直接 navigate —— 这样 history 累积,前进后退能用
    // 不能用 send IPC 通知 renderer 改 webview.src,那样会重置 history
    contents.loadURL(details.url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (_event, url, isInPlace, isMainFrame) => {
    console.log('[opabrow] will-navigate:', url, 'isInPlace=', isInPlace, 'isMainFrame=', isMainFrame, 'wc=', contents.id);
  });
});

// macOS 现代 Chrome UA(避免 B 站"浏览器版本过低")
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 opabrow/0.1';

// ---------- 创建主窗口 ----------
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 832,
    show: true, // 立刻显示,免得 macOS 透明窗口被吞
    transparent: true,
    frame: false,
    titleBarStyle: 'hiddenInset', // macOS 隐藏标题栏
    trafficLightPosition: { x: -100, y: -100 }, // 把红绿黄按钮挪出可见区
    hasShadow: true,
    backgroundColor: '#00000000', // 完全透明
    movable: true, // 允许拖动
    resizable: true,
    center: true,
    title: 'opabrow',
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

  installTitlebarHoverTracking(win);

  return win;
}

// 标题栏区域独立占据窗口顶部 32px,通过屏幕坐标检测 hover,不依赖 webview 的鼠标事件。
function installTitlebarHoverTracking(win: BrowserWindow): void {
  let lastVisible: boolean | null = null;

  const update = (): void => {
    if (win.isDestroyed()) return;

    const bounds = win.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const visible =
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + TITLEBAR_HEIGHT;

    if (visible === lastVisible) return;
    lastVisible = visible;
    win.webContents.send('titlebar-visibility', visible);
  };

  const timer = setInterval(update, 50);
  win.webContents.on('did-finish-load', () => {
    lastVisible = null;
    update();
  });
  win.once('closed', () => clearInterval(timer));
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
        label: '聚焦地址栏',
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
      },
      { type: 'separator' },
      {
        label: '将当前页面设为主页',
        click: () => win.webContents.send('menu-action', 'set_home')
      },
      {
        label: '恢复项目主页',
        click: () => win.webContents.send('menu-action', 'reset_home')
      }
    ]
  };

  const editMenu: MenuItemConstructorOptions = {
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' }
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
        label: '手机模式访问网页',
        type: 'checkbox',
        checked: false,
        click: (menuItem) => win.webContents.send('menu-action', 'mobile_mode_toggle', menuItem.checked)
      },
      { type: 'separator' },
      {
        label: '调整透明度…',
        click: () => win.webContents.send('menu-action', 'show_opacity_dialog')
      },
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
        label: '打开命令面板',
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
    ? [appMenu, editMenu, browseMenu, viewMenu, windowMenu]
    : [editMenu, browseMenu, viewMenu, windowMenu];

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

  // 强制激活(透明窗口有时需要)
  ipcMain.handle('focus-window', () => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  // 手动开始拖动窗口 —— CSS -webkit-app-region: drag 在透明窗口上有时不灵,这里手动调
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
  electronApp.setAppUserModelId('com.tan.opabrow');

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
