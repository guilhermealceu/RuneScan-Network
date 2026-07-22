import type { Device, ScanResult } from "../types";

export interface InventoryFilters {
  search: string;
  type: string;
  risk: string;
  segment: string;
  actionOnly: boolean;
}

export interface DeviceChange {
  kind: "new" | "removed" | "changed";
  newPorts: number[];
}

export interface ScanComparison {
  changes: Record<string, DeviceChange>;
  newCount: number;
  removedCount: number;
  newPortCount: number;
}

export interface DeviceProfile {
  key: string;
  name?: string;
  type?: Device["type"];
  fixedIp?: string;
  responsible?: string;
  department?: string;
  notes?: string;
  updatedAt: string;
}

export function deviceIdentityKey(device: Pick<Device, "ip" | "mac">) {
  return device.mac ? `mac:${device.mac.replace(/[^a-f0-9]/gi, "").toUpperCase()}` : `ip:${device.ip}`;
}

export function filterDevices(devices: Device[], filters: InventoryFilters) {
  const query = filters.search.trim().toLowerCase();
  return devices.filter((device) => {
    const searchable = [
      device.name, device.ip, device.mac, device.vendor, device.type, device.vlan, device.subnet,
      device.responsible, device.department, device.fixedIp, ...(device.openPorts || []).map(String),
    ].filter(Boolean).join(" ").toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (filters.type && device.type !== filters.type) return false;
    if (filters.risk && (device.riskLevel || "low") !== filters.risk) return false;
    if (filters.segment && device.subnet !== filters.segment && device.vlan !== filters.segment) return false;
    if (filters.actionOnly && !requiresAction(device)) return false;
    return true;
  });
}

export function requiresAction(device: Device) {
  return device.status === "online" && (device.riskLevel === "high" || device.riskLevel === "medium" || device.type === "unknown");
}

export function compareScans(previous: ScanResult | null, current: ScanResult): ScanComparison {
  const changes: Record<string, DeviceChange> = {};
  if (!previous) {
    const online = current.devices.filter((device) => device.status === "online");
    for (const device of online) changes[deviceIdentityKey(device)] = { kind: "new", newPorts: device.openPorts || [] };
    return { changes, newCount: online.length, removedCount: 0, newPortCount: online.reduce((sum, device) => sum + (device.openPorts?.length || 0), 0) };
  }

  const before = new Map(previous.devices.filter((device) => device.status === "online").map((device) => [deviceIdentityKey(device), device]));
  const after = new Map(current.devices.filter((device) => device.status === "online").map((device) => [deviceIdentityKey(device), device]));
  let newCount = 0;
  let removedCount = 0;
  let newPortCount = 0;

  for (const [key, device] of after) {
    const old = before.get(key);
    if (!old) {
      changes[key] = { kind: "new", newPorts: device.openPorts || [] };
      newCount += 1;
      newPortCount += device.openPorts?.length || 0;
      continue;
    }
    const oldPorts = new Set(old.openPorts || []);
    const newPorts = (device.openPorts || []).filter((port) => !oldPorts.has(port));
    if (newPorts.length) {
      changes[key] = { kind: "changed", newPorts };
      newPortCount += newPorts.length;
    }
  }
  for (const [key] of before) {
    if (!after.has(key)) {
      changes[key] = { kind: "removed", newPorts: [] };
      removedCount += 1;
    }
  }
  return { changes, newCount, removedCount, newPortCount };
}

export function applyDeviceProfiles(result: ScanResult, profiles: DeviceProfile[]): ScanResult {
  const byKey = new Map(profiles.map((profile) => [profile.key, profile]));
  return {
    ...result,
    devices: result.devices.map((device) => applyDeviceProfile(device, byKey.get(deviceIdentityKey(device)))),
  };
}

export function applyDeviceProfile(device: Device, profile?: DeviceProfile): Device {
  if (!profile) return device;
  return {
    ...device,
    name: profile.name?.trim() || device.name,
    type: profile.type || device.type,
    fixedIp: profile.fixedIp?.trim() || undefined,
    responsible: profile.responsible?.trim() || undefined,
    department: profile.department?.trim() || undefined,
    notes: profile.notes?.trim() || undefined,
    identitySource: "manual",
    evidence: Array.from(new Set([...(device.evidence || []), `Cadastro manual atualizado em ${profile.updatedAt}`])),
  };
}
