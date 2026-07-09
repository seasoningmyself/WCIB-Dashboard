const DEFAULT_API_BASE_URL = "/api";

export function readApiBaseUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_API_BASE_URL;
  }

  const apiBaseUrl = value.trim();
  const isRootRelative = apiBaseUrl.startsWith("/");
  let isHttpUrl = false;

  try {
    const url = new URL(apiBaseUrl);
    isHttpUrl = url.protocol === "http:" || url.protocol === "https:";
  } catch {
    isHttpUrl = false;
  }

  if (!isRootRelative && !isHttpUrl) {
    throw new Error(
      "VITE_API_BASE_URL must be an HTTP(S) URL or a root-relative path",
    );
  }

  return apiBaseUrl === "/" ? apiBaseUrl : apiBaseUrl.replace(/\/+$/, "");
}

export const apiBaseUrl = readApiBaseUrl(import.meta.env?.VITE_API_BASE_URL);
