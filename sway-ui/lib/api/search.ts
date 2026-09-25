import { fetchApi } from './client';
import type { SearchResponseData } from './types';

// NOTE: backend page is 1-indexed (ge=1)
export async function search(
  query: string,
  limit: number = 20,
  page: number = 1,
  enrich: boolean = false,
  signal?: AbortSignal
) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const params = new URLSearchParams({
    q: query,
    n: safeLimit.toString(),
    page: safePage.toString(),
    enrich: enrich.toString(),
  });
  return fetchApi<SearchResponseData>(`/search?${params.toString()}`, { signal });
}
