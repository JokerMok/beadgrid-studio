import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudSyncKey, validCloudSync } from "../src/cloud-sync.ts";
import { blank, serialize, deserialize } from "../src/model.ts";

test("同步元数据限定账号、服务来源及作品，且不通过项目文件导入导出", () => {
  const p = blank(16, 16);
  const sync = {
    source: "https://example.test/api",
    userId: 1,
    projectId: p.id,
    updated: 12345,
  };
  p.cloudSync = sync;
  assert.deepEqual(validCloudSync(sync, p.id), sync);
  assert.equal(validCloudSync(sync, "different-id"), undefined);
  assert.equal(validCloudSync({ ...sync, updated: NaN }, p.id), undefined);
  assert.equal(
    validCloudSync({ ...sync, source: "file:///api" }, p.id),
    undefined,
  );
  assert.equal(
    validCloudSync({ ...sync, source: "https://example.test/api?x=1" }, p.id),
    undefined,
  );
  assert.equal(validCloudSync({ ...sync, userId: 0 }, p.id), undefined);
  assert.notEqual(
    cloudSyncKey(sync.source, 1, p.id),
    cloudSyncKey(sync.source, 2, p.id),
  );
  assert.notEqual(
    cloudSyncKey(sync.source, 1, p.id),
    cloudSyncKey("https://other.test/api", 1, p.id),
  );
  assert.equal("cloudSync" in serialize(p), false);
  assert.equal(
    deserialize({ ...serialize(p), cloudSync: sync }).cloudSync,
    undefined,
  );
});
