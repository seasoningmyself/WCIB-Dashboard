import { apiBaseUrl } from "../config.js";

export type ApiRequestAccess = "protected" | "public";

export interface ApiRequestOptions extends RequestInit {
  access?: ApiRequestAccess;
}

export interface ApiClient {
  request(path: string, options?: ApiRequestOptions): Promise<Response>;
}

export type ApiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl?: string;
  fetchRequest?: ApiFetch;
  onUnauthorized(): void;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl ?? apiBaseUrl;
  const fetchRequest =
    options.fetchRequest ?? globalThis.fetch.bind(globalThis);

  return {
    async request(path, requestOptions = {}) {
      if (!path.startsWith("/") || path.startsWith("//")) {
        throw new Error("API paths must be root-relative suffixes");
      }
      const { access = "protected", ...init } = requestOptions;
      const response = await fetchRequest(`${baseUrl}${path}`, {
        ...init,
        credentials: "same-origin",
      });
      if (access === "protected" && response.status === 401) {
        options.onUnauthorized();
      }
      return response;
    },
  };
}
