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
    getURL(): string;
    getTitle(): string;
    executeJavaScript(code: string): Promise<unknown>;
    canGoBack(): boolean;
    canGoForward(): boolean;
    findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): number;
    stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void;
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
