import type { PaySheetExportDocument } from "./api.js";

const DOWNLOAD_URL_LIFETIME_MS = 1_000;
const PRINT_URL_LIFETIME_MS = 120_000;

export interface ExportDownloadAnchor {
  download: string;
  href: string;
  rel: string;
  click(): void;
  remove(): void;
}

export interface ExportPrintWindow {
  closed: boolean;
  location: { replace(url: string): void };
  opener: unknown;
  addEventListener(type: "afterprint" | "load", listener: () => void): void;
  close(): void;
  focus(): void;
  print(): void;
  removeEventListener(type: "afterprint" | "load", listener: () => void): void;
}

export interface PaySheetExportResourceEnvironment {
  appendAnchor(anchor: ExportDownloadAnchor): void;
  cancelTimer(handle: unknown): void;
  createAnchor(): ExportDownloadAnchor;
  createObjectUrl(blob: Blob): string;
  openPrintWindow(): ExportPrintWindow | null;
  revokeObjectUrl(url: string): void;
  scheduleTimer(callback: () => void, delayMs: number): unknown;
}

export class PaySheetExportPopupBlockedError extends Error {
  constructor() {
    super("The print window was blocked");
    this.name = "PaySheetExportPopupBlockedError";
  }
}

export class PaySheetExportResourceError extends Error {
  constructor() {
    super("The export resource could not be opened");
    this.name = "PaySheetExportResourceError";
  }
}

export class PaySheetExportResources {
  private readonly environment: PaySheetExportResourceEnvironment;
  private readonly objectUrls = new Set<string>();
  private readonly printJobs = new Map<ExportPrintWindow, () => void>();
  private readonly timers = new Set<unknown>();

  constructor(environment: PaySheetExportResourceEnvironment = browserEnvironment) {
    this.environment = environment;
  }

  download(document: PaySheetExportDocument): void {
    if (document.format !== "excel") throw new PaySheetExportResourceError();
    const url = this.trackObjectUrl(document.blob);
    const anchor = this.environment.createAnchor();
    try {
      anchor.download = document.filename;
      anchor.href = url;
      anchor.rel = "noopener";
      this.environment.appendAnchor(anchor);
      anchor.click();
    } catch (error) {
      this.releaseObjectUrl(url);
      throw error;
    } finally {
      anchor.remove();
    }
    this.schedule(() => this.releaseObjectUrl(url), DOWNLOAD_URL_LIFETIME_MS);
  }

  openPrintWindow(): ExportPrintWindow {
    const popup = this.environment.openPrintWindow();
    if (popup === null) throw new PaySheetExportPopupBlockedError();
    try {
      popup.opener = null;
    } catch {
      popup.close();
      throw new PaySheetExportResourceError();
    }
    this.printJobs.set(popup, () => {
      this.printJobs.delete(popup);
      if (!popup.closed) popup.close();
    });
    return popup;
  }

  print(popup: ExportPrintWindow, document: PaySheetExportDocument): void {
    if (document.format !== "print" || !this.printJobs.has(popup)) {
      throw new PaySheetExportResourceError();
    }
    this.printJobs.delete(popup);
    const url = this.trackObjectUrl(document.blob);
    let cleaned = false;
    let timer: unknown;
    const cleanup = (closeWindow: boolean) => {
      if (cleaned) return;
      cleaned = true;
      popup.removeEventListener("load", onLoad);
      popup.removeEventListener("afterprint", onAfterPrint);
      if (timer !== undefined) this.cancelTimer(timer);
      this.releaseObjectUrl(url);
      this.printJobs.delete(popup);
      if (closeWindow && !popup.closed) popup.close();
    };
    const onLoad = () => {
      if (popup.closed) {
        cleanup(false);
        return;
      }
      try {
        popup.focus();
        popup.print();
      } catch {
        cleanup(true);
      }
    };
    const onAfterPrint = () => cleanup(false);
    this.printJobs.set(popup, () => cleanup(true));
    popup.addEventListener("load", onLoad);
    popup.addEventListener("afterprint", onAfterPrint);
    timer = this.schedule(() => cleanup(false), PRINT_URL_LIFETIME_MS);
    try {
      popup.location.replace(url);
    } catch {
      cleanup(true);
      throw new PaySheetExportResourceError();
    }
  }

  cancelPrint(popup: ExportPrintWindow): void {
    this.printJobs.get(popup)?.();
  }

  dispose(): void {
    for (const cancel of [...this.printJobs.values()]) cancel();
    this.printJobs.clear();
    for (const timer of [...this.timers]) this.cancelTimer(timer);
    for (const url of [...this.objectUrls]) this.releaseObjectUrl(url);
  }

  private cancelTimer(handle: unknown): void {
    if (!this.timers.delete(handle)) return;
    this.environment.cancelTimer(handle);
  }

  private releaseObjectUrl(url: string): void {
    if (!this.objectUrls.delete(url)) return;
    this.environment.revokeObjectUrl(url);
  }

  private schedule(callback: () => void, delayMs: number): unknown {
    let handle: unknown;
    handle = this.environment.scheduleTimer(() => {
      this.timers.delete(handle);
      callback();
    }, delayMs);
    this.timers.add(handle);
    return handle;
  }

  private trackObjectUrl(blob: Blob): string {
    const url = this.environment.createObjectUrl(blob);
    this.objectUrls.add(url);
    return url;
  }
}

const browserEnvironment: PaySheetExportResourceEnvironment = {
  appendAnchor(anchor) {
    document.body.append(anchor as HTMLAnchorElement);
  },
  cancelTimer(handle) {
    window.clearTimeout(handle as number);
  },
  createAnchor() {
    return document.createElement("a");
  },
  createObjectUrl(blob) {
    return URL.createObjectURL(blob);
  },
  openPrintWindow() {
    return window.open("about:blank", "_blank") as ExportPrintWindow | null;
  },
  revokeObjectUrl(url) {
    URL.revokeObjectURL(url);
  },
  scheduleTimer(callback, delayMs) {
    return window.setTimeout(callback, delayMs);
  },
};
