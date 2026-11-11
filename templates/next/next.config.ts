import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // A self-contained server for the container image: no development tools at run time.
  output: "standalone",
  // Rule 7: nothing secret is ever exposed to the browser. Only NEXT_PUBLIC_* variables reach it,
  // and this template defines none.
  serverExternalPackages: ["pg"],
};

export default withNextIntl(nextConfig);
