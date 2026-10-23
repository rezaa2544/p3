export type ApiErrorPayload = { code: string; message: string; details?: unknown; requestId?: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(message = 'ارتباط با سرور برقرار نشد') {
    super(message);
    this.name = 'NetworkError';
  }
}

type Context = { schoolId: string | null; csrfToken: string | null };
const context: Context = { schoolId: null, csrfToken: null };

export function setApiContext(next: Partial<Context>): void {
  Object.assign(context, next);
}

export function getApiContext(): Readonly<Context> {
  return context;
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  formData?: FormData;
};

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json', ...(options.headers ?? {}) };
  if (context.schoolId) headers['x-school-id'] = context.schoolId;
  if (method !== 'GET' && context.csrfToken) headers['x-csrf-token'] = context.csrfToken;

  let payload: BodyInit | undefined;
  if (options.formData) {
    payload = options.formData;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: payload,
      credentials: 'include',
      signal: options.signal,
      cache: 'no-store',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new NetworkError(isOffline() ? 'اتصال اینترنت قطع است' : 'ارتباط با سرور برقرار نشد');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const err = (json as { error?: ApiErrorPayload } | null)?.error;
    const error = new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? 'درخواست ناموفق بود',
      err?.details,
      err?.requestId,
    );
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('payesh:unauthorized'));
    }
    throw error;
  }
  return json as T;
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: 'include', cache: 'no-store' });
  } catch {
    throw new NetworkError();
  }
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'دریافت فایل ناموفق بود');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof NetworkError) return e.message;
  if (e instanceof Error) return e.message;
  return 'خطای نامشخص';
}
