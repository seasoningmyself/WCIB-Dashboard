import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaySheetExportDocument } from "./api.js";
import {
  PaySheetExportPopupBlockedError,
  PaySheetExportResources,
  type ExportDownloadAnchor,
  type ExportPrintWindow,
  type PaySheetExportResourceEnvironment,
} from "./export-resources.js";

test("Excel download uses the server filename and revokes its object URL", () => {
  const fixture = createEnvironment();
  const resources = new PaySheetExportResources(fixture.environment);

  resources.download(exportDocument("excel"));

  assert.equal(fixture.anchor.download, "WCIB_Pay_Sheets_2026-07.xlsx");
  assert.equal(fixture.anchor.href, "blob:wcib-1");
  assert.equal(fixture.anchor.rel, "noopener");
  assert.equal(fixture.anchor.clicked, 1);
  assert.equal(fixture.anchor.removed, true);
  assert.deepEqual(fixture.revoked, []);
  fixture.runTimers();
  assert.deepEqual(fixture.revoked, ["blob:wcib-1"]);
});

test("print opens one isolated window, invokes print after load, and releases references", () => {
  const fixture = createEnvironment();
  const resources = new PaySheetExportResources(fixture.environment);
  const popup = resources.openPrintWindow() as FakePrintWindow;

  resources.print(popup, exportDocument("print"));
  assert.equal(popup.opener, null);
  assert.equal(popup.replacedWith, "blob:wcib-1");
  popup.emit("load");
  assert.equal(popup.focused, 1);
  assert.equal(popup.printed, 1);
  popup.emit("afterprint");
  assert.deepEqual(fixture.revoked, ["blob:wcib-1"]);
  assert.equal(popup.closed, false);

  resources.dispose();
  assert.equal(popup.closed, false);
});

test("popup denial and session disposal leave no object URL or window reference", () => {
  const blocked = createEnvironment({ blockPopup: true });
  const blockedResources = new PaySheetExportResources(blocked.environment);
  assert.throws(
    () => blockedResources.openPrintWindow(),
    PaySheetExportPopupBlockedError,
  );
  assert.equal(blocked.createdUrls.length, 0);

  const fixture = createEnvironment();
  const resources = new PaySheetExportResources(fixture.environment);
  const popup = resources.openPrintWindow() as FakePrintWindow;
  resources.print(popup, exportDocument("print"));
  resources.dispose();
  assert.equal(popup.closed, true);
  assert.deepEqual(fixture.revoked, ["blob:wcib-1"]);
  assert.equal(fixture.cancelledTimers, 1);

  resources.download(exportDocument("excel"));
  fixture.runTimers();
  assert.deepEqual(fixture.revoked, ["blob:wcib-1", "blob:wcib-2"]);
});

interface FakeAnchor extends ExportDownloadAnchor {
  clicked: number;
  removed: boolean;
}

class FakePrintWindow implements ExportPrintWindow {
  closed = false;
  focused = 0;
  opener: unknown = {};
  printed = 0;
  replacedWith: string | null = null;
  private readonly listeners = new Map<string, Set<() => void>>();
  readonly location = {
    replace: (url: string) => {
      this.replacedWith = url;
    },
  };

  addEventListener(type: "afterprint" | "load", listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: "afterprint" | "load"): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  focus(): void {
    this.focused += 1;
  }

  print(): void {
    this.printed += 1;
  }

  removeEventListener(type: "afterprint" | "load", listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
}

function createEnvironment(options: { blockPopup?: boolean } = {}) {
  const anchor: FakeAnchor = {
    clicked: 0,
    download: "",
    href: "",
    rel: "",
    removed: false,
    click() { this.clicked += 1; },
    remove() { this.removed = true; },
  };
  const createdUrls: string[] = [];
  const revoked: string[] = [];
  const timers = new Map<unknown, () => void>();
  let cancelledTimers = 0;
  const popup = new FakePrintWindow();
  const environment: PaySheetExportResourceEnvironment = {
    appendAnchor() {},
    cancelTimer(handle) {
      if (timers.delete(handle)) cancelledTimers += 1;
    },
    createAnchor: () => anchor,
    createObjectUrl() {
      const url = `blob:wcib-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    },
    openPrintWindow: () => options.blockPopup ? null : popup,
    revokeObjectUrl(url) { revoked.push(url); },
    scheduleTimer(callback) {
      const handle = { id: timers.size + 1 };
      timers.set(handle, callback);
      return handle;
    },
  };
  return {
    anchor,
    get cancelledTimers() { return cancelledTimers; },
    createdUrls,
    environment,
    popup,
    revoked,
    runTimers() {
      for (const callback of [...timers.values()]) callback();
    },
  };
}

function exportDocument(format: "excel" | "print"): PaySheetExportDocument {
  return {
    blob: new Blob([format]),
    filename: format === "excel"
      ? "WCIB_Pay_Sheets_2026-07.xlsx"
      : "WCIB_Pay_Sheets_2026-07.html",
    format,
  };
}
