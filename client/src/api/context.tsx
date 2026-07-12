import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { SessionBoundary } from "../auth/session-boundary.js";
import type { ApiClient } from "./client.js";

interface ApiContextValue {
  client: ApiClient;
  registerSensitiveCleanup(cleanup: () => void): () => void;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiClientProvider({
  boundary,
  children,
  client,
}: {
  boundary: SessionBoundary;
  children: ReactNode;
  client: ApiClient;
}) {
  const value = useMemo<ApiContextValue>(
    () => ({
      client,
      registerSensitiveCleanup: (cleanup) =>
        boundary.registerSensitiveCleanup(cleanup),
    }),
    [boundary, client],
  );
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApiClient(): ApiClient {
  const context = useContext(ApiContext);
  if (context === null) {
    throw new Error("API client is unavailable");
  }
  return context.client;
}

export function useSensitiveSessionCleanup(cleanup: () => void): void {
  const context = useContext(ApiContext);
  useEffect(
    () => context?.registerSensitiveCleanup(cleanup),
    [cleanup, context],
  );
  if (context === null) {
    throw new Error("Session cleanup boundary is unavailable");
  }
}
