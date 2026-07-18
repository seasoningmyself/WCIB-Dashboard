export interface AutomaticSaveQueue {
  clear(): void;
  queue(): void;
  take(): boolean;
}

export function createAutomaticSaveQueue(): AutomaticSaveQueue {
  let queued = false;
  return {
    clear() {
      queued = false;
    },
    queue() {
      queued = true;
    },
    take() {
      const value = queued;
      queued = false;
      return value;
    },
  };
}
