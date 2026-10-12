/**
 * Server-only bridge to the backend API. The web app owns no bot, DB, wallet keys
 * or trading logic — it only renders UI and forwards admin calls here, injecting
 * the Basic auth credentials so they never reach the browser.
 *
 * Required env (Vercel, server-side): BACKEND_URL, ADMIN_USER, ADMIN_PASSWORD.
 */
const BASE = process.env.BACKEND_URL ?? "";

export const backendConfigured = BASE.length > 0;

function authHeader(): string {
  const user = process.env.ADMIN_USER ?? "";
  const pass = process.env.ADMIN_PASSWORD ?? "";
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!BASE) throw new Error("BACKEND_URL is not set");
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
      authorization: authHeader(),
    },
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
