import { useEffect, useRef, useState } from 'react';

const HOME_URL = 'https://www.bilibili.com';

function App() {
  const [url, setUrl] = useState(HOME_URL);
  const [currentUrl, setCurrentUrl] = useState(HOME_URL);
  const [showQuickBar, setShowQuickBar] = useState(false);
  const [opacity, setOpacity] = useState(1.0);
  const [onTop, setOnTop] = useState(false);
  const [trafficBarVisible, setTrafficBarVisible] = useState(false);
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const webviewContainerRef = useRef<HTMLDivElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);

  const loadInWebview = (targetUrl: string) => {
    const wv = webviewRef.current;
    if (!wv) return;
    if (typeof wv.loadURL === 'function') {
      void wv.loadURL(targetUrl);
      return;
    }
    wv.src = targetUrl;
  };

  // 透明度变化 → main process
  useEffect(() => {
    window.opabrow.setOpacity(opacity);
  }, [opacity]);

  // 置顶状态变化 → main process
  useEffect(() => {
    window.opabrow.setAlwaysOnTop(onTop);
  }, [onTop]);

  // 顶部 traffic bar 显隐 —— 主动轮询鼠标位置,直接改 DOM style.opacity
  // 原因 1:webview (hosted plugin) 拦截所有 mouse 事件,renderer 端用
  //   document/window/traffic-bar 上的 mouseenter/mousemove/mouseover 都收不到。
  //   唯一可靠的方案:用 IPC 问主进程要光标位置 (screen.getCursorScreenPoint)。
  // 原因 2:React 19 + Vite HMR 在某些时序下 setState 不可靠
  //   (看到 render: trafficBarVisible=true 之后 setTrafficBarVisible(false) 没触发 re-render)
  //   直接改 DOM style.opacity 最稳。
  useEffect(() => {
    let hideTimer: number | null = null;
    let stopped = false;
    let currentVisible = false;

    if (typeof window.opabrow?.getCursorPos !== 'function') {
      return;
    }

    const setBarVisible = (visible: boolean): void => {
      if (visible === currentVisible) return;
      currentVisible = visible;
      // 直接改 DOM,绕过 React 渲染 (React 19 + Vite HMR 在某些时序下
      // setState 后不触发 re-render,直接改 DOM.style.opacity 最稳)
      const bar = document.querySelector('.traffic-bar') as HTMLElement | null;
      if (bar) {
        bar.style.opacity = visible ? '1' : '0';
      }
      // 同步 React state(虽然 DOM 已改,但下次 React re-render 会按 state 重置,
      // 所以两个都改)
      setTrafficBarVisible(visible);
    };

    // 关键:只在 timer 未设置时设置,避免每次 poll 都重置 timer
    // (否则 80ms 间隔 poll 会无限重置 300ms timer,永远不 fire)
    const scheduleHide = (): void => {
      if (hideTimer !== null) return;
      hideTimer = window.setTimeout(() => {
        setBarVisible(false);
        hideTimer = null;
      }, 300);
    };

    const show = (): void => {
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      setBarVisible(true);
    };

    // 轮询:每 80ms 问主进程要光标位置
    const interval = window.setInterval(async () => {
      if (stopped) return;
      try {
        const pos = await window.opabrow.getCursorPos();
        if (!pos) return;
        const inX = pos.x >= 0 && pos.x < pos.bounds.width;
        const inY = pos.y >= 0 && pos.y < pos.bounds.height;
        if (inX && inY) {
          if (pos.y < 28) {
            show();
          } else {
            scheduleHide();
          }
        } else {
          if (hideTimer !== null) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
          setBarVisible(false);
        }
      } catch (e) {
        // 忽略
      }
    }, 80);

    return () => {
      stopped = true;
      clearInterval(interval);
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    };
  }, []);

  // 移除 React useEffect 改用 CSS :hover 触发 (见 App.css .traffic-bar:hover)
  // 原因:bar 平时 pointer-events: auto + opacity: 0,鼠标进入 bar 区域时
  // CSS :hover 自然触发,比 useEffect 监听 mouseenter 更轻量可靠

  // 挂载 webview (动态创建,绕过 React 编译对 <webview> tag 的处理)
  useEffect(() => {
    const container = webviewContainerRef.current;
    if (!container) return;

    // 延迟到下一个 microtask,确保 React 已 commit DOM
    queueMicrotask(() => {
      if (!container) return;
      // 只清掉 webview 元素(不影响 React 渲染的 traffic-bar 等其他子节点)
      // 之前用 while (firstChild) 会把 traffic-bar 也删掉,这是 bug
      const existingWebviews = container.querySelectorAll('webview');
      existingWebviews.forEach((w) => w.remove());

      const wv = document.createElement('webview') as Electron.WebviewTag;
      wv.className = 'webview';
      wv.setAttribute('allowpopups', 'false');
      // 简单:宽度高度 100%,webview-container 有 padding-top: 28px 让 webview 自然下移
      wv.style.width = '100%';
      wv.style.height = '100%';
      wv.style.border = '0';
      wv.style.background = '#fff';
      wv.style.display = 'block';
      // 在 createElement 之后就设 src,这样 attach 时 webview 已知道要加载什么
      wv.setAttribute('src', currentUrl);

      const syncUrl = (e: Event) => {
        const next = (e as unknown as { url?: string }).url;
        if (!next) return;
        setCurrentUrl(next);
        setUrl(next);
      };
      wv.addEventListener('did-navigate', syncUrl);
      wv.addEventListener('did-navigate-in-page', syncUrl);
      // 兜底:new-window 事件(部分 Electron 版本仍派发)
      // 主拦截在 main 进程的 app.on('web-contents-created') 全局钩子
      wv.addEventListener('new-window', (e) => {
        e.preventDefault();
        const target = (e as unknown as { url?: string }).url;
        if (target) {
          void wv.loadURL(target);
          setCurrentUrl(target);
          setUrl(target);
        }
      });

      // attach 到 DOM
      container.appendChild(wv);
      webviewRef.current = wv;
    });

    return () => {
      const wv = webviewRef.current;
      if (wv) {
        wv.remove();
        webviewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL 变化时 → 改 webview.src
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    try {
      void wv.loadURL(currentUrl);
    } catch (e) {
      // webview 还没 ready 会 throw,忽略
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
  }, [currentUrl]);

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

  // 备份:⌘L / ⌘+[ / ⌘+] 在 renderer 内也能响应
  // webview 焦点时键盘事件全进 webview,renderer 收不到 keydown,所以主路径走菜单 accelerator
  // 但这里保留 keydown 监听作为兜底(比如 webview 未 focus 时的菜单栏使用)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // ⌘+[ 后退
      if (e.key === '[' && !e.shiftKey && !e.altKey) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
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
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        try {
          webviewRef.current?.goForward();
        } catch (err) {
          console.warn('goForward failed:', err);
        }
        return;
      }
      // ⌘L
      if (e.key === 'l' && !e.shiftKey) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
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
    <div
      className="app"
      style={{
        // 兜底 inline style,确保 .app 容器占满整个 window content area
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        overflow: 'hidden'
      } as React.CSSProperties}
    >
      {/* webview 容器 —— webview 元素由 useEffect 动态创建
          顶部 0 偏移,但用 padding-top: 28px 给 traffic-bar 让出空间 */}
      <div
        className="webview-container"
        ref={webviewContainerRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#fff',
          zIndex: 0,
          paddingTop: 28 // 给 traffic-bar 让出顶部 28px
        } as React.CSSProperties}
      >
      </div>

      {/* 顶部 iPhone Mirroring 风格 traffic bar —— 移到 webview-container 之外,
          作为 fixed 定位的浮层。这样:
          1. z-index 在 webview-container 之上,不会被打到 webview 后面
          2. 鼠标事件不会被 webview (hosted plugin) 拦截
          3. macOS titleBarStyle: 'hidden' 下,contentView 从 0 开始,
             traffic-bar 的 top: 0 正好对应窗口最顶部 */}
      {/* 顶部 iPhone Mirroring 风格 traffic bar —— 作为 fixed 定位的浮层
          平时完全 chrome-less(只 macOS 的 traffic light 已被主进程隐藏到 -100,-100),
          鼠标 hover 窗口顶部 28px 时,React state 驱动 opacity 0→1,显示红黄绿三按钮
          鼠标离开时,300ms 延迟后自动隐藏

          关键设计:
          - z-index: 99999,确保在 webview 之上
          - 80px left padding,让红黄绿按钮避开可能的 macOS 区域
          - background: #f5f5f7 (macOS 标准 chrome 灰)
          - WebkitAppRegion: 'drag' 让整个 bar 可拖动窗口 */}
      {/* 顶部 iPhone Mirroring 风格 traffic bar —— 作为 fixed 定位的浮层
          平时完全 chrome-less(只 macOS 的 traffic light 已被主进程隐藏到 -100,-100),
          鼠标 hover 窗口顶部 28px 时,显隐逻辑(在 useEffect 里)会直接改
          .traffic-bar 元素的 style.opacity,显示红黄绿三按钮
          鼠标离开时,300ms 延迟后自动隐藏

          关键设计:
          - z-index: 99999,确保在 webview 之上
          - 80px left padding,让红黄绿按钮避开可能的 macOS 区域
          - background: #f5f5f7 (macOS 标准 chrome 灰)
          - WebkitAppRegion: 'drag' 让整个 bar 可拖动窗口 */}
      <div
        className="traffic-bar"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 28,
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px 0 80px', // 左 80px 留出 macOS traffic lights 的位置
          gap: '8px',
          background: '#f5f5f7',
          borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
          opacity: trafficBarVisible ? 1 : 0,
          pointerEvents: 'auto',
          transition: 'opacity 0.18s ease',
          WebkitAppRegion: 'drag'
        } as React.CSSProperties}
      >
        <button
          className="tl tl-close"
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '0.5px solid rgba(0,0,0,0.15)',
            padding: 0,
            cursor: 'pointer',
            background: '#ff5f57',
            outline: 'none',
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties}
          onClick={() => window.opabrow.closeWindow()}
          title="关闭窗口 (⌘W)"
          aria-label="关闭"
        />
        <button
          className="tl tl-min"
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '0.5px solid rgba(0,0,0,0.15)',
            padding: 0,
            cursor: 'pointer',
            background: '#febc2e',
            outline: 'none',
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties}
          onClick={() => window.opabrow.minimizeWindow()}
          title="最小化 (⌘M)"
          aria-label="最小化"
        />
        <button
          className="tl tl-zoom"
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '0.5px solid rgba(0,0,0,0.15)',
            padding: 0,
            cursor: 'pointer',
            background: '#28c840',
            outline: 'none',
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties}
          onClick={() => window.opabrow.zoomWindow()}
          title="最大化"
          aria-label="最大化"
        />
      </div>

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

      {/* webview 容器 —— webview 元素由 useEffect 动态创建 */}
      {/* 顶部 0 偏移,因为 macOS titleBarStyle: 'customButtonsOnHover' 已经在窗口顶部
          提供了 hover 拖动区,不需要自己的 drag bar */}
      <div
        className="webview-container"
        ref={webviewContainerRef}
        style={{
          // 兜底 inline style,确保即使 CSS 没加载完也能 flex column 布局
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#fff',
          zIndex: 0
        } as React.CSSProperties}
      >
      </div>
    </div>
  );
}

export default App;
