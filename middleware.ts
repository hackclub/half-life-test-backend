import { NextResponse, type NextRequest } from "next/server"

/**
 * Security headers, and an optional HTTP basic auth gate for pre-launch.
 *
 * Deliberately does NOT do application auth: that lives in server components
 * (lib/page-guards) and route handlers (lib/guards), where it has access to the
 * database and can distinguish "not signed in" from "not permitted".
 */
function securityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Frame-Options", "DENY")
  res.headers.set("X-Content-Type-Options", "nosniff")
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  return res
}

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Half-Life"' },
  })
}

export function middleware(request: NextRequest) {
  if (process.env.REQUIRE_BASICAUTH === "true") {
    const expectedUser = process.env.BASICAUTH_USERNAME
    const expectedPass = process.env.BASICAUTH_PASSWORD
    if (expectedUser && expectedPass) {
      const header = request.headers.get("authorization") ?? ""
      const [scheme, encoded] = header.split(" ")
      if (scheme !== "Basic" || !encoded) return unauthorized()
      const [user, pass] = atob(encoded).split(":")
      if (user !== expectedUser || pass !== expectedPass) return unauthorized()
    }
  }

  return securityHeaders(NextResponse.next())
}

export const config = {
  matcher: [
    // `api/integrations` is excluded so turning on basic auth for a staging
    // deploy does not take every scheduled job red at once. `api/health` is
    // excluded so the container healthcheck keeps working either way.
    "/((?!_next/static|_next/image|favicon.ico|api/upload|api/integrations|api/health).*)",
  ],
}
