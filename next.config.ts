import type { NextConfig } from "next";

function deploymentBasePath(value: string | undefined) {
  if (!value) return "";

  const isValid =
    value.startsWith("/") &&
    value !== "/" &&
    !value.endsWith("/") &&
    !value.includes("//") &&
    !value.includes("..") &&
    /^\/[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(value);

  if (!isValid) {
    throw new Error(
      "GARAK_BASE_PATH must be empty or an absolute path prefix without a trailing slash (for example, /garak).",
    );
  }

  return value;
}

const nextConfig: NextConfig = {
  // Sites and local development stay at `/`; the RPi image is built with
  // GARAK_BASE_PATH=/garak so its routes and assets survive a path proxy.
  basePath: deploymentBasePath(process.env.GARAK_BASE_PATH),
  output: process.env.GARAK_SELF_HOSTED === "1" ? "standalone" : undefined,
};

export default nextConfig;
