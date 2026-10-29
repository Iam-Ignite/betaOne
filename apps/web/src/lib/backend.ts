/**
 * Server-only bridge to the backend API. The web app owns no bot, DB, wallet keys
 * or trading logic — it only renders UI and forwards admin calls here, injecting
 * authentication credentials (API_KEY or Basic auth) so they never reach the browser.
 *
 * Required env (Vercel, server-side):
 * - BACKEND_URL
 * - API_KEY (recommended) and/or ADMIN_USER + ADMIN_PASSWORD
 */
const BASE = (process.env.BACKEND_URL ?? "").replace(/\/+$/, "");

export const backendConfigured =
  BASE.length > 0 &&
  (Boolean(process.env.API_KEY) ||
    (Boolean(process.env.ADMIN_USER) && Boolean(process.env.ADMIN_PASSWORD)));

function authHeader(): string {
  const user = process.env.ADMIN_USER ?? "";
  const pass = process.env.ADMIN_PASSWORD ?? "";
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!BASE) throw new Error("BACKEND_URL is not set");

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  const apiKey = process.env.API_KEY;
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (user && pass) {
    headers["authorization"] = authHeader();
  } else if (apiKey && !headers["authorization"]) {
    headers["authorization"] = `Bearer ${apiKey}`;
  }

  return fetch(`${BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

/** Forward an incoming Next route request to the backend, preserving method/body/query. */
export async function proxyToBackend(req: Request, path: string): Promise<Response> {
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
  const res = await backendFetch(path, { method: req.method, body });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}
