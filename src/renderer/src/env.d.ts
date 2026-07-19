import type { OpabrowAPI } from '../../preload';

declare global {
  interface Window {
    opabrow: OpabrowAPI;
  }
}

// Electron <webview> tag 的类型 —— webview 是 Electron 专有的 HTML 元素
declare namespace Electron {
  interface WebviewTag extends HTMLElement {
    src: string;
    goBack(): void;
    goForward(): void;
    reload(): void;
    canGoBack(): boolean;
    canGoForward(): boolean;
    stop(): void;
    clearHistory(): void;
    openDevTools(): void;
    partition: string;
    allowpopups: boolean;
    useragent: string;
    setAttribute(qualifiedName: string, value: string): void;
  }
}

export {};
