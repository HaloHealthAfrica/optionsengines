import { WebSocketServer } from 'ws';
import { logger } from '../utils/logger.js';
import { getTestSessionSummary } from './testing-session.service.js';
import type { Server } from 'http';

type SessionState = {
  testSessionId: string | null;
  interval: NodeJS.Timeout | null;
};

export function createTestingWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/v1/testing/live' });

  wss.on('connection', (socket) => {
    const state: SessionState = { testSessionId: null, interval: null };

    const clear = () => {
      if (state.interval) {
        clearInterval(state.interval);
        state.interval = null;
      }
    };

    socket.on('message', async (data) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload?.action === 'subscribe' && payload?.test_session_id) {
          state.testSessionId = String(payload.test_session_id);
          clear();
          state.interval = setInterval(async () => {
            if (!state.testSessionId) return;
            const summary = await getTestSessionSummary(state.testSessionId);
            socket.send(
              JSON.stringify({
                type: 'session_summary',
                test_session_id: summary.test_session_id,
                progress: `${summary.summary.accepted + summary.summary.duplicates + summary.summary.failed}/${summary.summary.total_webhooks}`,
                success_rate: summary.summary.total_webhooks
                  ? Math.round((summary.summary.accepted / summary.summary.total_webhooks) * 1000) / 10
                  : 0,
                avg_processing_time: summary.summary.avg_processing_time_ms,
              })
            );
          }, 1000);
          socket.send(JSON.stringify({ type: 'subscribed', test_session_id: state.testSessionId }));
        }
      } catch (error) {
        logger.warn('Testing WebSocket message failed', { error });
      }
    });

    socket.on('close', () => {
      clear();
    });
  });

  logger.info('Testing WebSocket server started', { path: '/v1/testing/live' });
  return wss;
}
