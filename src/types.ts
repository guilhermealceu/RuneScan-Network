export interface Device {
  id: string;
  name: string;
  ip: string;
  mac?: string;
  vendor?: string;
  type: 'router' | 'switch' | 'ap' | 'workstation' | 'server' | 'camera' | 'printer' | 'iot' | 'unknown';
  vlan: string;
  status: 'online' | 'offline';
  parentId?: string;
  details?: string;
  openPorts?: number[];
  os?: string;
  lastSeen?: string;
}

export interface ScanResult {
  timestamp: string;
  devices: Device[];
  summary: {
    total: number;
    online: number;
    vlans: number;
    mode?: 'LIVE_PROD' | 'SIMULATION';
  };
}
