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

// 2D 단위 벡터: 각도가 쿼리 [1,0]과의 정렬도를 그대로 나타낸다.
function unit(deg) {
  const rad = (deg * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

test("query-centroid evidence ignores generic clusters with one high outlier", () => {
  const query = unit(0);
  // generic 클러스터: 최상위 멤버 하나만 쿼리와 정렬(0.95), 나머지는 무관.
  // v1 증거(0.7×max)라면 이 클러스터 전체가 부스트를 받았다.
  const items = [
    { id: "g-top", similarity: 0.95, embedding: unit(18) },
    { id: "mid", similarity: 0.5, embedding: unit(60) },
    { id: "g-far1", similarity: 0.17, embedding: unit(80) },
    { id: "g-far2", similarity: 0.09, embedding: unit(85) },
  ];
  const clusters = [
    { id: "generic", itemIds: ["g-top", "mid", "g-far1", "g-far2"] },
  ];

  const result = rankMemoriesWithClusters(items, clusters, 4, query);

  assert.equal(result.usedClusterRanking, true);
  assert.equal(result.evidenceMode, "query_centroid");
  // mid의 leave-one-out centroid(18°, 80°, 85°)는 쿼리 정렬도가 자기 유사도
  // (0.5)보다 낮으므로 uplift가 없어야 한다.
  assert.equal(result.scoreByItemId.get("mid"), 0.5);
});

test("query-centroid evidence lifts members of query-aligned clusters", () => {
  const query = unit(0);
  const items = [
    { id: "a-top", similarity: 0.94, embedding: unit(20) },
    { id: "a-mid", similarity: 0.5, embedding: unit(60) },
    { id: "a-second", similarity: 0.87, embedding: unit(30) },
    { id: "b-mid", similarity: 0.5, embedding: unit(60) },
    { id: "b-far", similarity: 0.09, embedding: unit(85) },
    { id: "b-far2", similarity: 0.17, embedding: unit(80) },
  ];
  const clusters = [
    { id: "aligned", itemIds: ["a-top", "a-second", "a-mid"] },
    { id: "scattered", itemIds: ["b-mid", "b-far", "b-far2"] },
  ];

  const result = rankMemoriesWithClusters(items, clusters, 6, query);

  assert.equal(result.evidenceMode, "query_centroid");
  const aMid = result.scoreByItemId.get("a-mid");
  const bMid = result.scoreByItemId.get("b-mid");
  // 같은 개별 유사도(0.5)라도, 동료들이 쿼리와 정렬된 클러스터의 멤버만
  // 끌어올려져야 한다.
  assert.ok(aMid > 0.5, `expected a-mid uplift, got ${aMid}`);
  assert.ok(aMid > bMid, `expected a-mid(${aMid}) > b-mid(${bMid})`);
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
