import { proxyToBackend } from "@/lib/backend";

// Thin BFF: browser → same-origin → backend /admin/message (Basic auth injected).
export async function POST(req: Request) {
  return proxyToBackend(req, "/admin/message");
}
