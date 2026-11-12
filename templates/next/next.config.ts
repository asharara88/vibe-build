import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // A self-contained server for the container image: no development tools at run time.
  output: "standalone",
  // Rule 7: nothing secret is ever exposed to the browser. Only NEXT_PUBLIC_* variables reach it,
  // and this template defines none.
  serverExternalPackages: ["pg"],
  // The image library sharp is deliberately not installed (its parts carry LGPL; owner's decision of
  // 12 Nov 2026), so Next.js must never try to optimise images with it.
  images: { unoptimized: true },
};

export default withNextIntl(nextConfig);
