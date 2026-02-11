// Backend API client for proxying requests to the Express backend

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

console.log('[Backend API] Configured URL:', BACKEND_URL);

export async function backendFetch(endpoint, options = {}) {
  const url = `${BACKEND_URL}${endpoint}`;
  
  console.log('[Backend API] Fetching:', url);
  
  try {
    const controller = new AbortController();
    const timeoutMs = 12000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    console.log('[Backend API] Response status:', response.status);
    return response;
  } catch (error) {
    const message =
      error?.name === 'AbortError'
        ? `Request timed out after 12s (${url})`
        : error?.message || 'Unknown error';
    console.error('[Backend API] Fetch error:', message);
    throw new Error(`Backend fetch failed: ${message}`);
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function backendLogin(email, password) {
  console.log('[Backend API] Attempting login for:', email);
  
  const response = await backendFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  
  if (!response.ok) {
    const errorBody = await safeJson(response);
    console.error('[Backend API] Login failed:', errorBody || response.status);
    const err = new Error(errorBody?.error || `Login failed (${response.status})`);
    err.status = response.status;
    err.payload = errorBody;
    throw err;
  }
  
  const result = await safeJson(response);
  console.log('[Backend API] Login successful');
  return result;
}

export async function backendRegister(email, password) {
  const response = await backendFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorBody = await safeJson(response);
    const err = new Error(errorBody?.error || `Registration failed (${response.status})`);
    err.status = response.status;
    err.payload = errorBody;
    throw err;
  }

  return safeJson(response);
}

export async function backendGetDashboard(token) {
  console.log('[Backend API] Fetching dashboard data');
  
  const response = await backendFetch('/dashboard', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    console.error('[Backend API] Dashboard fetch failed:', response.status);
    throw new Error('Failed to fetch dashboard data');
  }
  
  const data = await response.json();
  console.log('[Backend API] Dashboard data received');
  return data;
}

function formatNotional(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '--';
  const sign = numberValue < 0 ? '-' : '';
  const absValue = Math.abs(numberValue);

  if (absValue >= 1_000_000_000) {
    return `${sign}$${(absValue / 1_000_000_000).toFixed(1)}B`;
  }
  if (absValue >= 1_000_000) {
    return `${sign}$${(absValue / 1_000_000).toFixed(1)}M`;
  }
  if (absValue >= 1_000) {
    return `${sign}$${(absValue / 1_000).toFixed(1)}K`;
  }
  return `${sign}$${absValue.toFixed(0)}`;
}

function formatStrike(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '--';
  return `$${numberValue.toFixed(2)}`;
}

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, num));
}

export async function backendGetPositioning(token, symbol = 'SPY') {
  console.log('[Backend API] Fetching positioning data for:', symbol);

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  const [gexResponse, flowResponse, maxPainResponse, correlationResponse] = await Promise.all([
    backendFetch(`/positioning/gex?symbol=${symbol}`, { headers }),
    backendFetch(`/positioning/options-flow?symbol=${symbol}&limit=100`, { headers }),
    backendFetch(`/positioning/max-pain?symbol=${symbol}`, { headers }),
    backendFetch(`/positioning/signal-correlation?symbol=${symbol}`, { headers }),
  ]);

  if (!gexResponse.ok) {
    console.error('[Backend API] Positioning GEX fetch failed:', gexResponse.status);
    throw new Error('Failed to fetch positioning data');
  }

  const gexPayload = await gexResponse.json();
  const flowPayload = flowResponse.ok ? await flowResponse.json() : { data: { entries: [] } };
  const maxPainPayload = maxPainResponse.ok ? await maxPainResponse.json() : { data: null };
  const correlationPayload = correlationResponse.ok ? await correlationResponse.json() : { data: null };

  const gex = gexPayload?.data || {};
  const flow = flowPayload?.data || {};
  const maxPain = maxPainPayload?.data || {};
  const correlation = correlationPayload?.data || {};

  const callVolume = Array.isArray(flow.entries)
    ? flow.entries.filter((entry) => entry.side === 'call').reduce((sum, entry) => sum + Number(entry.volume || 0), 0)
    : 0;
  const putVolume = Array.isArray(flow.entries)
    ? flow.entries.filter((entry) => entry.side === 'put').reduce((sum, entry) => sum + Number(entry.volume || 0), 0)
    : 0;
  const totalVolume = callVolume + putVolume;
  const bullish = totalVolume > 0 ? Math.round((callVolume / totalVolume) * 100) : 0;
  const bearish = totalVolume > 0 ? 100 - bullish : 0;
  const totalPremium = Array.isArray(flow.entries)
    ? flow.entries.reduce((sum, entry) => sum + Number(entry.premium || 0), 0)
    : 0;

  const dealerPosition = String(gex.dealerPosition || '').toLowerCase();
  const gammaRegime =
    dealerPosition === 'long_gamma'
      ? 'LONG_GAMMA'
      : dealerPosition === 'short_gamma'
        ? 'SHORT_GAMMA'
        : 'NEUTRAL';
  const expectedBehavior = gammaRegime === 'LONG_GAMMA' ? 'MEAN_REVERT' : 'EXPANSION';

  const correlationScore = clamp(Number(correlation.correlationScore || 0), 0, 1);
  const correlationValues = [
    { label: 'GEX vs Price', value: correlationScore, color: 'bg-sky-400' },
    { label: 'Flow vs Momentum', value: clamp(correlationScore * 0.9, 0, 1), color: 'bg-emerald-400' },
    { label: 'Volume vs Volatility', value: clamp(correlationScore * 0.75, 0, 1), color: 'bg-fuchsia-400' },
  ];

  const response = {
    symbol,
    gex: {
      total: formatNotional(gex.netGex ?? gex.totalCallGex + gex.totalPutGex),
      call: formatNotional(gex.totalCallGex),
      put: formatNotional(gex.totalPutGex),
    },
    gamma: {
      regime: gammaRegime,
      zeroGammaLevel: gex.zeroGammaLevel ?? null,
      expectedBehavior,
      distanceATR: null,
    },
    optionsFlow: {
      premium: formatNotional(totalPremium),
      bullish,
      bearish,
    },
    maxPain: {
      strike: formatStrike(maxPain.maxPainStrike),
      note: maxPain.maxPainStrike ? 'Highest open interest concentration' : 'No max pain data',
    },
    correlation: correlationValues,
  };

  console.log('[Backend API] Positioning data received');
  return response;
}

