import assert from "node:assert/strict";
import test from "node:test";
import { rankMemoriesWithClusters } from "./memoryClusterRetrieval.ts";

test("falls back to global cosine ranking without usable clusters", () => {
  const items = [
    { id: "m1", similarity: 0.9 },
    { id: "m2", similarity: 0.8 },
    { id: "m3", similarity: 0.7 },
  ];

  const result = rankMemoriesWithClusters(items, [], 2);

  assert.deepEqual(
    result.items.map((item) => item.id),
    ["m1", "m2"],
  );
  assert.equal(result.usedClusterRanking, false);
});

test("promotes related cluster context while preserving global top two", () => {
  const items = [
    { id: "m1", similarity: 1 },
    { id: "m2", similarity: 0.95 },
    { id: "m3", similarity: 0.9 },
    { id: "m4", similarity: 0.85 },
    { id: "m5", similarity: 0.8 },
    { id: "m6", similarity: 0.79 },
    { id: "m7", similarity: 0.78 },
  ];
  const clusters = [
    { id: "related", itemIds: ["m1", "m6", "m7"] },
    { id: "other", itemIds: ["m2", "m3"] },
  ];

  const result = rankMemoriesWithClusters(items, clusters, 5);
  const ids = result.items.map((item) => item.id);

  assert.equal(result.usedClusterRanking, true);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
  assert.ok(ids.includes("m1"));
  assert.ok(ids.includes("m2"));
  assert.ok(ids.includes("m6"));
  assert.ok(!ids.includes("m5"));
});

test("does not treat singleton membership as cluster evidence", () => {
  const items = [
    { id: "m1", similarity: 0.9 },
    { id: "m2", similarity: 0.8 },
  ];

  const result = rankMemoriesWithClusters(
    items,
    [{ id: "singleton", itemIds: ["m2"] }],
    1,
  );

  assert.deepEqual(
    result.items.map((item) => item.id),
    ["m1"],
  );
  assert.equal(result.usedClusterRanking, false);
});

test("falls back when cluster membership covers less than half of candidates", () => {
  const items = [
    { id: "m1", similarity: 0.9 },
    { id: "m2", similarity: 0.8 },
    { id: "m3", similarity: 0.7 },
    { id: "m4", similarity: 0.6 },
    { id: "m5", similarity: 0.5 },
  ];

  const result = rankMemoriesWithClusters(
    items,
    [{ id: "stale", itemIds: ["m1", "m5"] }],
    3,
  );

  assert.deepEqual(
    result.items.map((item) => item.id),
    ["m1", "m2", "m3"],
  );
  assert.equal(result.assignmentCoverage, 0.4);
  assert.equal(result.usedClusterRanking, false);
});
