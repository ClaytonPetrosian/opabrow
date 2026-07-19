import { contextBridge, ipcRenderer } from 'electron';

// 类型导出给 renderer
export type MenuAction =
  | 'go_url'
  | 'reload'
  | 'home'
  | 'go_back'
  | 'go_forward'
  | 'ontop_toggle'
  | 'opacity_inc'
  | 'opacity_dec'
  | 'show_quickbar';

const api = {
  // 窗口控制
  setOpacity: (opacity: number) => ipcRenderer.invoke('set-opacity', opacity),
  setAlwaysOnTop: (onTop: boolean) => ipcRenderer.invoke('set-always-on-top', onTop),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  startDrag: () => ipcRenderer.invoke('start-drag'),

  // 菜单事件订阅
  onMenuAction: (callback: (action: MenuAction) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, action: MenuAction) => callback(action);
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