export async function backendGetMonitoringStatus(token, limit = 25, testFilter = 'all') {
  const response = await backendFetch(
    `/monitoring/status?limit=${limit}&testFilter=${encodeURIComponent(testFilter)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch monitoring status');
  }

  return response.json();
}

export async function backendGetIntelLatest(token, symbol = 'SPY') {
  const response = await backendFetch(`/intel/latest?symbol=${encodeURIComponent(symbol)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch market intel snapshot');
  }

  return response.json();
}

export async function backendGetWebhookSchema(token) {
  const response = await backendFetch('/api/v1/webhooks/schema', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch webhook schema');
  }

  return response.json();
}

export async function backendGetRecentProductionWebhooks(token, limit = 10, status = '') {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  if (status) query.set('status', status);
  const response = await backendFetch(`/api/v1/webhooks/recent-production?${query.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch recent production webhooks');
  }

  return response.json();
}

export async function backendSendTestWebhook(token, payload) {
  const response = await backendFetch('/api/v1/testing/webhooks/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(error?.error || 'Failed to send test webhook');
  }

  return response.json();
}

export async function backendSendBatchTestWebhooks(token, payload) {
  const response = await backendFetch('/api/v1/testing/webhooks/send-batch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(error?.error || 'Failed to send batch test webhooks');
  }

  return response.json();
}

export async function backendSendCustomWebhook(token, payload) {
  const response = await backendFetch('/api/v1/testing/webhooks/send-custom', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(error?.error || 'Failed to send custom webhook');
  }

  return response.json();
}

export async function backendSendBatchCustomWebhooks(token, payload) {
  const response = await backendFetch('/api/v1/testing/webhooks/send-batch-custom', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await safeJson(response);
    throw new Error(error?.error || 'Failed to send batch custom webhooks');
  }

  return response.json();
}

export async function backendGetTestSession(token, testSessionId) {
  const response = await backendFetch(`/api/v1/testing/sessions/${testSessionId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch test session');
  }

  return response.json();
}

export async function backendClearTestSession(token, testSessionId) {
  const response = await backendFetch(`/api/v1/testing/sessions/${testSessionId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to clear test session');
  }

  return response.json();
}

export async function backendGetMonitoringDetail(token, type, id) {
  const response = await backendFetch(`/monitoring/details?type=${type}&id=${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch monitoring detail (${response.status})`);
  }

  return response.json();
}

export async function backendGetRelatedWebhooks(token, symbol, timeframe, hours = 24) {
  const response = await backendFetch(
    `/monitoring/related?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&hours=${hours}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch related webhooks (${response.status})`);
  }

  return response.json();
}

export async function backendGetOrders(token) {
  const response = await backendFetch('/orders', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch orders (${response.status})`);
  }

  return response.json();
}

export async function backendGetHistoryStats(token) {
  const response = await backendFetch('/history/stats', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch history (${response.status})`);
  }

  return response.json();
}
