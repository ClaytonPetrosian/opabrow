import { app, BrowserWindow, dialog, shell, ipcMain, Menu, MenuItemConstructorOptions, screen } from 'electron';
import { join } from 'node:path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import {
  BookmarkNode,
  BookmarkStore,
  importChromeBookmarksFromDisk,
  importHtmlBookmarksFromFile,
  importSafariBookmarksFromDisk
} from './bookmarks';

// ---------- 窗口引用 ----------
let mainWindow: BrowserWindow | null = null;
let bookmarkStore: BookmarkStore | null = null;
let mobileModeEnabled = false;
let ipcHandlersRegistered = false;
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
function bookmarkMenuItems(nodes: BookmarkNode[], win: BrowserWindow): MenuItemConstructorOptions[] {
  return nodes.map((node) => {
    if (node.type === 'folder') {
      return {
        label: node.title,
        submenu: bookmarkMenuItems(node.children, win)
      };
    }

    return {
      label: node.title,
      toolTip: node.url,
      click: () => win.webContents.send('menu-action', 'bookmark_open', node.url)
    };
  });
}

function refreshApplicationMenu(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !bookmarkStore) return;
  Menu.setApplicationMenu(buildAppMenu(mainWindow, bookmarkStore));
}

async function showImportResult(win: BrowserWindow, source: string, importBookmarks: () => Promise<number>): Promise<void> {
  try {
    const added = await importBookmarks();
    refreshApplicationMenu();
    await dialog.showMessageBox(win, {
      type: 'info',
      title: '收藏导入完成',
      message: added > 0 ? `${source} 收藏已导入 ${added} 条链接。` : `${source} 中没有新的收藏链接。`
    });
  } catch (error) {
    await dialog.showMessageBox(win, {
      type: 'warning',
      title: '无法导入收藏',
      message: error instanceof Error ? error.message : '导入过程中发生未知错误。'
    });
  }
}

function buildAppMenu(win: BrowserWindow, bookmarks: BookmarkStore): Menu {
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

  const bookmarksMenu: MenuItemConstructorOptions = {
    label: '收藏',
    submenu: [
      {
        label: '收藏 / 取消收藏当前页面',
        accelerator: 'CmdOrCtrl+D',
        click: () => win.webContents.send('menu-action', 'bookmark_toggle')
      },
      { type: 'separator' },
      ...bookmarkMenuItems(bookmarks.getItems(), win),
      { type: 'separator' },
      {
        label: '从 Chrome 导入…',
        click: () => {
          void showImportResult(win, 'Chrome', async () => {
            const imported = await importChromeBookmarksFromDisk();
            return bookmarks.importFolder(imported);
          });
        }
      },
      {
        label: '从 Safari 导入…',
        click: () => {
          void showImportResult(win, 'Safari', async () => {
            const imported = await importSafariBookmarksFromDisk();
            return bookmarks.importFolder(imported);
          });
        }
      },
      {
        label: '导入书签 HTML…',
        click: () => {
          void (async () => {
            const selection = await dialog.showOpenDialog(win, {
              title: '导入书签 HTML',
              buttonLabel: '导入',
              properties: ['openFile'],
              filters: [
                { name: '书签 HTML', extensions: ['html', 'htm'] },
                { name: '所有文件', extensions: ['*'] }
              ]
            });
            if (selection.canceled || selection.filePaths.length === 0) return;
            await showImportResult(win, 'HTML', async () => {
              const imported = await importHtmlBookmarksFromFile(selection.filePaths[0]);
              return bookmarks.importFolder(imported);
            });
          })().catch((error) => console.warn('Could not select bookmark HTML:', error));
        }
      },
      { type: 'separator' },
      {
        label: '清空全部收藏…',
        enabled: bookmarks.getItems().length > 0,
        click: () => {
          void (async () => {
            const result = await dialog.showMessageBox(win, {
              type: 'warning',
              title: '清空全部收藏',
              message: '确定要删除所有本机收藏吗？此操作无法撤销。',
              buttons: ['取消', '清空'],
              defaultId: 0,
              cancelId: 0
            });
            if (result.response !== 1) return;
            await bookmarks.clear();
            refreshApplicationMenu();
          })().catch((error) => console.warn('Could not clear bookmarks:', error));
        }
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
        checked: mobileModeEnabled,
        click: (menuItem) => {
          mobileModeEnabled = menuItem.checked;
          win.webContents.send('menu-action', 'mobile_mode_toggle', menuItem.checked);
        }
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
    ? [appMenu, editMenu, browseMenu, bookmarksMenu, viewMenu, windowMenu]
    : [editMenu, browseMenu, bookmarksMenu, viewMenu, windowMenu];

  return Menu.buildFromTemplate(template);
}

// ---------- IPC handlers ----------
function registerIpc(bookmarks: BookmarkStore): void {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  // 设置窗口透明度 0.1 - 1.0
  ipcMain.handle('set-opacity', (_e, opacity: number) => {
    const v = Math.max(0.1, Math.min(1.0, opacity));
    mainWindow?.setOpacity(v);
    return v;
  });

  // 设置窗口置顶
  ipcMain.handle('set-always-on-top', (_e, onTop: boolean) => {
    mainWindow?.setAlwaysOnTop(onTop, onTop ? 'floating' : 'normal');
    return onTop;
  });

  // 关闭
  ipcMain.handle('close-window', () => {
    mainWindow?.close();
  });

  // 最小化
  ipcMain.handle('minimize-window', () => {
    mainWindow?.minimize();
  });

  // 强制激活(透明窗口有时需要)
  ipcMain.handle('focus-window', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  // 手动开始拖动窗口 —— CSS -webkit-app-region: drag 在透明窗口上有时不灵,这里手动调
  ipcMain.handle('start-drag', () => {
    try {
      (mainWindow as (BrowserWindow & { startDragging?: () => void }) | null)?.startDragging?.();
    } catch (e) {
      // 某些情况下 startDragging 抛错,忽略
    }
  });

  ipcMain.handle('toggle-bookmark', async (_event, page: unknown) => {
    if (!page || typeof page !== 'object') throw new Error('Invalid bookmark page.');
    const { url, title } = page as { url?: unknown; title?: unknown };
    if (typeof url !== 'string') throw new Error('Invalid bookmark URL.');

    const bookmarked = await bookmarks.toggle(url, typeof title === 'string' ? title : '');
    refreshApplicationMenu();
    return bookmarked;
  });
}

// ---------- App 生命周期 ----------
app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.tan.opabrow');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  bookmarkStore = new BookmarkStore(join(app.getPath('userData'), 'bookmarks.json'));
  await bookmarkStore.load();

  mainWindow = createMainWindow();
  registerIpc(bookmarkStore);

  refreshApplicationMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      refreshApplicationMenu();
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
