import { useEffect, useRef, useState } from 'react';

function buildWsUrl() {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }
  return 'ws://localhost:8080/v1/realtime';
}

export function useRealtime({ symbol } = {}) {
  const [intel, setIntel] = useState(null);
  const [positions, setPositions] = useState([]);
  const [riskState, setRiskState] = useState(null);
  const wsRef = useRef(null);
  const symbolRef = useRef(symbol);

  useEffect(() => {
    symbolRef.current = symbol;
  }, [symbol]);

  useEffect(() => {
    const ws = new WebSocket(buildWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (symbolRef.current) {
        ws.send(JSON.stringify({ action: 'subscribe', symbol: symbolRef.current }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        switch (message.type) {
          case 'intel_update':
            setIntel(message.data);
            break;
          case 'positions_snapshot':
            setPositions(Array.isArray(message.data) ? message.data : []);
            break;
          case 'position_update':
            setPositions((prev) => {
              const next = Array.isArray(prev) ? [...prev] : [];
              const index = next.findIndex((item) => item.id === message.data?.id);
              if (index >= 0) {
                next[index] = message.data;
                return next;
              }
              return [message.data, ...next];
            });
            break;
          case 'risk_update':
            setRiskState(message.data);
            break;
        }
      } catch {
        // ignore malformed payloads
      }
    };

    ws.onerror = () => {
      // noop
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && symbol) {
      ws.send(JSON.stringify({ action: 'subscribe', symbol }));
    }
  }, [symbol]);

  return { intel, positions, riskState };
}
