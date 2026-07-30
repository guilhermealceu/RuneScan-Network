export interface Device {
  id: string;
  name: string;
  ip: string;
  mac?: string;
  vendor?: string;
  type: 'router' | 'switch' | 'ap' | 'network' | 'workstation' | 'notebook' | 'phone' | 'tablet' | 'server' | 'camera' | 'printer' | 'iot' | 'unknown';
  vlan: string;
  status: 'online' | 'offline';
  parentId?: string;
  details?: string;
  openPorts?: number[];
  os?: string;
  lastSeen?: string;
  subnet?: string;
  source?: DiscoverySource;
  latencyMs?: number;
  confidence?: 'high' | 'medium' | 'low';
  riskLevel?: 'low' | 'medium' | 'high';
  services?: ServiceProbe[];
  evidence?: string[];
  fixedIp?: string;
  responsible?: string;
  department?: string;
  notes?: string;
  identitySource?: 'detected' | 'inferred' | 'manual';
}

export interface ScanResult {
  timestamp: string;
  mode: 'live';
  target: string;
  devices: Device[];
  vlans: VlanSummary[];
  discoveryNotes: string[];
  collectors: CollectorRun[];
  tools: ToolCapability[];
  localContext: LocalNetworkContext;
  summary: {
    total: number;
    online: number;
    vlans: number;
    subnets: number;
    openPorts: number;
    highRisk: number;
  };
}

export interface VlanSummary {
  id: string;
  name: string;
  subnet: string;
  deviceCount: number;
  onlineCount: number;
  confidence: 'inferred' | 'confirmed';
}

export type DiscoverySource = 'native' | 'arp' | 'dns' | 'tcp' | 'web' | 'nmap' | 'tshark' | 'netsh' | 'nirsoft' | 'snmp' | 'ssh' | 'manual';

export interface ServiceProbe {
  port: number;
  protocol: 'tcp' | 'udp';
  state: 'open' | 'closed' | 'filtered' | 'unknown';
  service?: string;
  product?: string;
}

export interface CollectorRun {
  id: string;
  name: string;
  status: 'ready' | 'running' | 'completed' | 'skipped' | 'failed';
  source: DiscoverySource;
  startedAt?: string;
  finishedAt?: string;
  items: number;
  message: string;
}

export interface ToolCapability {
  id: string;
  name: string;
  category: 'native' | 'active-scan' | 'passive-capture' | 'windows-utility' | 'ai' | 'planned';
  available: boolean;
  command?: string;
  version?: string;
  purpose: string;
  notes?: string;
}

export interface LocalNetworkContext {
  hostname: string;
  platform: string;
  interfaces: LocalInterface[];
  routes: RouteEntry[];
  defaultGateway?: string;
  activeInterface?: LocalInterface;
  hasStaticIp?: boolean;
  warning?: string;
}

export interface LocalInterface {
  name: string;
  address: string;
  netmask: string;
  cidr: string;
  mac?: string;
  internal: boolean;
  gateway?: string;
  dhcpEnabled?: boolean;
  isStaticIp?: boolean;
  connectionType?: 'wifi' | 'ethernet' | 'vpn' | 'virtual' | 'other';
  wifiSsid?: string;
  wifiSignal?: string;
  adapterDescription?: string;
}

export interface RouteEntry {
  destination: string;
  gateway: string;
  interfaceAddress?: string;
}
