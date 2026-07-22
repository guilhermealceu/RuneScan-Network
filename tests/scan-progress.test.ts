import assert from "node:assert/strict";
import test from "node:test";
import { buildProgressChanges, partialCollectorStatus } from "../src/server/discovery";
import type { CollectorRun, Device } from "../src/types";

test("progresso envia contagens e alteracoes sem repetir o inventario", () => {
  const devices = [
    { id: "1", ip: "10.1.1.1", name: "host-1", type: "router", vlan: "rede", status: "online" },
    { id: "2", ip: "10.1.1.2", name: "host-2", type: "unknown", vlan: "rede", status: "offline" },
  ] as Device[];
  const collectors = [
    { id: "native", name: "Native", source: "native", status: "completed", items: 2, message: "ok" },
  ] as CollectorRun[];

  const changes = buildProgressChanges(devices, collectors);
  assert.deepEqual(changes, {
    deviceCount: 2,
    onlineCount: 1,
    collectors: [{ id: "native", status: "completed", items: 2, message: "ok" }],
  });
  assert.equal("devices" in changes, false);
});

test("falha parcial preserva o coletor como concluido", () => {
  assert.equal(partialCollectorStatus(4, 3), "completed");
  assert.equal(partialCollectorStatus(4, 0), "failed");
  assert.equal(partialCollectorStatus(0, 0), "skipped");
});
