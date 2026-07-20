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
  | 'history_clear';

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
  }
};

contextBridge.exposeInMainWorld('opabrow', api);

export type OpabrowAPI = typeof api;
