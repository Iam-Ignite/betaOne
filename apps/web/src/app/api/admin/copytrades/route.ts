import { proxyToBackend } from "@/lib/backend";

// Thin BFF: browser → same-origin → backend /admin/copytrades (Basic auth injected).
export async function GET(req: Request) {
  return proxyToBackend(req, "/admin/copytrades");
}
