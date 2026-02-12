#!/usr/bin/env tsx
/**
 * Sentry REST API Client for E2E Validation
 *
 * Fetches events, errors, transactions, and custom messages from Sentry
 * to correlate with signal lifecycle and detect silent failures.
 *
 * Requires: SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG, SENTRY_PROJECT_SLUG
 */

const SENTRY_BASE = 'https://sentry.io/api/0';

export interface SentryEvent {
  id: string;
  timestamp: string;
  message?: string;
  level?: string;
  tags?: Record<string, string>;
  contexts?: Record<string, unknown>;
  event?: { type?: string };
  'event.type'?: string;
  trace?: { trace_id?: string };
  [key: string]: unknown;
}

export interface SentryConfig {
  authToken: string;
  orgSlug: string;
  projectSlug: string;
}

export function getConfig(): SentryConfig | null {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG_SLUG || process.env.SENTRY_ORGANIZATION;
  const project = process.env.SENTRY_PROJECT_SLUG || process.env.SENTRY_PROJECT;
  if (!token || !org || !project) return null;
  return { authToken: token, orgSlug: org, projectSlug: project };
}

async function fetchSentry<T>(
  path: string,
  config: SentryConfig,
  params?: Record<string, string | number | string[] | undefined>
): Promise<T> {
  const url = new URL(`${SENTRY_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        v.forEach((val) => url.searchParams.append(k, String(val)));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.authToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sentry API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * List project events (errors + custom messages)
 * GET /api/0/projects/{org}/{project}/events/
 */
export async function listProjectEvents(
  config: SentryConfig,
  options: {
    query?: string;
    statsPeriod?: string;
    field?: string[];
    perPage?: number;
  } = {}
): Promise<{ data: SentryEvent[] }> {
  const params: Record<string, string | number | string[]> = {
    statsPeriod: options.statsPeriod ?? '1h',
    per_page: options.perPage ?? 100,
  };
  if (options.query) params.query = options.query;
  if (options.field?.length) params.field = options.field;
  return fetchSentry<{ data: SentryEvent[] }>(
    `/organizations/${config.orgSlug}/events/`,
    config,
    params as Record<string, string | number | string[] | undefined>
  );
}

/**
 * Query Discover events (supports transactions, custom events, tags)
 * GET /api/0/organizations/{org}/events/
 */
export async function queryDiscoverEvents(
  config: SentryConfig,
  options: {
    query?: string;
    statsPeriod?: string;
    field?: string[];
    project?: number[];
    environment?: string[];
    perPage?: number;
  } = {}
): Promise<{ data: SentryEvent[]; meta?: { fields?: Record<string, string> } }> {
  const params: Record<string, string | number | string[] | undefined> = {
    statsPeriod: options.statsPeriod ?? '1h',
    per_page: options.perPage ?? 100,
    field: options.field ?? [
      'timestamp',
      'message',
      'level',
      'event.type',
      'trace',
      'tags[signalId]',
      'tags[stage]',
      'tags[worker]',
      'tags[provider]',
      'tags[module]',
    ],
  };
  if (options.query) params.query = options.query;
  if (options.project?.length) params.project = options.project;
  if (options.environment?.length) params.environment = options.environment;

  return fetchSentry<{ data: SentryEvent[]; meta?: { fields?: Record<string, string> } }>(
    `/organizations/${config.orgSlug}/events/`,
    config,
    params
  );
}

/**
 * Fetch errors during test window
 */
export async function fetchErrors(
  config: SentryConfig,
  options: { statsPeriod?: string; query?: string } = {}
): Promise<SentryEvent[]> {
  const q = options.query
    ? `${options.query} level:error`
    : 'level:error';
  const res = await queryDiscoverEvents(config, {
    query: q,
    statsPeriod: options.statsPeriod ?? '1h',
    field: ['timestamp', 'message', 'level', 'event.type', 'tags[signalId]', 'tags[stage]', 'tags[worker]'],
  });
  return res.data ?? [];
}

/**
 * Fetch transactions (performance traces)
 */
export async function fetchTransactions(
  config: SentryConfig,
  options: { statsPeriod?: string; query?: string } = {}
): Promise<SentryEvent[]> {
  const q = options.query
    ? `${options.query} event.type:transaction`
    : 'event.type:transaction';
  const res = await queryDiscoverEvents(config, {
    query: q,
    statsPeriod: options.statsPeriod ?? '1h',
    field: [
      'transaction',
      'transaction.duration',
      'timestamp',
      'transaction.op',
      'tags[signalId]',
      'tags[stage]',
    ],
  });
  return res.data ?? [];
}

/**
 * Fetch custom events (TRADE_ENGINE_*, WORKER_*, REDIS_*, etc.)
 */
export async function fetchCustomEvents(
  config: SentryConfig,
  options: { statsPeriod?: string; messagePrefix?: string } = {}
): Promise<SentryEvent[]> {
  const q = options.messagePrefix
    ? `message:${options.messagePrefix}*`
    : undefined;
  const res = await queryDiscoverEvents(config, {
    query: q,
    statsPeriod: options.statsPeriod ?? '1h',
    field: ['timestamp', 'message', 'level', 'tags[signalId]', 'tags[worker]', 'tags[stage]'],
  });
  return res.data ?? [];
}

/**
 * Fetch events by signalId tag
 */
export async function fetchEventsBySignalId(
  config: SentryConfig,
  signalId: string,
  options: { statsPeriod?: string } = {}
): Promise<SentryEvent[]> {
  const res = await queryDiscoverEvents(config, {
    query: `tags[signalId]:${signalId}`,
    statsPeriod: options.statsPeriod ?? '1h',
    field: ['timestamp', 'message', 'level', 'event.type', 'tags[signalId]', 'tags[stage]', 'tags[worker]'],
  });
  return res.data ?? [];
}

/**
 * Fetch Redis-related events
 */
export async function fetchRedisEvents(
  config: SentryConfig,
  options: { statsPeriod?: string } = {}
): Promise<SentryEvent[]> {
  const res = await queryDiscoverEvents(config, {
    query: 'tags[stage]:redis',
    statsPeriod: options.statsPeriod ?? '1h',
    field: ['timestamp', 'message', 'level', 'tags[stage]', 'tags[op]'],
  });
  return res.data ?? [];
}

/**
 * Fetch market data provider events
 */
export async function fetchMarketDataEvents(
  config: SentryConfig,
  options: { statsPeriod?: string } = {}
): Promise<SentryEvent[]> {
  const res = await queryDiscoverEvents(config, {
    query: 'tags[stage]:market-data OR tags[provider]:*',
    statsPeriod: options.statsPeriod ?? '1h',
    field: ['timestamp', 'message', 'level', 'tags[provider]', 'tags[stage]'],
  });
  return res.data ?? [];
}

/**
 * Check for silent failure patterns
 */
export async function fetchSilentFailurePatterns(
  config: SentryConfig,
  options: { statsPeriod?: string } = {}
): Promise<{
  unhandledRejection: SentryEvent[];
  uncaughtException: SentryEvent[];
  workerErrors: SentryEvent[];
}> {
  const [errors] = await Promise.all([
    fetchErrors(config, {
      statsPeriod: options.statsPeriod ?? '1h',
      query: undefined,
    }),
  ]);

  const unhandledRejection = errors.filter(
    (e) =>
      e.message?.toLowerCase().includes('unhandledrejection') ||
      e.message?.toLowerCase().includes('unhandled rejection')
  );
  const uncaughtException = errors.filter(
    (e) =>
      e.message?.toLowerCase().includes('uncaughtexception') ||
      e.message?.toLowerCase().includes('uncaught exception')
  );
  const workerErrors = errors.filter(
    (e) => e.tags?.worker || e.message?.toLowerCase().includes('worker')
  );

  return { unhandledRejection, uncaughtException, workerErrors };
}

