import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryCacheRecord, INVENTORY_CACHE_VERSION, parseInventoryCacheRecord, parseLegacyInventory } from "../src/storage/inventory-cache";
import type { ScanResult } from "../src/types";

const result: ScanResult = {
  timestamp: "2026-07-22T12:00:00.000Z",
  mode: "live",
  target: "10.1.1.0/24",
  devices: [],
  vlans: [],
  discoveryNotes: [],
  collectors: [],
  tools: [],
  localContext: { hostname: "pc", platform: "win32", interfaces: [], routes: [] },
  summary: { total: 0, online: 0, vlans: 0, subnets: 0, openPorts: 0, highRisk: 0 },
};

test("cria cache versionado com validade de 30 dias", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const record = createInventoryCacheRecord(result, now);
  assert.equal(record.schemaVersion, INVENTORY_CACHE_VERSION);
  assert.equal(record.savedAt, now.toISOString());
  assert.equal(record.expiresAt, "2026-08-21T12:00:00.000Z");
  assert.equal(parseInventoryCacheRecord(record, now)?.result.target, "10.1.1.0/24");
});

test("ignora cache expirado ou de versao desconhecida", () => {
  const record = createInventoryCacheRecord(result, new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(parseInventoryCacheRecord(record, new Date("2026-02-01T00:00:00.000Z")), null);
  assert.equal(parseInventoryCacheRecord({ ...record, schemaVersion: 999 }, new Date("2026-01-02T00:00:00.000Z")), null);
});

test("migra somente inventario legado estruturalmente valido", () => {
  assert.equal(parseLegacyInventory(JSON.stringify(result))?.target, result.target);
  assert.equal(parseLegacyInventory("{invalido"), null);
  assert.equal(parseLegacyInventory(JSON.stringify({ target: "10.1.1.0/24" })), null);
});
