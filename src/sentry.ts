import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 1);
const profilesSampleRate = Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 1);

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    Sentry.httpIntegration(),
    Sentry.expressIntegration(),
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 1,
  profilesSampleRate: Number.isFinite(profilesSampleRate) ? profilesSampleRate : 1,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,
  attachStacktrace: true,
});

Sentry.captureMessage('BOOT_START', {
  level: 'info',
  tags: { stage: 'bootstrap' },
});
