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

export async function backendGetPositioning(token, symbol = 'SPY') {
  console.log('[Backend API] Fetching positioning data for:', symbol);
  
  const response = await backendFetch(`/positioning/gex?symbol=${symbol}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    console.error('[Backend API] Positioning fetch failed:', response.status);
    throw new Error('Failed to fetch positioning data');
  }
  
  const data = await response.json();
  console.log('[Backend API] Positioning data received');
  return data;
}

export async function backendGetMonitoringStatus(token, limit = 25) {
  const response = await backendFetch(`/monitoring/status?limit=${limit}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch monitoring status');
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
