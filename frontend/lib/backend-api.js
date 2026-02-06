// Backend API client for proxying requests to the Express backend

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

console.log('[Backend API] Configured URL:', BACKEND_URL);

export async function backendFetch(endpoint, options = {}) {
  const url = `${BACKEND_URL}${endpoint}`;
  
  console.log('[Backend API] Fetching:', url);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    console.log('[Backend API] Response status:', response.status);
    return response;
  } catch (error) {
    console.error('[Backend API] Fetch error:', error.message);
    throw error;
  }
}

export async function backendLogin(email, password) {
  console.log('[Backend API] Attempting login for:', email);
  
  const response = await backendFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error('[Backend API] Login failed:', error);
    throw new Error(error.error || 'Login failed');
  }
  
  const result = await response.json();
  console.log('[Backend API] Login successful');
  return result;
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
