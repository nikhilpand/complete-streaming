import type { ApiResponse } from './types';

const isServer = typeof window === 'undefined';
const API_BASE = isServer ? (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000') + '/api/v1' : '/api/proxy';

export async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const data: ApiResponse<T> = await response.json();

  if (!data.success) {
    throw new Error(data.error || `Failed to fetch ${endpoint}`);
  }

  return data.data as T;
}
