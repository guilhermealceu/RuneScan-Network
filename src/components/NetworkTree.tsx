import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Device, ScanResult } from '../types';
import { 
  Network, 
  Server, 
  Monitor, 
  Printer, 
  Wifi, 
  Camera,
  ChevronRight,
  Activity,
  Cpu,
  CircleHelp,
  Globe,
  FileDown,
  FileText
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const getIcon = (type: Device['type']) => {
  switch (type) {
    case 'router': return <Network className="w-5 h-5" />;
    case 'switch': return <Activity className="w-5 h-5" />;
    case 'ap': return <Wifi className="w-5 h-5" />;
    case 'workstation': return <Monitor className="w-5 h-5" />;
    case 'server': return <Server className="w-5 h-5" />;
    case 'camera': return <Camera className="w-5 h-5" />;
    case 'printer': return <Printer className="w-5 h-5" />;
    case 'iot': return <Cpu className="w-5 h-5" />;
    default: return <CircleHelp className="w-5 h-5" />;
  }
};

interface TreeNodeProps {
  device: Device;
  childrenDevices: Device[];
  allDevices: Device[];
  onSelect: (device: Device) => void;
  level?: number;
}

const TreeNode: React.FC<TreeNodeProps> = ({ device, childrenDevices, allDevices, onSelect, level = 0 }) => {
  const hasWebFingerprint = device.evidence?.some((item) => item.toLowerCase().startsWith('web fingerprint:'));

  return (
    <div className="flex flex-col">
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={() => onSelect(device)}
        className={cn(
          "group flex items-center gap-3 p-3 cursor-pointer border-b border-black/5 transition-colors",
          "hover:bg-scan-ink hover:text-white",
          device.status === 'offline' && "opacity-50 grayscale"
        )}
        style={{ paddingLeft: `${(level + 1) * 1.5}rem` }}
      >
        <div className="flex-shrink-0">
          {getIcon(device.type)}
        </div>
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium truncate">{device.name}</span>
            {hasWebFingerprint && (
              <Globe className="h-3.5 w-3.5 flex-shrink-0 text-green-600 group-hover:text-white" aria-label="Web identificado" />
            )}
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                device.status === 'offline' ? "bg-black/30" : device.riskLevel === 'high' ? "bg-red-500 animate-pulse" : device.riskLevel === 'medium' ? "bg-orange-500" : "bg-green-500 animate-pulse"
              )}
              title={device.status === 'offline' ? 'Offline na ultima varredura' : device.riskLevel === 'high' ? 'Online com risco alto' : device.riskLevel === 'medium' ? 'Online com risco medio' : 'Online'}
            />
          </div>
          <div className="flex items-center gap-2 text-[10px] opacity-60">
            <span className="font-mono">{device.ip}</span>
            <span>/</span>
            <span className="italic">{device.vlan}</span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
      </motion.div>
      
      {childrenDevices.length > 0 && (
        <div className="flex flex-col">
          {childrenDevices.map(child => (
            <TreeNode 
              key={child.id} 
              device={child} 
              childrenDevices={allDevices.filter(d => d.parentId === child.id)}
              allDevices={allDevices}
              onSelect={onSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface NetworkTreeProps {
  result: ScanResult | null;
  devices: Device[];
  onSelectDevice: (device: Device) => void;
}

export const NetworkTree: React.FC<NetworkTreeProps> = ({ result, devices, onSelectDevice }) => {
  // Encontra dispositivos raiz (sem parentId ou cujo parentId nao existe na lista).
  const rootDevices = useMemo(() => {
    return devices.filter(d => !d.parentId || !devices.find(p => p.id === d.parentId));
  }, [devices]);

  return (
    <div className="panel-surface flex flex-col overflow-hidden rounded-xl">
      <div className="flex items-center justify-between bg-scan-ink p-4 text-white">
        <h3 className="font-serif italic text-sm uppercase tracking-wider">Topologia de Rede</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportScanReport(result, devices)}
            disabled={!devices.length}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-white/70 transition hover:bg-white hover:text-scan-ink disabled:cursor-not-allowed disabled:opacity-30"
            title="Exportar relatorio JSON completo da varredura"
            aria-label="Exportar relatorio JSON"
          >
            <FileDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exportHtmlReport(result, devices)}
            disabled={!devices.length}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-white/70 transition hover:bg-white hover:text-scan-ink disabled:cursor-not-allowed disabled:opacity-30"
            title="Exportar relatorio HTML executivo"
            aria-label="Exportar relatorio HTML"
          >
            <FileText className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-grow overflow-y-auto max-h-[600px]">
        {rootDevices.map(device => (
          <TreeNode 
            key={device.id} 
            device={device} 
            childrenDevices={devices.filter(d => d.parentId === device.id)}
            allDevices={devices}
            onSelect={onSelectDevice}
          />
        ))}
        {devices.length === 0 && (
          <div className="p-12 text-center text-sm font-mono opacity-50 italic">
            Nenhum dispositivo encontrado na varredura.
          </div>
        )}
      </div>
    </div>
  );
};

function exportScanReport(result: ScanResult | null, devices: Device[]) {
  if (!devices.length) return;
  const timestamp = new Date().toISOString();
  const payload = {
    schema: 'runescan-network-report/v1',
    exportedAt: timestamp,
    purpose: 'Detailed RuneScan Network export for technical validation and assistant review.',
    scan: result ? {
      timestamp: result.timestamp,
      mode: result.mode,
      target: result.target,
      summary: result.summary,
      vlans: result.vlans,
      discoveryNotes: result.discoveryNotes,
      collectors: result.collectors,
      tools: result.tools,
      localContext: result.localContext,
    } : null,
    devices: devices.map((device) => ({
      id: device.id,
      name: device.name,
      ip: device.ip,
      mac: device.mac || null,
      vendor: device.vendor || null,
      type: device.type,
      vlan: device.vlan,
      status: device.status,
      parentId: device.parentId || null,
      details: device.details || null,
      openPorts: device.openPorts || [],
      os: device.os || null,
      lastSeen: device.lastSeen || null,
      subnet: device.subnet || null,
      source: device.source || null,
      latencyMs: device.latencyMs || null,
      confidence: device.confidence || null,
      riskLevel: device.riskLevel || null,
      services: device.services || [],
      evidence: device.evidence || [],
    })),
  };

  downloadTextFile(JSON.stringify(payload, null, 2), `runescan-report-${timestamp.replace(/[:.]/g, '-')}.json`, 'application/json');
}

function exportHtmlReport(result: ScanResult | null, devices: Device[]) {
  if (!devices.length) return;
  const timestamp = new Date().toISOString();
  const online = devices.filter((device) => device.status === 'online');
  const highRisk = online.filter((device) => device.riskLevel === 'high');
  const sensitive = online.filter((device) => [23, 135, 139, 445, 3389].some((port) => device.openPorts?.includes(port)));
  const web = online.filter((device) => device.evidence?.some((item) => item.toLowerCase().startsWith('web fingerprint:')));
  const rows = devices
    .sort((a, b) => riskOrder(b) - riskOrder(a) || ipToNumber(a.ip) - ipToNumber(b.ip))
    .map((device) => `
      <tr>
        <td><strong>${escapeHtml(device.name)}</strong><br><span>${escapeHtml(device.ip)}</span></td>
        <td>${escapeHtml(device.type)}</td>
        <td><span class="risk ${device.riskLevel || 'low'}">${escapeHtml(device.riskLevel || 'low')}</span></td>
        <td>${escapeHtml(device.openPorts?.join(', ') || '-')}</td>
        <td>${escapeHtml((device.services || []).map((service) => `${service.port}/${service.protocol} ${service.service || ''} ${service.product || ''}`).join(' | ') || '-')}</td>
        <td>${escapeHtml((device.evidence || []).slice(0, 4).join(' | ') || '-')}</td>
      </tr>
    `).join('');

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RuneScan Network Report</title>
  <style>
    body { margin: 0; font-family: Inter, Arial, sans-serif; color: #101418; background: #eef2f4; }
    .page { max-width: 1180px; margin: 0 auto; padding: 32px; }
    header { background: #fff; border: 1px solid #d9dde0; border-radius: 18px; padding: 26px; box-shadow: 0 18px 42px rgba(16,20,24,.08); }
    h1 { margin: 0; font-size: 34px; }
    .muted { color: #667078; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 18px 0; }
    .card { background: #fff; border: 1px solid #d9dde0; border-radius: 14px; padding: 14px; }
    .label { color: #899198; text-transform: uppercase; letter-spacing: .12em; font-size: 10px; font-weight: 800; }
    .value { margin-top: 8px; font-family: "Source Code Pro", Consolas, monospace; font-size: 24px; font-weight: 900; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; background: #fff; border: 1px solid #d9dde0; border-radius: 16px; overflow: hidden; }
    th, td { padding: 12px; border-bottom: 1px solid #edf0f2; text-align: left; vertical-align: top; font-size: 12px; }
    th { background: #f7f9fa; color: #6d757c; text-transform: uppercase; letter-spacing: .1em; font-size: 10px; }
    tr:last-child td { border-bottom: 0; }
    td span { color: #7b838a; font-family: "Source Code Pro", Consolas, monospace; font-size: 11px; }
    .risk { display: inline-block; border-radius: 999px; padding: 4px 8px; font-weight: 800; text-transform: uppercase; font-size: 10px; }
    .risk.high { background: #fee2e2; color: #b91c1c; }
    .risk.medium { background: #ffedd5; color: #c2410c; }
    .risk.low { background: #dcfce7; color: #15803d; }
  </style>
</head>
<body>
  <main class="page">
    <header>
      <h1>RuneScan Network Report</h1>
      <p class="muted">Gerado em ${escapeHtml(new Date(timestamp).toLocaleString())}${result ? ` / alvo ${escapeHtml(result.target)}` : ''}</p>
      <div class="grid">
        <div class="card"><div class="label">Ativos</div><div class="value">${devices.length}</div></div>
        <div class="card"><div class="label">Online</div><div class="value">${online.length}</div></div>
        <div class="card"><div class="label">Risco alto</div><div class="value">${highRisk.length}</div></div>
        <div class="card"><div class="label">Sensíveis</div><div class="value">${sensitive.length}</div></div>
        <div class="card"><div class="label">Web ID</div><div class="value">${web.length}</div></div>
      </div>
      <p class="muted">Topologia e VLANs sao inferidas quando nao houver SNMP/SSH/LLDP/CDP confirmando camada fisica.</p>
    </header>
    <section style="margin-top:18px">
      <table>
        <thead><tr><th>Host</th><th>Tipo</th><th>Risco</th><th>Portas</th><th>Serviços</th><th>Evidências</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;

  downloadTextFile(html, `runescan-report-${timestamp.replace(/[:.]/g, '-')}.html`, 'text/html');
}

function downloadTextFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function riskOrder(device: Device) {
  if (device.riskLevel === 'high') return 3;
  if (device.riskLevel === 'medium') return 2;
  if (device.status === 'online') return 1;
  return 0;
}

function ipToNumber(ip: string) {
  return ip.split('.').reduce((total, part) => ((total << 8) + Number(part)) >>> 0, 0);
}
