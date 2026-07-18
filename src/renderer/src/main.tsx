import { createRoot } from 'react-dom/client';
import App from './App';
import './App.css';

// 临时关掉 StrictMode,避免 dev 模式下 useEffect 双跑导致 webview 重复创建
// (HMR + StrictMode 会让 webview dom-ready 事件在某些时序下丢失)
createRoot(document.getElementById('root')!).render(<App />);
