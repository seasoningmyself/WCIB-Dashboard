import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ActiveVocabularyResponse } from "../../../shared/vocabulary.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { loadActiveVocabulary } from "./api.js";

export type VocabularyLoadState =
  | { status: "error" }
  | { status: "loading" }
  | { data: ActiveVocabularyResponse; status: "ready" };

interface VocabularyContextValue {
  retry(): void;
  state: VocabularyLoadState;
}

const VocabularyContext = createContext<VocabularyContextValue | null>(null);

export function VocabularyProvider({ children }: { children: ReactNode }) {
  const client = useApiClient();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<VocabularyLoadState>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void loadActiveVocabulary(client)
      .then((data) => {
        if (active) {
          setState({ data, status: "ready" });
        }
      })
      .catch(() => {
        if (active) {
          setState({ status: "error" });
        }
      });
    return () => {
      active = false;
    };
  }, [attempt, client]);

  const clear = useCallback(() => {
    setState({ status: "loading" });
  }, []);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);
  useSensitiveSessionCleanup(clear);

  return (
    <VocabularyContext.Provider
      value={{
        retry,
        state,
      }}
    >
      {children}
    </VocabularyContext.Provider>
  );
}

export function useVocabulary(): VocabularyContextValue {
  const context = useContext(VocabularyContext);
  if (context === null) {
    throw new Error("Vocabulary provider is unavailable");
  }
  return context;
}
