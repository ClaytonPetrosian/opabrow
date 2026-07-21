import { clipboard, contextBridge, ipcRenderer } from 'electron';

// 类型导出给 renderer
export type MenuAction =
  | 'go_url'
  | 'reload'
  | 'home'
  | 'set_home'
  | 'reset_home'
  | 'bookmark_toggle'
  | 'bookmark_open'
  | 'password_fill'
  | 'go_back'
  | 'go_forward'
  | 'ontop_toggle'
  | 'mobile_mode_toggle'
  | 'show_opacity_dialog'
  | 'opacity_inc'
  | 'opacity_dec'
  | 'show_quickbar'
  | 'show_history'
  | 'history_open'
  | 'history_clear'
  | 'show_find'
  | 'find_next'
  | 'find_previous'
  | 'show_downloads';

export type PasswordMatch = {
  id: string;
  origin: string;
  username: string;
};

export type PasswordToFill = PasswordMatch & {
  password: string;
};

export type HistoryEntry = {
  url: string;
  title: string;
  visitedAt: number;
};

export type DownloadEntry = {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  state: 'progressing' | 'completed' | 'failed';
  createdAt: number;
};

export type SavedSession = {
  url: string | null;
  opacity: number;
  alwaysOnTop: boolean;
  clickThrough?: boolean;
  mobileMode: boolean;
};

const api = {
  // 窗口控制
  setOpacity: (opacity: number) => ipcRenderer.invoke('set-opacity', opacity),
  setAlwaysOnTop: (onTop: boolean) => ipcRenderer.invoke('set-always-on-top', onTop),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  startDrag: () => ipcRenderer.invoke('start-drag'),

  // 地址栏使用主进程剪贴板，避免透明无边框窗口下 macOS 原生粘贴失效。
  readClipboardText: () => clipboard.readText(),
  writeClipboardText: (text: string) => clipboard.writeText(text),
  toggleBookmark: (page: { url: string; title: string }) => ipcRenderer.invoke('toggle-bookmark', page),
  syncHistory: (entries: HistoryEntry[]) => ipcRenderer.invoke('sync-history', entries),
  clearHistory: (): Promise<boolean> => ipcRenderer.invoke('clear-history'),
  getSession: (): Promise<SavedSession | null> => ipcRenderer.invoke('get-session'),
  saveSession: (session: SavedSession) => ipcRenderer.invoke('save-session', session),
  getDownloads: (): Promise<DownloadEntry[]> => ipcRenderer.invoke('get-downloads'),
  showDownloadInFolder: (id: string): Promise<boolean> => ipcRenderer.invoke('show-download-in-folder', id),
  listPasswordMatches: (url: string): Promise<PasswordMatch[]> => ipcRenderer.invoke('list-password-matches', url),
  getPasswordForFill: (request: { id: string; url: string }): Promise<PasswordToFill | null> =>
    ipcRenderer.invoke('get-password-for-fill', request),

  // 菜单事件订阅
  onMenuAction: (callback: (action: MenuAction, value?: boolean | string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, action: MenuAction, value?: boolean | string) => callback(action, value);
    ipcRenderer.on('menu-action', handler);
    // 返回 unsubscribe(包成 void 兼容 React useEffect Destructor)
    return (): void => {
      ipcRenderer.removeListener('menu-action', handler);
    };
  },

  // webview 跳转请求(由 main 进程在 setWindowOpenHandler 触发)
  onNavigateIframe: (callback: (url: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('navigate-iframe', handler);
    return (): void => {
      ipcRenderer.removeListener('navigate-iframe', handler);
    };
  },

  // 标题栏 hover 状态(由 main process 根据屏幕坐标判断)
  onTitlebarVisibility: (callback: (visible: boolean) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, visible: boolean) => callback(visible);
    ipcRenderer.on('titlebar-visibility', handler);
    return (): void => {
      ipcRenderer.removeListener('titlebar-visibility', handler);
    };
  },

  onDownloadUpdate: (callback: (entry: DownloadEntry) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, entry: DownloadEntry) => callback(entry);
    ipcRenderer.on('download-update', handler);
    return (): void => {
      ipcRenderer.removeListener('download-update', handler);
    };
  },

  // ---------- WebContentsView 控制 ----------
  // 取代 <webview> tag,所有操作通过 IPC 转发到 main 进程持有的 WebContentsView。
  webview: {
    loadURL: (url: string): Promise<boolean> => ipcRenderer.invoke('webview:load-url', url),
    reload: (): Promise<void> => ipcRenderer.invoke('webview:reload'),
    goBack: (): Promise<void> => ipcRenderer.invoke('webview:go-back'),
    goForward: (): Promise<void> => ipcRenderer.invoke('webview:go-forward'),
    getURL: (): Promise<string> => ipcRenderer.invoke('webview:get-url'),
    getTitle: (): Promise<string> => ipcRenderer.invoke('webview:get-title'),
    setUserAgent: (userAgent: string): Promise<void> => ipcRenderer.invoke('webview:set-user-agent', userAgent),
    findInPage: (query: string, options?: Electron.FindInPageOptions): Promise<void> =>
      ipcRenderer.invoke('webview:find-in-page', query, options),
    stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection'): Promise<void> =>
      ipcRenderer.invoke('webview:stop-find-in-page', action),
    executeJavaScript: (script: string): Promise<unknown> =>
      ipcRenderer.invoke('webview:execute-javascript', script),

    // 事件订阅(由 main 进程的 webContents 事件转发)
    onDomReady: (callback: () => void) => {
      const handler = (): void => callback();
      ipcRenderer.on('webview:dom-ready', handler);
      return (): void => {
        ipcRenderer.removeListener('webview:dom-ready', handler);
      };
    },
    onDidNavigate: (callback: (url: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, url: string): void => callback(url);
      ipcRenderer.on('webview:did-navigate', handler);
      return (): void => {
        ipcRenderer.removeListener('webview:did-navigate', handler);
      };
    },
    onDidNavigateInPage: (callback: (url: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, url: string): void => callback(url);
      ipcRenderer.on('webview:did-navigate-in-page', handler);
      return (): void => {
        ipcRenderer.removeListener('webview:did-navigate-in-page', handler);
      };
    },
    onPageTitleUpdated: (callback: (title: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, title: string): void => callback(title);
      ipcRenderer.on('webview:page-title-updated', handler);
      return (): void => {
        ipcRenderer.removeListener('webview:page-title-updated', handler);
      };
    },
    onFoundInPage: (callback: (result: Electron.FoundInPageResult) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, result: Electron.FoundInPageResult): void => callback(result);
      ipcRenderer.on('webview:found-in-page', handler);
      return (): void => {
        ipcRenderer.removeListener('webview:found-in-page', handler);
      };
    },
    onDidFinishLoad: (callback: () => void) => {
      const handler = (): void => callback();
      ipcRenderer.on('webview:did-finish-load', handler);
      return (): void => {
        ipcRenderer.removeListener('webview:did-finish-load', handler);
      };
    }
  }
};

contextBridge.exposeInMainWorld('opabrow', api);

export type OpabrowAPI = typeof api;
