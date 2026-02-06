// Backend API client for proxying requests to the Express backend

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export async function backendFetch(endpoint, options = {}) {
  const url = `${BACKEND_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    return response;
  } catch (error) {
    console.error('Backend API error:', error);
    throw error;
  }
}

export async function backendLogin(email, password) {
  const response = await backendFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }
  
  return response.json();
}

export async function backendGetDashboard(token) {
  const response = await backendFetch('/api/dashboard', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch dashboard data');
  }
  
  return response.json();
}

export async function backendGetPositioning(token, symbol = 'SPY') {
  const response = await backendFetch(`/api/positioning/gex?symbol=${symbol}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch positioning data');
  }
  
  return response.json();
}
