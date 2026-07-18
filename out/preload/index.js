"use strict";
const electron = require("electron");
const api = {
  // 窗口控制
  setOpacity: (opacity) => electron.ipcRenderer.invoke("set-opacity", opacity),
  setAlwaysOnTop: (onTop) => electron.ipcRenderer.invoke("set-always-on-top", onTop),
  closeWindow: () => electron.ipcRenderer.invoke("close-window"),
  minimizeWindow: () => electron.ipcRenderer.invoke("minimize-window"),
  zoomWindow: () => electron.ipcRenderer.invoke("zoom-window"),
  focusWindow: () => electron.ipcRenderer.invoke("focus-window"),
  startDrag: () => electron.ipcRenderer.invoke("start-drag"),
  getCursorPos: () => electron.ipcRenderer.invoke("get-cursor-pos"),
  // 菜单事件订阅
  onMenuAction: (callback) => {
    const handler = (_e, action) => callback(action);
    electron.ipcRenderer.on("menu-action", handler);
    return () => {
      electron.ipcRenderer.removeListener("menu-action", handler);
    };
  },
  // webview 跳转请求(由 main 进程在 setWindowOpenHandler 触发)
  onNavigateIframe: (callback) => {
    const handler = (_e, url) => callback(url);
    electron.ipcRenderer.on("navigate-iframe", handler);
    return () => {
      electron.ipcRenderer.removeListener("navigate-iframe", handler);
    };
  }
};
electron.contextBridge.exposeInMainWorld("opabrow", api);
