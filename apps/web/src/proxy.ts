import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };

// Next.js 16 renamed middleware to proxy.
// Protects /admin and /api/admin:
// 1. x-api-key header for programmatic/API access
// 2. Bearer token matching API_KEY
// 3. Basic auth with ADMIN_USER/ADMIN_PASSWORD or API_KEY as password/username
export function proxy(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const authHeader = req.headers.get("authorization");
  const validKey = process.env.API_KEY;
  const validUser = process.env.ADMIN_USER;
  const validPass = process.env.ADMIN_PASSWORD;

  // 1. Check x-api-key header
  if (apiKey && validKey && apiKey === validKey) {
    return NextResponse.next();
  }

  // 2. Check Bearer token
  if (authHeader?.startsWith("Bearer ") && validKey) {
    const token = authHeader.slice(7).trim();
    if (token === validKey) {
      return NextResponse.next();
    }
  }

  // 3. Check Basic auth
  if (authHeader?.startsWith("Basic ")) {
    try {
      const decoded = atob(authHeader.slice(6));
      const colonIdx = decoded.indexOf(":");
      if (colonIdx !== -1) {
        const u = decoded.slice(0, colonIdx);
        const p = decoded.slice(colonIdx + 1);

        // Matches ADMIN_USER / ADMIN_PASSWORD
        if (validUser && validPass && u === validUser && p === validPass) {
          return NextResponse.next();
        }
        // Also allow passing API_KEY as password (or username)
        if (validKey && (p === validKey || u === validKey)) {
          return NextResponse.next();
        }
      }
    } catch {
      // ignore base64 decode errors
    }
  }

  return new NextResponse("Auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="admin"' },
  });
}
