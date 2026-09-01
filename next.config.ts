import type { NextConfig } from "next"

// `output: "standalone"` traces the whole dependency graph, which is what the
// container image needs and pure overhead for a local `yarn build`. Gate it on
// the two env vars that only ever appear in CI or a Docker build.
const isDeployBuild = !!(process.env.CI || process.env.DOCKER_BUILD)

const nextConfig: NextConfig = {
  ...(isDeployBuild && { output: "standalone" }),
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.slack-edge.com" },
      { protocol: "https", hostname: "cdn.hackclub.com" },
      // The R2 public host. A URL whose hostname is not listed here renders as
      // a broken image with no console error, so keep this in sync with S3_PUBLIC_URL.
      ...(process.env.NEXT_PUBLIC_UPLOAD_HOST
        ? [{ protocol: "https" as const, hostname: process.env.NEXT_PUBLIC_UPLOAD_HOST }]
        : []),
    ],
  },
}

export default nextConfig
