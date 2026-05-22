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
  const mediumRisk = online.filter((device) => device.riskLevel === 'medium');
  const telnetCount = online.filter((device) => device.openPorts?.includes(23)).length;
  const sensitive = online.filter((device) => [21, 23, 135, 139, 445, 3389, 5900].some((port) => device.openPorts?.includes(port)));
  const web = online.filter((device) => device.evidence?.some((item) => item.toLowerCase().includes('web') || item.toLowerCase().includes('http')));
  
  const poolsHtml = (result?.vlans || [])
    .filter(v => v.onlineCount > 0)
    .map(v => `
      <div class="pool-row">
        <span>${escapeHtml(v.subnet)}</span>
        <strong>${v.onlineCount} ativos</strong>
      </div>
    `).join('');

  const rows = devices
    .sort((a, b) => riskOrder(b) - riskOrder(a) || ipToNumber(a.ip) - ipToNumber(b.ip))
    .map((device) => `
      <div class="device-card ${device.riskLevel || 'low'}">
        <div class="device-header">
          <div class="device-info">
            <div class="device-name">${escapeHtml(device.name)}</div>
            <div class="device-ip">${escapeHtml(device.ip)} <span class="vlan">/ ${escapeHtml(device.vlan)}</span></div>
          </div>
          <div class="badge-group">
            <span class="badge ${device.status}">${device.status === 'online' ? '● ONLINE' : '○ OFFLINE'}</span>
            <span class="badge risk-${device.riskLevel || 'low'}">RISCO ${escapeHtml(device.riskLevel || 'low').toUpperCase()}</span>
          </div>
        </div>
        
        <div class="device-grid">
          <div class="grid-item">
            <div class="grid-label">Tipo & Identidade</div>
            <div class="grid-value">${escapeHtml(device.type)} <small>${escapeHtml(device.vendor || 'Generic')} • ${escapeHtml(device.mac || 'No MAC')}</small></div>
          </div>
          <div class="grid-item">
            <div class="grid-label">Portas Abertas</div>
            <div class="grid-value font-mono">${escapeHtml(device.openPorts?.join(', ') || 'Nenhuma')}</div>
          </div>
        </div>

        ${device.services?.length ? `
        <div class="services-track">
          ${device.services.map(s => `
            <div class="service-pill">
              <strong>${s.port}/${s.protocol}</strong>
              <span>${escapeHtml(s.service || '')} ${escapeHtml(s.product || '')}</span>
            </div>
          `).join('')}
        </div>` : ''}

        <div class="evidence-box">
          <div class="grid-label">Evidências Detetadas</div>
          <div class="evidence-text">${escapeHtml(device.evidence?.join(' • ') || 'Descoberta Nativa')}</div>
        </div>
      </div>
    `).join('');

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RuneScan | Relatório Executivo - ${escapeHtml(result?.target || 'Rede')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f5f7f9;
      --surface: #ffffff;
      --border: #e2e8f0;
      --ink: #0f172a;
      --ink-muted: #64748b;
      --accent: #ff5f1f;
      --red: #ef4444;
      --orange: #f59e0b;
      --green: #10b981;
      --blue: #3b82f6;
    }
    
    * { box-sizing: border-box; }
    body { 
      margin: 0; 
      font-family: 'Inter', system-ui, sans-serif; 
      color: var(--ink); 
      background: var(--bg); 
      line-height: 1.5;
      padding-bottom: 80px;
    }
    
    .page { max-width: 1000px; margin: 0 auto; padding: 40px 20px; }
    
    .report-header {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 28px;
      padding: 45px;
      margin-bottom: 32px;
      box-shadow: 0 4px 20px -2px rgba(0,0,0,0.05);
    }
    
    .brand-section { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; border-bottom: 1px solid var(--border); padding-bottom: 25px; }
    .brand h1 { margin: 0; font-size: 38px; font-weight: 900; letter-spacing: -0.05em; color: var(--accent); }
    .brand p { margin: 4px 0 0; color: var(--ink-muted); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.15em; }
    .timestamp { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-muted); text-align: right; }
    
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 15px; margin-bottom: 35px; }
    .stat-card { background: #f8fafc; border: 1px solid var(--border); border-radius: 18px; padding: 22px; text-align: center; }
    .stat-label { font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-muted); margin-bottom: 8px; }
    .stat-value { font-size: 30px; font-weight: 900; font-family: 'JetBrains Mono', monospace; }
    
    .alert-box { 
      background: #fef2f2; 
      border: 1px solid #fee2e2; 
      border-radius: 20px; 
      padding: 25px; 
      margin-bottom: 30px;
    }
    .alert-title { font-size: 12px; font-weight: 900; color: var(--red); margin-bottom: 15px; text-transform: uppercase; letter-spacing: 0.1em; display: flex; align-items: center; gap: 8px; }
    .alert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .alert-item { display: flex; flex-direction: column; }
    .alert-val { font-size: 26px; font-weight: 900; color: var(--ink); }
    .alert-lab { font-size: 11px; font-weight: 600; color: var(--ink-muted); }

    .pools-box { background: #f0f9ff; border: 1px solid #e0f2fe; border-radius: 20px; padding: 25px; margin-bottom: 30px; }
    .pool-title { font-size: 12px; font-weight: 900; color: var(--blue); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.1em; }
    .pool-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .pool-row { display: flex; justify-content: space-between; padding: 8px 15px; background: white; border-radius: 10px; font-size: 11px; border: 1px solid #e0f2fe; }
    .pool-row strong { color: var(--blue); }

    .inventory-title { font-size: 20px; font-weight: 900; margin: 50px 0 25px; letter-spacing: -0.02em; padding-left: 12px; border-left: 4px solid var(--accent); }
    
    .device-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 22px;
      padding: 28px;
      margin-bottom: 20px;
      position: relative;
    }
    .device-card.high { border-left: 6px solid var(--red); }
    .device-card.medium { border-left: 6px solid var(--orange); }
    .device-card.low { border-left: 6px solid var(--green); }
    
    .device-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; }
    .device-name { font-size: 19px; font-weight: 800; letter-spacing: -0.03em; }
    .device-ip { font-family: 'JetBrains Mono', monospace; font-size: 14px; color: var(--accent); font-weight: 700; margin-top: 2px; }
    .vlan { font-weight: 500; opacity: 0.6; font-size: 0.9em; margin-left: 5px; }
    
    .badge { padding: 4px 12px; border-radius: 8px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
    .badge.risk-high { background: #fef2f2; color: var(--red); }
    .badge.risk-medium { background: #fff7ed; color: var(--orange); }
    .badge.risk-low { background: #f0fdf4; color: var(--green); }
    
    .device-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 20px; }
    .grid-label { font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-muted); margin-bottom: 5px; }
    .grid-value { font-size: 14px; font-weight: 700; color: var(--ink); }
    .font-mono { font-family: 'JetBrains Mono', monospace; font-size: 13px; }
    small { display: block; font-weight: 500; font-size: 11px; color: var(--ink-muted); margin-top: 2px; }

    .services-track { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .service-pill { background: #f1f5f9; border-radius: 10px; padding: 8px 12px; font-size: 12px; border: 1px solid #e2e8f0; }
    .service-pill strong { color: var(--ink); margin-right: 6px; }

    .evidence-box { background: #f8fafc; border-radius: 14px; padding: 15px 20px; border: 1px dashed var(--border); }
    .evidence-text { font-size: 11px; color: var(--ink-muted); line-height: 1.6; }

    footer { text-align: center; margin-top: 80px; font-size: 11px; color: var(--ink-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.2em; }
    
    @media print {
      body { background: white; padding: 0; }
      .page { padding: 0; max-width: 100%; }
      .device-card { break-inside: avoid; border: 1px solid #eee !important; box-shadow: none !important; }
      .report-header { box-shadow: none !important; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="report-header">
      <div class="brand-section">
        <div class="brand">
          <h1>RUNESCAN</h1>
          <p>Security & Intelligence Network Report</p>
        </div>
        <div class="timestamp">
          DATA: ${escapeHtml(new Date(timestamp).toLocaleDateString('pt-BR'))}<br>
          HORA: ${escapeHtml(new Date(timestamp).toLocaleTimeString('pt-BR'))}<br>
          ALVO: ${escapeHtml(result?.target || 'Rede Local')}
        </div>
      </div>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Descobertos</div>
          <div class="stat-value">${devices.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Online</div>
          <div class="stat-value" style="color:var(--green)">${online.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Risco Crítico</div>
          <div class="stat-value" style="color:var(--red)">${highRisk.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Web Surface</div>
          <div class="stat-value">${web.length}</div>
        </div>
      </div>

      <div class="alert-box">
        <div class="alert-title">🚨 Auditoria de Exposição Crítica</div>
        <div class="alert-grid">
          <div class="alert-item">
            <span class="alert-val">${telnetCount}</span>
            <span class="alert-lab">Instâncias Telnet (Legado/Vulnerável)</span>
          </div>
          <div class="alert-item">
            <span class="alert-val">${sensitive.length}</span>
            <span class="alert-lab">Acessos Sensíveis (RDP, SMB, SSH, VNC)</span>
          </div>
        </div>
      </div>

      <div class="pools-box">
        <div class="pool-title">📡 Distribuição por Pools / Subnets</div>
        <div class="pool-list">
          ${poolsHtml || 'Nenhum pool identificado.'}
        </div>
      </div>
    </div>

    <h2 class="inventory-title">Inventário Detalhado de Ativos</h2>
    ${rows}

    <footer>
      RuneScan Network Intelligence • pilgrims.dev • &copy; ${new Date().getFullYear()}
    </footer>
  </div>
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