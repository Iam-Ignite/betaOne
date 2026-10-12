import { proxyToBackend } from "@/lib/backend";

// Thin BFF: the browser calls this same-origin route (gated by proxy.ts basic auth);
// it forwards to the backend's /admin/ledger with the admin credentials injected.
export async function GET(req: Request) {
  const search = new URL(req.url).search;
  return proxyToBackend(req, `/admin/ledger${search}`);
}

export async function POST(req: Request) {
  return proxyToBackend(req, "/admin/ledger");
}
