import type { OpabrowAPI } from '../../preload';

declare global {
  interface Window {
    opabrow: OpabrowAPI;
  }
}

export {};
