/** Thin fetch wrapper: cookies for the session, double-submit CSRF header, structured errors. */

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[] | unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level validation messages keyed by dotted path, when the server sent them. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
  }
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function withQuery(path: string, q?: Query) {
  if (!q) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

export const apiUrl = (path: string) => `${BASE}/api${path}`;

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('mc_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      credentials: 'include',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the MediChain server. Check your connection or that the API is running.');
  }
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, q?: Query) => request<T>('GET', withQuery(path, q)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Downloads a file (e.g. CSV export, QR PNG) using the session cookie. */
export async function downloadFile(path: string, filename: string) {
  const res = await fetch(apiUrl(path), { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? 'Download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}
