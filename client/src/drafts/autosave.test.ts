import assert from "node:assert/strict";
import { test } from "node:test";
import { createAutomaticSaveQueue } from "./autosave.js";

test("overlapping automatic saves coalesce into one follow-up write", () => {
  const queue = createAutomaticSaveQueue();

  queue.queue();
  queue.queue();
  assert.equal(queue.take(), true);
  assert.equal(queue.take(), false);

  queue.queue();
  queue.clear();
  assert.equal(queue.take(), false);
});
