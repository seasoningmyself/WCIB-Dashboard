export type SignedOutRoute =
  | { type: "login" }
  | { type: "reset_confirm"; token: string | null }
  | { type: "reset_request" };

export function parseSignedOutRoute(
  hash: string,
  search: string,
): SignedOutRoute {
  const rawHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path, hashQuery = ""] = rawHash.split("?", 2);
  if (path !== "/reset-password" && path !== "/reset-password/confirm") {
    return { type: "login" };
  }

  const token =
    new URLSearchParams(hashQuery).get("token") ??
    new URLSearchParams(search).get("token");
  if (path === "/reset-password/confirm" || token !== null) {
    return { token, type: "reset_confirm" };
  }
  return { type: "reset_request" };
}

export function sanitizedResetUrl(
  pathname: string,
  search: string,
): string {
  const parameters = new URLSearchParams(search);
  parameters.delete("token");
  const nextSearch = parameters.toString();
  return `${pathname}${nextSearch === "" ? "" : `?${nextSearch}`}#/reset-password/confirm`;
}
