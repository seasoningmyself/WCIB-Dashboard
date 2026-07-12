export type SessionEndReason = "expired" | "logout";

export interface SessionEndEvent {
  reason: SessionEndReason;
  returnPath: string | null;
}

export interface SessionBoundary {
  beginSession(): void;
  endSession(reason: SessionEndReason, returnPath?: string): boolean;
  registerSensitiveCleanup(cleanup: () => void): () => void;
}

export function createSessionBoundary(
  onSessionEnded: (event: SessionEndEvent) => void,
): SessionBoundary {
  const cleanups = new Set<() => void>();
  let active = false;

  return {
    beginSession() {
      active = true;
    },
    endSession(reason, returnPath) {
      if (!active) {
        return false;
      }
      active = false;
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch {
          // One cache must not prevent the remaining sensitive state cleanup.
        }
      }
      onSessionEnded({
        reason,
        returnPath:
          reason === "expired" ? safeInternalReturnPath(returnPath) : null,
      });
      return true;
    },
    registerSensitiveCleanup(cleanup) {
      cleanups.add(cleanup);
      return () => cleanups.delete(cleanup);
    },
  };
}

export function safeInternalReturnPath(
  value: string | undefined,
): string | null {
  if (value === undefined || value.length > 2_048) {
    return null;
  }
  const path = value.trim().split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith("/") || path.startsWith("//")) {
    return null;
  }
  return path.length > 1 && path.endsWith("/")
    ? path.slice(0, -1)
    : path;
}

export interface LogoutAction {
  isPending(): boolean;
  run(): boolean;
}

export function createLogoutAction(
  logout: () => Promise<void>,
  boundary: SessionBoundary,
): LogoutAction {
  let pending = false;
  return {
    isPending: () => pending,
    run() {
      if (pending || !boundary.endSession("logout")) {
        return false;
      }
      pending = true;
      void logout()
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
      return true;
    },
  };
}
