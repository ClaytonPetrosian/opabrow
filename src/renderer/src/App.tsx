import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Clock3, Download, FolderOpen, Minus, Pin, Search, Trash2, X } from 'lucide-react';

const DEFAULT_HOME_URL = 'https://github.com/ClaytonPetrosian/opabrow';
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 opabrow/0.1';
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const HISTORY_STORAGE_KEY = 'opabrow.navigation-history.v2';
const HOME_URL_STORAGE_KEY = 'opabrow.home-url';
const HISTORY_LIMIT = 100;
const ADDRESS_SUGGESTION_LIMIT = 5;

type HistoryEntry = {
  url: string;
  title: string;
  visitedAt: number;
};

type PasswordMatch = {
  id: string;
  origin: string;
  username: string;
};

type DownloadEntry = {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  state: 'progressing' | 'completed' | 'failed';
  createdAt: number;
};

function readHistory(): HistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!stored) return [];

    const entries = JSON.parse(stored) as unknown;
    if (!Array.isArray(entries)) return [];

    return entries.filter(
      (entry): entry is HistoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.url === 'string' &&
        typeof entry.title === 'string' &&
        typeof entry.visitedAt === 'number'
    );
  } catch {
    return [];
  }
}

function readHomeUrl(): string {
  try {
    const stored = localStorage.getItem(HOME_URL_STORAGE_KEY);
    return stored && /^https?:\/\//i.test(stored) ? stored : DEFAULT_HOME_URL;
  } catch {
    return DEFAULT_HOME_URL;
  }
}

function isBilibiliVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.hostname === 'www.bilibili.com' || url.hostname === 'bilibili.com') &&
      (/^\/video\//.test(url.pathname) || /^\/bangumi\/play\//.test(url.pathname))
    );
  } catch {
    return false;
  }
}

// B 站播放器异步挂载，轮询其“网页全屏”控件，成功后立即停止。
const BILIBILI_WEB_FULLSCREEN_SCRIPT = `
  new Promise((resolve) => {
    let attempts = 0;
    const finish = (changed) => {
      window.clearInterval(timer);
      resolve(changed);
    };
    const timer = window.setInterval(() => {
      if (document.querySelector('.bpx-player-web-full')) {
        finish(false);
        return;
      }

      const button = document.querySelector('.bpx-player-ctrl-web');
      if (button instanceof HTMLElement) {
        button.click();
        finish(true);
        return;
      }

      attempts += 1;
      if (attempts >= 32) finish(false);
    }, 250);
  });
`;

function passwordFillScript(username: string, password: string): string {
  return `(() => {
    const username = ${JSON.stringify(username)};
    const password = ${JSON.stringify(password)};
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    };
    const setValue = (element, value) => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const inputs = Array.from(document.querySelectorAll('input:not([disabled]), textarea:not([disabled])')).filter(visible);
    const passwordInput = inputs.find((element) => element instanceof HTMLInputElement && element.type === 'password');
    if (!passwordInput) return { filled: false, reason: 'password-field-not-found' };
    const usernameInput = inputs.find((element) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
      if (element === passwordInput) return false;
      const descriptor = [element.name, element.id, element.autocomplete, element.type].join(' ').toLowerCase();
      return element.autocomplete === 'username' || /user|email|login|account|phone/.test(descriptor);
    });
    if (usernameInput && username) setValue(usernameInput, username);
    setValue(passwordInput, password);
    return { filled: true, usernameFilled: Boolean(usernameInput && username) };
  })()`;
}

function formatHistoryUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function formatHistoryTime(visitedAt: number): string {
  const date = new Date(visitedAt);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function App() {
  const [homeUrl, setHomeUrl] = useState(readHomeUrl);
  const [url, setUrl] = useState(readHomeUrl);
  const [currentUrl, setCurrentUrl] = useState(readHomeUrl);
  const [showQuickBar, setShowQuickBar] = useState(false);
  const [opacity, setOpacity] = useState(1.0);
  const [onTop, setOnTop] = useState(false);
  const [mobileMode, setMobileMode] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [showOpacityDialog, setShowOpacityDialog] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState({ matches: 0, activeMatchOrdinal: 0 });
  const [historyQuery, setHistoryQuery] = useState('');
  const [titlebarVisible, setTitlebarVisible] = useState(false);
  const [titlebarHoveredByDom, setTitlebarHoveredByDom] = useState(false);
  const [titlebarHoveredByMain, setTitlebarHoveredByMain] = useState<boolean | null>(null);
  const [addressBarFocused, setAddressBarFocused] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(readHistory);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [passwordMatches, setPasswordMatches] = useState<PasswordMatch[] | null>(null);
  const [passwordFillUrl, setPasswordFillUrl] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const webviewReadyRef = useRef(false);
  const webviewContainerRef = useRef<HTMLDivElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const historyInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const homeUrlRef = useRef(homeUrl);
  const findQueryRef = useRef(findQuery);
  const mobileModeRef = useRef(mobileMode);

  // 标题栏可见性合并:
  // - 置顶模式: 由 main 进程屏幕坐标轮询决定 (titlebarHoveredByMain)
  // - 非置顶: 由 DOM mouseenter/leave 决定 (titlebarHoveredByDom)
  // addressBarFocused 时强制可见。
  useEffect(() => {
    if (addressBarFocused) {
      setTitlebarVisible(true);
      return;
    }
    if (onTop) {
      setTitlebarVisible(titlebarHoveredByMain === true);
    } else {
      setTitlebarVisible(titlebarHoveredByDom);
    }
  }, [addressBarFocused, onTop, titlebarHoveredByMain, titlebarHoveredByDom]);

  const loadInWebview = (targetUrl: string) => {
    const wv = webviewRef.current;
    if (!wv) return;

    // dom-ready 之前调用 loadURL 会直接抛错;初始导航交给 src 属性。
    if (!webviewReadyRef.current) {
      wv.src = targetUrl;
      return;
    }

    try {
      if (wv.getURL() === targetUrl) return;
      void wv.loadURL(targetUrl).catch((error) => {
        console.warn('webview navigation failed:', error);
      });
    } catch (error) {
      console.warn('webview navigation failed:', error);
    }
  };

  // 透明度变化 → main process
  useEffect(() => {
    if (!sessionReady) return;
    window.opabrow.setOpacity(opacity);
  }, [opacity, sessionReady]);

  // 置顶状态变化 → main process
  useEffect(() => {
    if (!sessionReady) return;
    window.opabrow.setAlwaysOnTop(onTop);
  }, [onTop, sessionReady]);

  // 只从本机主进程恢复会话，不接受网页内容传入的状态。
  useEffect(() => {
    let cancelled = false;
    void Promise.all([window.opabrow.getSession(), window.opabrow.getDownloads()]).then(([saved, storedDownloads]) => {
      if (cancelled) return;
      if (saved) {
        if (saved.url) {
          setCurrentUrl(saved.url);
          setUrl(saved.url);
        }
        setOpacity(saved.opacity);
        setOnTop(saved.alwaysOnTop);
        setMobileMode(saved.mobileMode);
      }
      setDownloads(storedDownloads);
      setSessionReady(true);
    }).catch((error) => {
      console.warn('session restore failed:', error);
      if (!cancelled) setSessionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    void window.opabrow.saveSession({
      url: currentUrl,
      opacity,
      alwaysOnTop: onTop,
      mobileMode
    }).catch((error) => console.warn('session save failed:', error));
  }, [currentUrl, mobileMode, onTop, opacity, sessionReady]);

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(historyEntries));
    void window.opabrow.syncHistory(historyEntries).catch((error) => {
      console.warn('history menu sync failed:', error);
    });
  }, [historyEntries]);

  useEffect(() => {
    if (!showHistory) return;
    window.setTimeout(() => historyInputRef.current?.focus(), 0);
  }, [showHistory]);

  useEffect(() => {
    if (!showFind) return;
    window.setTimeout(() => findInputRef.current?.focus(), 0);
  }, [showFind]);

  useEffect(() => {
    findQueryRef.current = findQuery;
    if (!showFind) return;
    const webview = webviewRef.current;
    if (!webview) return;
    const query = findQuery.trim();
    if (!query) {
      webview.stopFindInPage('clearSelection');
      setFindResult({ matches: 0, activeMatchOrdinal: 0 });
      return;
    }
    webview.findInPage(query, { forward: true, findNext: false, matchCase: false });
  }, [findQuery, showFind]);

  useEffect(() => {
    homeUrlRef.current = homeUrl;
    localStorage.setItem(HOME_URL_STORAGE_KEY, homeUrl);
  }, [homeUrl]);

  useEffect(() => {
    mobileModeRef.current = mobileMode;
  }, [mobileMode]);

  // 挂载 webview (动态创建,绕过 React 编译对 <webview> tag 的处理)
  useEffect(() => {
    const container = webviewContainerRef.current;
    if (!container) return;

    const wv = document.createElement('webview') as Electron.WebviewTag;
    // webview 尚未就绪时调用 setUserAgent 会让初始导航停在 about:blank。
    // 首次加载改用声明式属性；切换手机模式时再在 dom-ready 后调用方法。
    wv.setAttribute('useragent', DESKTOP_USER_AGENT);
    wv.src = currentUrl;
    wv.className = 'webview';
    // webview 独占标题栏下方的网页区域,不进入顶部 32px 标题栏。
    wv.style.cssText = 'border:0;display:flex;background:#fff;';
    // 建议性阻止新窗口
    wv.setAttribute('allowpopups', 'false');

    // webview guest 不会可靠地响应 CSS 的 100% 高度,未显式设尺寸时会回落到 150px。
    // 用容器的实际像素尺寸同步给它,保证窗口缩放后网页视口同步更新。
    const resizeWebview = () => {
      const { width, height } = container.getBoundingClientRect();
      const pixelWidth = Math.floor(width);
      const pixelHeight = Math.floor(height);
      if (pixelWidth < 1 || pixelHeight < 1) return;
      wv.style.width = `${pixelWidth}px`;
      wv.style.height = `${pixelHeight}px`;
      wv.setAttribute('width', String(pixelWidth));
      wv.setAttribute('height', String(pixelHeight));
    };
    const resizeObserver = new ResizeObserver(resizeWebview);

    // target=_blank 拦截在 main 进程的 app.on('web-contents-created') 里完成。
    // renderer 只负责把实际导航结果同步回 quick bar。
    const onDomReady = () => {
      webviewReadyRef.current = true;
      if (mobileModeRef.current) {
        try {
          wv.setUserAgent(MOBILE_USER_AGENT);
          wv.reload();
        } catch (error) {
          console.warn('webview user agent restore failed:', error);
        }
      }
    };
    wv.addEventListener('dom-ready', onDomReady);

    const syncUrl = (e: Event) => {
      const next = (e as unknown as { url?: string }).url;
      if (!next) return;
      setCurrentUrl(next);
      setUrl(next);
      recordHistory(next);
    };
    wv.addEventListener('did-navigate', syncUrl);
    wv.addEventListener('did-navigate-in-page', syncUrl);

    const syncTitle = (e: Event) => {
      const title = (e as unknown as { title?: string }).title;
      const pageUrl = wv.getURL();
      if (title && pageUrl) recordHistory(pageUrl, title);
    };
    wv.addEventListener('page-title-updated', syncTitle);

    const syncFindResult = (e: Event) => {
      const result = (e as unknown as {
        result?: { matches?: number; activeMatchOrdinal?: number; finalUpdate?: boolean };
      }).result;
      if (!result?.finalUpdate) return;
      setFindResult({
        matches: result.matches ?? 0,
        activeMatchOrdinal: result.activeMatchOrdinal ?? 0
      });
    };
    wv.addEventListener('found-in-page', syncFindResult);

    const enterBilibiliWebFullscreen = () => {
      const pageUrl = wv.getURL();
      if (!isBilibiliVideoUrl(pageUrl)) return;
      void wv.executeJavaScript(BILIBILI_WEB_FULLSCREEN_SCRIPT).catch((error) => {
        console.warn('Bilibili web fullscreen failed:', error);
      });
    };
    wv.addEventListener('did-finish-load', enterBilibiliWebFullscreen);

    // 兜底:new-window 事件也拦一次
    wv.addEventListener('new-window', (e) => {
      e.preventDefault();
      const target = (e as unknown as { url?: string }).url;
      if (target) {
        try {
          void wv.loadURL(target).catch((error) => {
            console.warn('webview new-window navigation failed:', error);
          });
        } catch (error) {
          console.warn('webview new-window navigation failed:', error);
        }
        setCurrentUrl(target);
        setUrl(target);
      }
    });

    // webview guest 在 appendChild 时读取初始尺寸;必须在挂载前就写入，
    // 否则会永久沿用 Chromium 的默认 150px 高度。
    requestAnimationFrame(resizeWebview);
    resizeWebview();
    container.appendChild(wv);
    webviewRef.current = wv;
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      wv.removeEventListener('dom-ready', onDomReady);
      wv.removeEventListener('page-title-updated', syncTitle);
      wv.removeEventListener('found-in-page', syncFindResult);
      wv.removeEventListener('did-finish-load', enterBilibiliWebFullscreen);
      wv.remove();
      webviewRef.current = null;
      webviewReadyRef.current = false;
    };
    // 只挂载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL 变化时 → 改 webview.src
  useEffect(() => {
    if (webviewRef.current) {
      loadInWebview(currentUrl);
    }
  }, [currentUrl]);

  // 手机模式通过切换 webview 的浏览器标识实现，并重新载入当前页面让网站按移动端返回内容。
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !sessionReady || !webviewReadyRef.current) return;

    try {
      wv.setUserAgent(mobileMode ? MOBILE_USER_AGENT : DESKTOP_USER_AGENT);
      if (webviewReadyRef.current) wv.reload();
    } catch (error) {
      console.warn('webview user agent update failed:', error);
    }
  }, [mobileMode, sessionReady]);

  // 菜单事件订阅
  useEffect(() => {
    const off = window.opabrow.onMenuAction((action, value) => {
      switch (action) {
        case 'go_url':
          focusAddressBar();
          break;
        case 'show_quickbar':
          setShowQuickBar(true);
          setTimeout(() => quickInputRef.current?.focus(), 50);
          break;
        case 'show_find':
          openFind();
          break;
        case 'find_next':
          findNext(true);
          break;
        case 'find_previous':
          findNext(false);
          break;
        case 'reload':
          reload();
          break;
        case 'home':
          goUrl(homeUrlRef.current);
          break;
        case 'set_home': {
          const pageUrl = webviewRef.current?.getURL() || currentUrl;
          if (/^https?:\/\//i.test(pageUrl)) setHomeUrl(pageUrl);
          break;
        }
        case 'reset_home':
          setHomeUrl(DEFAULT_HOME_URL);
          break;
        case 'bookmark_toggle': {
          const webview = webviewRef.current;
          const pageUrl = webview?.getURL() || currentUrl;
          const pageTitle = webview?.getTitle() || pageUrl;
          void window.opabrow.toggleBookmark({ url: pageUrl, title: pageTitle }).catch((error) => {
            console.warn('bookmark toggle failed:', error);
          });
          break;
        }
        case 'bookmark_open':
          if (typeof value === 'string') goUrl(value);
          break;
        case 'password_fill':
          void requestPasswordFill();
          break;
        case 'go_back':
          try {
            webviewRef.current?.goBack();
          } catch (e) {
            console.warn('goBack failed:', e);
          }
          break;
        case 'go_forward':
          try {
            webviewRef.current?.goForward();
          } catch (e) {
            console.warn('goForward failed:', e);
          }
          break;
        case 'ontop_toggle':
          setOnTop((v) => !v);
          break;
        case 'mobile_mode_toggle':
          setMobileMode(value === true);
          break;
        case 'show_opacity_dialog':
          setShowOpacityDialog(true);
          break;
        case 'show_history':
          setHistoryQuery('');
          setShowHistory(true);
          break;
        case 'show_downloads':
          setShowDownloads(true);
          break;
        case 'history_open':
          if (typeof value === 'string') goUrl(value);
          break;
        case 'history_clear':
          setHistoryEntries([]);
          setHistoryQuery('');
          setShowHistory(false);
          break;
        case 'opacity_inc':
          setOpacity((o) => Math.min(1, Math.round((o + 0.1) * 100) / 100));
          break;
        case 'opacity_dec':
          setOpacity((o) => Math.max(0.1, Math.round((o - 0.1) * 100) / 100));
          break;
      }
    });
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ESC 关闭临时面板
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (passwordMatches) setPasswordMatches(null);
        else if (showFind) closeFind();
        else if (showDownloads) setShowDownloads(false);
        else if (showHistory) setShowHistory(false);
        else if (showOpacityDialog) setShowOpacityDialog(false);
        else if (showQuickBar) setShowQuickBar(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [passwordMatches, showDownloads, showFind, showHistory, showOpacityDialog, showQuickBar]);

  useEffect(() => {
    const off = window.opabrow.onDownloadUpdate((entry) => {
      setDownloads((items) => [entry, ...items.filter((item) => item.id !== entry.id)]);
      if (entry.state === 'completed') showDownloadStatus(`下载完成：${entry.filename}`);
      if (entry.state === 'failed') showDownloadStatus(`下载失败：${entry.filename}`);
    });
    return off;
  }, []);

  // 监听 main 进程发来的 "iframe 跳转" 请求
  useEffect(() => {
    const off = window.opabrow.onNavigateIframe((u) => {
      setCurrentUrl(u);
      setUrl(u);
    });
    return off;
  }, []);

  // 标题栏显示控制:
  // - 非置顶模式: webview DOM mousemove 能正常触发,用 onMouseEnter/Leave 自己管
  // - 置顶 + 点击穿透模式: setIgnoreMouseEvents 让 DOM 收不到 mousemove,
  //   由 main process 通过屏幕坐标轮询后发 titlebar-visibility IPC 接管
  useEffect(() => {
    let hideTimer: number | null = null;
    const off = window.opabrow.onTitlebarVisibility((visible) => {
      setTitlebarHoveredByMain(visible);
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }

      if (!visible) {
        hideTimer = window.setTimeout(() => {
          setTitlebarHoveredByMain(false);
          hideTimer = null;
        }, 280);
      }
    });

    return () => {
      off();
      if (hideTimer !== null) window.clearTimeout(hideTimer);
    };
  }, []);

  // 备份:⌘L / ⌘+[ / ⌘+] 在 renderer 内也能响应
  // webview 焦点时键盘事件全进 webview,renderer 收不到 keydown,所以主路径走菜单 accelerator
  // 但这里保留 keydown 监听作为兜底(比如 webview 未 focus 时的菜单栏使用)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const active = document.activeElement;
      const editing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (editing) return;

      // ⌘+[ 后退
      if (e.key === '[' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        try {
          webviewRef.current?.goBack();
        } catch (err) {
          console.warn('goBack failed:', err);
        }
        return;
      }
      // ⌘+] 前进
      if (e.key === ']' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        try {
          webviewRef.current?.goForward();
        } catch (err) {
          console.warn('goForward failed:', err);
        }
        return;
      }
      // ⌘R 刷新
      if (e.key.toLowerCase() === 'r' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        reload();
        return;
      }
      // ⌘T 置顶
      if (e.key.toLowerCase() === 't' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOnTop((v) => !v);
        return;
      }
      // ⌘= / ⌘- 透明度
      if ((e.key === '=' || e.key === '+') && !e.altKey) {
        e.preventDefault();
        setOpacity((o) => Math.min(1, Math.round((o + 0.1) * 100) / 100));
        return;
      }
      if (e.key === '-' && !e.altKey) {
        e.preventDefault();
        setOpacity((o) => Math.max(0.1, Math.round((o - 0.1) * 100) / 100));
        return;
      }
      // ⌘⇧H 回到主页
      if (e.key.toLowerCase() === 'h' && e.shiftKey && !e.altKey) {
        e.preventDefault();
        void goUrl(homeUrlRef.current);
        return;
      }
      // ⌘L
      if (e.key === 'l' && !e.shiftKey) {
        e.preventDefault();
        focusAddressBar();
        return;
      }
      // ⌘F / ⌘G 页面内查找
      if (e.key.toLowerCase() === 'f' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        openFind();
        return;
      }
      if (e.key.toLowerCase() === 'g' && !e.altKey) {
        e.preventDefault();
        findNext(!e.shiftKey);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---------- 操作函数 ----------
  function normalize(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return currentUrl;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmed)) return 'https://' + trimmed;
    return 'https://www.bing.com/search?q=' + encodeURIComponent(trimmed);
  }

  async function goUrl(target?: string) {
    const next = normalize(target ?? url);
    setUrl(next);
    setCurrentUrl(next);
    setShowQuickBar(false);
    setShowHistory(false);
    closeFind();
    setAddressBarFocused(false);
    setActiveSuggestionIndex(-1);
    addressInputRef.current?.blur();
  }

  function focusAddressBar() {
    setAddressBarFocused(true);
    setActiveSuggestionIndex(-1);
    window.setTimeout(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    }, 0);
  }

  function reload() {
    try {
      webviewRef.current?.reload();
    } catch (e) {
      console.warn('reload failed:', e);
    }
  }

  function openFind() {
    setShowFind(true);
    window.setTimeout(() => findInputRef.current?.select(), 0);
  }

  function closeFind() {
    webviewRef.current?.stopFindInPage('clearSelection');
    setShowFind(false);
    setFindQuery('');
    setFindResult({ matches: 0, activeMatchOrdinal: 0 });
  }

  function findNext(forward: boolean) {
    const query = findQueryRef.current.trim();
    if (!query) {
      openFind();
      return;
    }
    webviewRef.current?.findInPage(query, { forward, findNext: true, matchCase: false });
  }

  function showPasswordStatus(message: string) {
    setPasswordStatus(message);
    window.setTimeout(() => {
      setPasswordStatus((current) => (current === message ? null : current));
    }, 3_500);
  }

  function showDownloadStatus(message: string) {
    setDownloadStatus(message);
    window.setTimeout(() => {
      setDownloadStatus((current) => (current === message ? null : current));
    }, 4_000);
  }

  async function requestPasswordFill() {
    const pageUrl = webviewRef.current?.getURL() || currentUrl;
    const matches = await window.opabrow.listPasswordMatches(pageUrl);
    if (matches.length === 0) {
      showPasswordStatus('此 HTTPS 页面没有可用的已保存密码。');
      return;
    }

    if (matches.length === 1) {
      await fillPassword(matches[0], pageUrl);
      return;
    }

    setPasswordFillUrl(pageUrl);
    setPasswordMatches(matches);
  }

  async function fillPassword(match: PasswordMatch, pageUrl: string) {
    try {
      const credential = await window.opabrow.getPasswordForFill({ id: match.id, url: pageUrl });
      if (!credential) {
        showPasswordStatus('该密码不再匹配当前页面。');
        return;
      }

      const webview = webviewRef.current;
      if (!webview || webview.getURL() !== pageUrl) {
        showPasswordStatus('页面已变化，请重新选择“填充当前页面”。');
        return;
      }

      const result = (await webview.executeJavaScript(passwordFillScript(credential.username, credential.password))) as {
        filled?: boolean;
      };
      showPasswordStatus(result?.filled ? '已填充当前页面的登录信息。' : '没有找到可填充的密码输入框。');
    } catch {
      showPasswordStatus('无法填充该页面，请确认 macOS 钥匙串可用。');
    } finally {
      setPasswordMatches(null);
    }
  }

  function recordHistory(nextUrl: string, title?: string) {
    if (!/^https?:\/\//i.test(nextUrl)) return;

    setHistoryEntries((entries) => {
      const previous = entries.find((entry) => entry.url === nextUrl);
      return [
        {
          url: nextUrl,
          title: title?.trim() || previous?.title || formatHistoryUrl(nextUrl),
          visitedAt: Date.now()
        },
        ...entries.filter((entry) => entry.url !== nextUrl)
      ].slice(0, HISTORY_LIMIT);
    });
  }

  function replaceAddressSelection(input: HTMLInputElement, text: string) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const caret = start + text.length;

    setUrl((value) => `${value.slice(0, start)}${text}${value.slice(end)}`);
    setActiveSuggestionIndex(-1);
    requestAnimationFrame(() => input.setSelectionRange(caret, caret));
  }

  function handleAddressClipboardShortcut(event: ReactKeyboardEvent<HTMLInputElement>): boolean {
    const isModifier = event.metaKey || event.ctrlKey;
    if (!isModifier || event.altKey || event.shiftKey) return false;

    const input = event.currentTarget;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    const selection = input.value.slice(start, end);

    if (event.key.toLowerCase() === 'c') {
      event.preventDefault();
      window.opabrow.writeClipboardText(selection);
      return true;
    }

    if (event.key.toLowerCase() === 'x') {
      event.preventDefault();
      window.opabrow.writeClipboardText(selection);
      replaceAddressSelection(input, '');
      return true;
    }

    if (event.key.toLowerCase() === 'v') {
      event.preventDefault();
      const pasteStart = start;
      const pasteEnd = end;
      void Promise.resolve(window.opabrow.readClipboardText()).then((text) => {
        if (!text) return;
        const caret = pasteStart + text.length;
        setUrl((value) => `${value.slice(0, pasteStart)}${text}${value.slice(pasteEnd)}`);
        setActiveSuggestionIndex(-1);
        requestAnimationFrame(() => input.setSelectionRange(caret, caret));
      });
      return true;
    }

    return false;
  }

  const addressQuery = url.trim().toLowerCase();
  const addressSuggestions = addressBarFocused
    ? historyEntries
        .filter(
          (entry) =>
            !addressQuery ||
            entry.title.toLowerCase().includes(addressQuery) ||
            entry.url.toLowerCase().includes(addressQuery)
        )
        .slice(0, ADDRESS_SUGGESTION_LIMIT)
    : [];
  const historySearch = historyQuery.trim().toLowerCase();
  const visibleHistory = historyEntries.filter(
    (entry) =>
      !historySearch ||
      entry.title.toLowerCase().includes(historySearch) ||
      entry.url.toLowerCase().includes(historySearch)
  );

  return (
    <div className="app">
      {showQuickBar && (
        <div className="quick-bar">
          <div className="quick-row">
            <input
              ref={quickInputRef}
              className="quick-input"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') goUrl();
              }}
              placeholder="输入 URL 或搜索词,回车跳转"
              spellCheck={false}
            />
            <button className="quick-btn" onClick={() => goUrl()}>前往</button>
            <button className="quick-btn close" onClick={() => setShowQuickBar(false)} title="关闭 (ESC)">
              ✕
            </button>
          </div>

          <div className="quick-row">
            <button
              className={`quick-toggle ${onTop ? 'on' : ''}`}
              onClick={() => setOnTop((v) => !v)}
              title="切换置顶 (⌘T)"
            >
              {onTop ? '📌 已置顶' : '📍 未置顶'}
            </button>
          </div>
        </div>
      )}

      {showFind && (
        <div className="find-bar" role="search" aria-label="在页面中查找">
          <Search size={15} aria-hidden="true" />
          <input
            ref={findInputRef}
            type="search"
            value={findQuery}
            onChange={(event) => setFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                findNext(!event.shiftKey);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                closeFind();
              }
            }}
            placeholder="在页面中查找"
            aria-label="查找文本"
            spellCheck={false}
          />
          <output className="find-count" aria-live="polite">
            {findQuery.trim() ? `${findResult.activeMatchOrdinal || 0}/${findResult.matches}` : ''}
          </output>
          <button type="button" className="find-button" title="上一个匹配项 (⌘⇧G)" aria-label="上一个匹配项" onClick={() => findNext(false)}>
            <ChevronUp size={15} aria-hidden="true" />
          </button>
          <button type="button" className="find-button" title="下一个匹配项 (⌘G)" aria-label="下一个匹配项" onClick={() => findNext(true)}>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <button type="button" className="dialog-close" title="关闭 (ESC)" aria-label="关闭查找" onClick={closeFind}>×</button>
        </div>
      )}

      {showOpacityDialog && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => setShowOpacityDialog(false)}
        >
          <section
            className="opacity-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="opacity-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <h2 id="opacity-dialog-title">窗口透明度</h2>
              <button
                type="button"
                className="dialog-close"
                aria-label="关闭"
                title="关闭 (ESC)"
                onClick={() => setShowOpacityDialog(false)}
              >
                ×
              </button>
            </div>
            <div className="opacity-control">
              <input
                className="opacity-slider"
                aria-label="窗口透明度"
                type="range"
                min={0.1}
                max={1}
                step={0.01}
                value={opacity}
                onChange={(event) => setOpacity(parseFloat(event.target.value))}
              />
              <output>{Math.round(opacity * 100)}%</output>
            </div>
          </section>
        </div>
      )}

      {showHistory && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => setShowHistory(false)}
        >
          <section
            className="history-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <div className="history-heading-title">
                <Clock3 size={16} aria-hidden="true" />
                <h2 id="history-dialog-title">历史记录</h2>
              </div>
              <div className="history-dialog-actions">
                {historyEntries.length > 0 && (
                  <button
                    type="button"
                    className="dialog-icon-button"
                    aria-label="清空全部历史记录"
                    title="清空全部历史记录"
                    onClick={() => void window.opabrow.clearHistory()}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="dialog-close"
                  aria-label="关闭"
                  title="关闭 (ESC)"
                  onClick={() => setShowHistory(false)}
                >
                  ×
                </button>
              </div>
            </div>
            <label className="history-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={historyInputRef}
                type="search"
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="搜索历史记录"
                aria-label="搜索历史记录"
                spellCheck={false}
              />
            </label>
            <div className="history-list">
              {visibleHistory.length > 0 ? (
                visibleHistory.map((entry) => (
                  <button
                    key={entry.url}
                    type="button"
                    className="history-entry"
                    title={entry.url}
                    onClick={() => goUrl(entry.url)}
                  >
                    <span className="history-entry-main">
                      <span className="history-entry-title">{entry.title}</span>
                      <span className="history-entry-url">{formatHistoryUrl(entry.url)}</span>
                    </span>
                    <time dateTime={new Date(entry.visitedAt).toISOString()}>{formatHistoryTime(entry.visitedAt)}</time>
                  </button>
                ))
              ) : (
                <p className="history-empty">{historyEntries.length === 0 ? '还没有历史记录' : '没有匹配的历史记录'}</p>
              )}
            </div>
          </section>
        </div>
      )}

      {showDownloads && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowDownloads(false)}>
          <section
            className="downloads-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="downloads-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <div className="history-heading-title">
                <Download size={16} aria-hidden="true" />
                <h2 id="downloads-dialog-title">下载</h2>
              </div>
              <button type="button" className="dialog-close" aria-label="关闭" title="关闭 (ESC)" onClick={() => setShowDownloads(false)}>×</button>
            </div>
            <div className="downloads-list">
              {downloads.length > 0 ? (
                downloads.map((entry) => {
                  const progress = entry.totalBytes > 0 ? Math.min(100, (entry.receivedBytes / entry.totalBytes) * 100) : 0;
                  const status = entry.state === 'completed'
                    ? '已完成'
                    : entry.state === 'failed'
                      ? '下载失败'
                      : entry.totalBytes > 0
                        ? `${formatBytes(entry.receivedBytes)} / ${formatBytes(entry.totalBytes)}`
                        : `${formatBytes(entry.receivedBytes)} 已下载`;
                  return (
                    <div className="download-entry" key={entry.id}>
                      <div className="download-entry-main">
                        <span className="download-entry-title" title={entry.filename}>{entry.filename}</span>
                        <span className={`download-entry-status ${entry.state}`}>{status}</span>
                        {entry.state === 'progressing' && <span className="download-progress"><span style={{ width: `${progress}%` }} /></span>}
                      </div>
                      {entry.state === 'completed' && (
                        <button
                          type="button"
                          className="dialog-icon-button"
                          aria-label="在 Finder 中显示"
                          title="在 Finder 中显示"
                          onClick={() => void window.opabrow.showDownloadInFolder(entry.id)}
                        >
                          <FolderOpen size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="history-empty">还没有下载记录</p>
              )}
            </div>
          </section>
        </div>
      )}

      {passwordMatches && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => setPasswordMatches(null)}
        >
          <section
            className="password-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-picker-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-heading">
              <h2 id="password-picker-title">选择要填充的账号</h2>
              <button
                type="button"
                className="dialog-close"
                aria-label="关闭"
                title="关闭 (ESC)"
                onClick={() => setPasswordMatches(null)}
              >
                ×
              </button>
            </div>
            <p className="password-picker-origin">{new URL(passwordFillUrl).host}</p>
            <div className="password-picker-options">
              {passwordMatches.map((match) => (
                <button
                  key={match.id}
                  type="button"
                  className="password-picker-option"
                  onClick={() => void fillPassword(match, passwordFillUrl)}
                >
                  {match.username || '未命名账号'}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* 顶部 32px 独立标题栏:始终占位,默认透明,不覆盖网页区域。 */}
      <div
        className={`titlebar ${titlebarVisible || addressBarFocused ? 'visible' : ''}`}
        title="拖动窗口"
        onMouseEnter={() => setTitlebarHoveredByDom(true)}
        onMouseLeave={() => setTitlebarHoveredByDom(false)}
        onMouseDown={(e) => {
          e.preventDefault();
          window.opabrow.startDrag();
        }}
      >
        <div className="traffic-buttons">
          <button
            type="button"
            className="traffic-button close"
            aria-label="关闭窗口"
            title="关闭窗口 (⌘W)"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => window.opabrow.closeWindow()}
          >
            <X className="traffic-icon" size={9} strokeWidth={2.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="traffic-button minimize"
            aria-label="最小化窗口"
            title="最小化窗口 (⌘M)"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => window.opabrow.minimizeWindow()}
          >
            <Minus className="traffic-icon" size={10} strokeWidth={2.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`titlebar-icon-button ${onTop ? 'active' : ''}`}
            aria-label={onTop ? '取消置顶' : '置顶窗口'}
            aria-pressed={onTop}
            title={onTop ? '取消置顶 (⌘T)' : '置顶窗口 (⌘T)'}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setOnTop((value) => !value)}
          >
            <Pin size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="titlebar-address">
          {addressBarFocused ? (
            <input
              ref={addressInputRef}
              className="titlebar-address-input"
              type="text"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setActiveSuggestionIndex(-1);
              }}
              onFocus={() => {
                setAddressBarFocused(true);
                setActiveSuggestionIndex(-1);
              }}
              onBlur={() => {
                setAddressBarFocused(false);
                setActiveSuggestionIndex(-1);
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (handleAddressClipboardShortcut(event)) return;
                if (event.key === 'ArrowDown' && addressSuggestions.length > 0) {
                  event.preventDefault();
                  setActiveSuggestionIndex((index) => (index + 1) % addressSuggestions.length);
                  return;
                }
                if (event.key === 'ArrowUp' && addressSuggestions.length > 0) {
                  event.preventDefault();
                  setActiveSuggestionIndex((index) =>
                    index <= 0 ? addressSuggestions.length - 1 : index - 1
                  );
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const suggestion = addressSuggestions[activeSuggestionIndex];
                  goUrl(suggestion?.url);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setUrl(currentUrl);
                  event.currentTarget.blur();
                }
              }}
              aria-label="地址栏"
              placeholder="输入网址或搜索词"
              spellCheck={false}
            />
          ) : (
            <button
              type="button"
              className="titlebar-address-preview"
              title="编辑地址 (⌘L)"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={focusAddressBar}
            >
              {currentUrl}
            </button>
          )}
          {addressSuggestions.length > 0 && (
            <div className="address-suggestions" role="listbox" aria-label="历史记录">
              {addressSuggestions.map((entry, index) => (
                <button
                  key={entry.url}
                  type="button"
                  className={`address-suggestion ${index === activeSuggestionIndex ? 'active' : ''}`}
                  role="option"
                  aria-selected={index === activeSuggestionIndex}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={() => goUrl(entry.url)}
                >
                  <span className="address-suggestion-title">{entry.title}</span>
                  <span className="address-suggestion-url">{formatHistoryUrl(entry.url)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          className="titlebar-opacity"
          title="窗口透明度"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <input
            className="titlebar-opacity-slider"
            aria-label="窗口透明度"
            type="range"
            min={0.1}
            max={1}
            step={0.01}
            value={opacity}
            style={{
              background: `linear-gradient(90deg, #3b82f6 0%, #60a5fa ${opacity * 100}%, rgba(90, 103, 119, 0.18) ${opacity * 100}%, rgba(90, 103, 119, 0.18) 100%)`
            }}
            onChange={(event) => setOpacity(parseFloat(event.target.value))}
          />
          <output>{Math.round(opacity * 100)}%</output>
        </div>
      </div>

      {/* webview 容器:从标题栏下方开始,网页大小不受标题栏显隐影响。 */}
      <div className="webview-container" ref={webviewContainerRef} />
      {passwordStatus && <div className="password-status" role="status">{passwordStatus}</div>}
      {downloadStatus && <div className="password-status" role="status">{downloadStatus}</div>}
    </div>
  );
}

export default App;
