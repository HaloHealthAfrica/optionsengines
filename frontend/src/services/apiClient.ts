function resolveApiBase(): string {
  const envBase = (import.meta as any).env?.VITE_API_URL as string | undefined;
  if (envBase) {
    return envBase;
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const host = window.location.hostname;
  if (host.endsWith('vercel.app')) {
    return 'https://optionsengines.fly.dev';
  }

  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:3000';
  }

  return window.location.origin;
}

const API_BASE = resolveApiBase();
const TOKEN_KEY = 'oa_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    const body = isJson ? await response.json().catch(() => ({})) : {};
    const message = body?.error ?? `Request failed: ${response.status}`;
    throw new Error(message);
  }

  if (!isJson) {
    throw new Error('Unexpected response from API (non-JSON).');
  }

  return response.json() as Promise<T>;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export function apiPost<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getApiBase(): string {
  return API_BASE;
}
