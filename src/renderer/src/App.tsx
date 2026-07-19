import { useEffect, useRef, useState } from 'react';

const HOME_URL = 'https://www.bilibili.com';

function App() {
  const [url, setUrl] = useState(HOME_URL);
  const [currentUrl, setCurrentUrl] = useState(HOME_URL);
  const [showQuickBar, setShowQuickBar] = useState(false);
  const [opacity, setOpacity] = useState(1.0);
  const [onTop, setOnTop] = useState(false);
  const [titlebarVisible, setTitlebarVisible] = useState(false);
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const webviewReadyRef = useRef(false);
  const webviewContainerRef = useRef<HTMLDivElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);

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
    window.opabrow.setOpacity(opacity);
  }, [opacity]);

  // 置顶状态变化 → main process
  useEffect(() => {
    window.opabrow.setAlwaysOnTop(onTop);
  }, [onTop]);

  // 挂载 webview (动态创建,绕过 React 编译对 <webview> tag 的处理)
  useEffect(() => {
    const container = webviewContainerRef.current;
    if (!container) return;

    const wv = document.createElement('webview') as Electron.WebviewTag;
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
    };
    wv.addEventListener('dom-ready', onDomReady);

    const syncUrl = (e: Event) => {
      const next = (e as unknown as { url?: string }).url;
      if (!next) return;
      setCurrentUrl(next);
      setUrl(next);
    };
    wv.addEventListener('did-navigate', syncUrl);
    wv.addEventListener('did-navigate-in-page', syncUrl);

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

  // 菜单事件订阅
  useEffect(() => {
    const off = window.opabrow.onMenuAction((action) => {
      switch (action) {
        case 'go_url':
        case 'show_quickbar':
          setShowQuickBar(true);
          setTimeout(() => quickInputRef.current?.focus(), 50);
          break;
        case 'reload':
          reload();
          break;
        case 'home':
          goUrl(HOME_URL);
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

  // ESC 关闭 quick bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showQuickBar) {
        setShowQuickBar(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showQuickBar]);

  // 监听 main 进程发来的 "iframe 跳转" 请求
  useEffect(() => {
    const off = window.opabrow.onNavigateIframe((u) => {
      setCurrentUrl(u);
      setUrl(u);
    });
    return off;
  }, []);

  // 标题栏由 main process 通过屏幕坐标判断 hover,renderer 只负责动画和按钮状态。
  useEffect(() => {
    let hideTimer: number | null = null;
    const off = window.opabrow.onTitlebarVisibility((visible) => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }

      if (visible) {
        setTitlebarVisible(true);
        return;
      }

      hideTimer = window.setTimeout(() => {
        setTitlebarVisible(false);
        hideTimer = null;
      }, 280);
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
        void goUrl(HOME_URL);
        return;
      }
      // ⌘L
      if (e.key === 'l' && !e.shiftKey) {
        e.preventDefault();
        setShowQuickBar(true);
        setTimeout(() => quickInputRef.current?.focus(), 50);
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
  }

  function reload() {
    try {
      webviewRef.current?.reload();
    } catch (e) {
      console.warn('reload failed:', e);
    }
  }

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
            <span className="quick-label">透明度</span>
            <input
              className="quick-slider"
              type="range"
              min={0.1}
              max={1.0}
              step={0.01}
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
            />
            <span className="quick-value">{Math.round(opacity * 100)}%</span>
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

      {/* 顶部 32px 独立标题栏:始终占位,默认透明,不覆盖网页区域。 */}
      <div
        className={`titlebar ${titlebarVisible ? 'visible' : ''}`}
        title="拖动窗口"
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
          />
          <button
            type="button"
            className="traffic-button minimize"
            aria-label="最小化窗口"
            title="最小化窗口 (⌘M)"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => window.opabrow.minimizeWindow()}
          />
        </div>
      </div>

      {/* webview 容器:从标题栏下方开始,网页大小不受标题栏显隐影响。 */}
      <div className="webview-container" ref={webviewContainerRef} />
    </div>
  );
}

export default App;
