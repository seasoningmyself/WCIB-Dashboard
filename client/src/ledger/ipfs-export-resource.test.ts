import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IpfsExportResources,
  type IpfsDownloadAnchor,
  type IpfsExportEnvironment,
} from "./ipfs-export-resource.js";

test("IPFS CSV download uses the server filename and releases its object URL", () => {
  const fixture = environment();
  const resources = new IpfsExportResources(fixture.value);
  resources.download({
    blob: new Blob(["csv"]),
    filename: "WCIB_IPFS_Financed_2026-07-14.csv",
  });
  assert.equal(fixture.anchor.download, "WCIB_IPFS_Financed_2026-07-14.csv");
  assert.equal(fixture.anchor.href, "blob:ipfs-1");
  assert.equal(fixture.anchor.rel, "noopener");
  assert.equal(fixture.clicked, 1);
  assert.equal(fixture.anchorRemoved, 1);
  assert.equal(fixture.revoked.length, 0);
  fixture.runTimers();
  assert.deepEqual(fixture.revoked, ["blob:ipfs-1"]);
});

test("disposing IPFS export resources cancels timers and revokes URLs", () => {
  const fixture = environment();
  const resources = new IpfsExportResources(fixture.value);
  resources.download({ blob: new Blob(["csv"]), filename: "WCIB_IPFS_Financed_2026-07-14.csv" });
  resources.dispose();
  assert.equal(fixture.cancelled, 1);
  assert.deepEqual(fixture.revoked, ["blob:ipfs-1"]);
});

function environment() {
  let clicked = 0;
  let anchorRemoved = 0;
  let cancelled = 0;
  const timers = new Map<object, () => void>();
  const revoked: string[] = [];
  const anchor: IpfsDownloadAnchor = {
    click() { clicked += 1; },
    download: "",
    href: "",
    rel: "",
    remove() { anchorRemoved += 1; },
  };
  const value: IpfsExportEnvironment = {
    appendAnchor() {},
    cancelTimer(handle) { cancelled += 1; timers.delete(handle as object); },
    createAnchor: () => anchor,
    createObjectUrl: () => "blob:ipfs-1",
    revokeObjectUrl(url) { revoked.push(url); },
    scheduleTimer(callback) {
      const handle = {};
      timers.set(handle, callback);
      return handle;
    },
  };
  return {
    anchor,
    get anchorRemoved() { return anchorRemoved; },
    get cancelled() { return cancelled; },
    get clicked() { return clicked; },
    revoked,
    runTimers() { for (const callback of [...timers.values()]) callback(); },
    value,
  };
}
