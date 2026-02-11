import { useEffect, useRef } from 'react';

export function useAutoRefresh(callback, intervalMs = 30000, enabled = true) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return undefined;

    const tick = () => {
      if (document.visibilityState === 'visible') {
        callbackRef.current?.();
      }
    };

    const timer = setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        callbackRef.current?.();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
