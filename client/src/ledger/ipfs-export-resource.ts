import type { IpfsWorkQueueDocument } from "./api.js";

const DOWNLOAD_URL_LIFETIME_MS = 1_000;

export interface IpfsDownloadAnchor {
  download: string;
  href: string;
  rel: string;
  click(): void;
  remove(): void;
}

export interface IpfsExportEnvironment {
  appendAnchor(anchor: IpfsDownloadAnchor): void;
  cancelTimer(handle: unknown): void;
  createAnchor(): IpfsDownloadAnchor;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  scheduleTimer(callback: () => void, delayMs: number): unknown;
}

export class IpfsExportResources {
  private readonly objectUrls = new Set<string>();
  private readonly timers = new Set<unknown>();

  constructor(private readonly environment: IpfsExportEnvironment = browserEnvironment) {}

  download(document: IpfsWorkQueueDocument): void {
    const url = this.environment.createObjectUrl(document.blob);
    this.objectUrls.add(url);
    const anchor = this.environment.createAnchor();
    try {
      anchor.download = document.filename;
      anchor.href = url;
      anchor.rel = "noopener";
      this.environment.appendAnchor(anchor);
      anchor.click();
    } catch (error) {
      this.release(url);
      throw error;
    } finally {
      anchor.remove();
    }
    let handle: unknown;
    handle = this.environment.scheduleTimer(() => {
      this.timers.delete(handle);
      this.release(url);
    }, DOWNLOAD_URL_LIFETIME_MS);
    this.timers.add(handle);
  }

  dispose(): void {
    for (const timer of [...this.timers]) {
      this.environment.cancelTimer(timer);
      this.timers.delete(timer);
    }
    for (const url of [...this.objectUrls]) this.release(url);
  }

  private release(url: string): void {
    if (!this.objectUrls.delete(url)) return;
    this.environment.revokeObjectUrl(url);
  }
}

const browserEnvironment: IpfsExportEnvironment = {
  appendAnchor(anchor) { document.body.appendChild(anchor as unknown as Node); },
  cancelTimer(handle) { window.clearTimeout(handle as number); },
  createAnchor: () => document.createElement("a"),
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  scheduleTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
};
