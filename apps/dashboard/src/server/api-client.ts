import "server-only";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

function apiBase(): string {
  return process.env.SYNAPTECH_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:3101";
}

function ownerToken(): string {
  const token = process.env.SYNAPTECH_OWNER_TOKEN;
  if (!token) {
    throw new ApiClientError(500, "SYNAPTECH_OWNER_TOKEN tanımlı değil.");
  }
  return token;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${ownerToken()}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyKey) {
    headers.set("Idempotency-Key", init.idempotencyKey);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(503, "API'ye bağlanılamadı. Fastify çalışıyor mu?");
  }

  const json = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      json.error?.message || `API hatası (${response.status})`,
      json.error?.code,
    );
  }
  return json as T;
}

export async function apiAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${apiBase()}/api/system/health`, { cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean };
    return Boolean(body.ok);
  } catch {
    return false;
  }
}
