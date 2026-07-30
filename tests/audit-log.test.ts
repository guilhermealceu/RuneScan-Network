import assert from "node:assert/strict";
import test from "node:test";
import { buildScanAuditRecord } from "../src/server/audit-log";

test("normaliza o registro de auditoria sem aceitar quebra de linha", () => {
  const record = buildScanAuditRecord({
    event: "completed",
    scanId: "scan-1",
    sourceIp: "10.1.1.2\nforjado",
    userAgent: "navegador\rteste",
    target: "10.1.1.0/24",
    transport: "stream",
    durationMs: 123.7,
    message: "ok\nforjado",
  }, new Date("2026-07-22T12:00:00.000Z"));

  assert.equal(record.timestamp, "2026-07-22T12:00:00.000Z");
  assert.equal(record.sourceIp, "10.1.1.2 forjado");
  assert.equal(record.durationMs, 124);
  assert.equal(record.message, "ok forjado");
});
