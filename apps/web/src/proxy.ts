import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };

// Next.js 16 renamed middleware to proxy. Protects /admin with basic auth;
// replace with real auth (e.g. NextAuth) for production.
export function proxy(req: NextRequest) {
  const h = req.headers.get("authorization");
  if (h?.startsWith("Basic ")) {
    const [u, p] = atob(h.slice(6)).split(":");
    if (u === process.env.ADMIN_USER && p === process.env.ADMIN_PASSWORD) {
      return NextResponse.next();
    }
  }
  return new NextResponse("Auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="admin"' },
  });
}
