import assert from "node:assert/strict";
import test from "node:test";
import { mergeDevices } from "../src/server/discovery";
import type { Device } from "../src/types";

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: "device-10-1-1-201",
    name: "host-201",
    ip: "10.1.1.201",
    vendor: "Fabricante via OUI pendente",
    type: "unknown",
    vlan: "Sub-rede 10.1.1.0/24",
    status: "online",
    openPorts: [],
    services: [],
    source: "native",
    confidence: "low",
    ...overrides,
  };
}

test("coletor posterior completa nome, MAC e fabricante do host generico", () => {
  const devices = [device()];

  mergeDevices(devices, [device({
    name: "N000175",
    mac: "A8:3B:76:EC:3C:B3",
    vendor: "Cloud Network Technology Singapore PTE.",
    source: "nirsoft",
    confidence: "medium",
  })]);

  assert.equal(devices[0].name, "N000175");
  assert.equal(devices[0].mac, "A8:3B:76:EC:3C:B3");
  assert.equal(devices[0].vendor, "Cloud Network Technology Singapore PTE.");
  assert.equal(devices[0].confidence, "medium");
});

test("nome generico de outro coletor nao apaga um nome real", () => {
  const devices = [device({ name: "NOTE-FINANCEIRO" })];

  mergeDevices(devices, [device({ name: "host-201", source: "nmap", confidence: "high" })]);

  assert.equal(devices[0].name, "NOTE-FINANCEIRO");
  assert.equal(devices[0].confidence, "high");
});

test("fabricante TP-Link conhecido substitui o host generico por uma identidade util", () => {
  const devices = [device({ name: "host-2", ip: "10.1.1.2" })];

  mergeDevices(devices, [device({
    name: "host-2",
    ip: "10.1.1.2",
    vendor: "TP-Link Systems Inc.",
    source: "nmap",
  })]);

  assert.equal(devices[0].name, "TP-Link (equipamento de rede)");
  assert.equal(devices[0].type, "network");
  assert.equal(devices[0].identitySource, "detected");
});

test("promove fabricantes conhecidos sem sobrescrever um nome real", () => {
  const cases: Array<{ vendor: string; name: string; type: Device["type"] }> = [
    { vendor: "Ubiquiti Inc", name: "Ubiquiti (equipamento de rede)", type: "ap" },
    { vendor: "Proxmox Server Solutions GmbH", name: "Proxmox VM (funcao nao identificada)", type: "server" },
    { vendor: "Grandstream Networks Inc", name: "Grandstream (dispositivo VoIP)", type: "phone" },
  ];

  for (const item of cases) {
    const devices = [device()];
    mergeDevices(devices, [device({ vendor: item.vendor, source: "nmap" })]);
    assert.equal(devices[0].name, item.name);
    assert.equal(devices[0].type, item.type);
    assert.equal(devices[0].identitySource, "inferred");
  }
});
