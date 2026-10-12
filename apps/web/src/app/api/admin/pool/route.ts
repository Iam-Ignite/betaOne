import { proxyToBackend } from "@/lib/backend";

// Thin BFF: browser → same-origin → backend /admin/pool (Basic auth injected).
export async function GET(req: Request) {
  return proxyToBackend(req, "/admin/pool");
}

export async function POST(req: Request) {
  return proxyToBackend(req, "/admin/pool");
}
