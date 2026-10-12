import { proxyToBackend } from "@/lib/backend";

// Thin BFF: browser → same-origin → backend /admin/users (Basic auth injected).
export async function GET(req: Request) {
  const search = new URL(req.url).search;
  return proxyToBackend(req, `/admin/users${search}`);
}
