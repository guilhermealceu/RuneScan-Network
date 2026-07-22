import assert from "node:assert/strict";
import test from "node:test";
import { applyDeviceProfiles, compareScans, deviceIdentityKey, filterDevices } from "../src/experience/inventory-experience";
import type { Device, ScanResult } from "../src/types";

function device(ip: string, overrides: Partial<Device> = {}): Device {
  return { id: ip, ip, name: `host-${ip.split('.').at(-1)}`, type: "unknown", vlan: "Rede A", subnet: "10.1.1.0/24", status: "online", openPorts: [], ...overrides };
}

function result(devices: Device[]): ScanResult {
  return { timestamp: new Date().toISOString(), mode: "live", target: "10.1.1.0/24", devices, vlans: [], discoveryNotes: [], collectors: [], tools: [], localContext: { hostname: "pc", platform: "win32", interfaces: [], routes: [] }, summary: { total: devices.length, online: devices.filter((item) => item.status === "online").length, vlans: 0, subnets: 1, openPorts: 0, highRisk: 0 } };
}

test("busca por nome, IP, fabricante, tipo e porta", () => {
  const devices = [device("10.1.1.10", { name: "XCC-SRV", vendor: "Lenovo", type: "server", openPorts: [443] }), device("10.1.1.20", { type: "printer", openPorts: [631] })];
  const base = { type: "", risk: "", segment: "", actionOnly: false };
  assert.equal(filterDevices(devices, { ...base, search: "lenovo" }).length, 1);
  assert.equal(filterDevices(devices, { ...base, search: "10.1.1.20" }).length, 1);
  assert.equal(filterDevices(devices, { ...base, search: "443" })[0].name, "XCC-SRV");
  assert.equal(filterDevices(devices, { ...base, search: "", type: "printer" }).length, 1);
});

test("modo somente acao inclui prioridade e tipo desconhecido", () => {
  const devices = [device("10.1.1.10", { type: "server", riskLevel: "low" }), device("10.1.1.20", { type: "printer", riskLevel: "high" }), device("10.1.1.30", { type: "unknown", riskLevel: "low" })];
  const filtered = filterDevices(devices, { search: "", type: "", risk: "", segment: "", actionOnly: true });
  assert.deepEqual(filtered.map((item) => item.ip), ["10.1.1.20", "10.1.1.30"]);
});

test("compara equipamento novo, removido e porta nova pelo MAC", () => {
  const previous = result([device("10.1.1.10", { mac: "AA:BB:CC:00:00:01", openPorts: [80] }), device("10.1.1.20", { mac: "AA:BB:CC:00:00:02" })]);
  const current = result([device("10.1.1.11", { mac: "AA:BB:CC:00:00:01", openPorts: [80, 443] }), device("10.1.1.30", { mac: "AA:BB:CC:00:00:03" })]);
  const comparison = compareScans(previous, current);
  assert.equal(comparison.newCount, 1);
  assert.equal(comparison.removedCount, 1);
  assert.equal(comparison.newPortCount, 1);
  assert.deepEqual(comparison.changes[deviceIdentityKey(current.devices[0])].newPorts, [443]);
});

test("cadastro manual prevalece e permanece ligado ao MAC", () => {
  const scan = result([device("10.1.1.199", { mac: "38:68:DD:36:67:AD" })]);
  const updated = applyDeviceProfiles(scan, [{ key: "mac:3868DD3667AD", name: "XCC Produção", type: "server", fixedIp: "10.1.1.199", responsible: "Infra", department: "TI", notes: "Rack 1", updatedAt: "2026-07-22T12:00:00.000Z" }]);
  assert.equal(updated.devices[0].name, "XCC Produção");
  assert.equal(updated.devices[0].responsible, "Infra");
  assert.equal(updated.devices[0].identitySource, "manual");
});
