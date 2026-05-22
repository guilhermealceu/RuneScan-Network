import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, animate, useMotionValue, useTransform } from 'motion/react';
import { ReactFlow, Background, Controls, Handle, Position, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CollectorRun, Device, LocalNetworkContext, ScanResult, ToolCapability } from '../types';
import { NetworkTree } from './NetworkTree';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  ChartNoAxesCombined,
  Cpu,
  ExternalLink,
  FileSearch,
  Globe,
  Info,
  KeyRound,
  LayoutGrid,
  Lock,
  Monitor,
  Network,
  Sparkles,
  PlugZap,
  Radar,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  Unplug,
  Video,
  Zap,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, LineChart, Line, XAxis, YAxis } from 'recharts';

interface AppConfig {
  defaultCidr: string;
  defaultScope: string;
  liveScanEnabled: boolean;
  tools: ToolCapability[];
  localContext: LocalNetworkContext;
}

interface ScanProgressEvent {
  type: 'stage' | 'snapshot' | 'log';
  stage: string;
  message: string;
  timestamp: string;
  result?: ScanResult;
}

interface DiagnosticResult {
  source: string;
  rows: Record<string, string>[];
  error?: string;
}

const STORAGE_KEY = 'runescan:last-result';

export const NetworkDashboard: React.FC = () => {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [networkAnalysis, setNetworkAnalysis] = useState<string | null>(null);
  const [networkAnalysisOpen, setNetworkAnalysisOpen] = useState(false);
  const [networkAnalyzing, setNetworkAnalyzing] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState<string | null>(null);
  const [poolDiscovery, setPoolDiscovery] = useState<DiagnosticResult | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [target, setTarget] = useState('192.168.1.0/24');
  const [useNmap, setUseNmap] = useState(true);
  const [useNirsoft, setUseNirsoft] = useState(false);
  const [useWebFingerprint, setUseWebFingerprint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [progress, setProgress] = useState<ScanProgressEvent[]>([]);
  const [currentStage, setCurrentStage] = useState('aguardando');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [collectorsOpen, setCollectorsOpen] = useState(false);
  const [headerCompact, setHeaderCompact] = useState(false);
  const [insightsVisible, setInsightsVisible] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const previousScanRef = useRef<ScanResult | null>(null);

  const tools = scanResult?.tools || config?.tools || [];
  const localContext = scanResult?.localContext || config?.localContext;

  const devicesByRisk = useMemo(() => {
    const devices = scanResult?.devices || [];
    return {
      high: devices.filter((device) => device.riskLevel === 'high').length,
      medium: devices.filter((device) => device.riskLevel === 'medium').length,
      low: devices.filter((device) => device.riskLevel === 'low').length,
    };
  }, [scanResult]);
  const highRiskDevices = useMemo(() => {
    return (scanResult?.devices || []).filter((device) => device.riskLevel === 'high');
  }, [scanResult]);

  const enterWorkMode = () => setHeaderCompact(true);

  const performScan = async () => {
    enterWorkMode();
    eventSourceRef.current?.close();
    previousScanRef.current = scanResult;
    setLoading(true);
    setAiAnalysis(null);
    setError(null);
    setProgress([]);
    setCurrentStage('iniciando');

    const params = new URLSearchParams({
      target,
      useNmap: String(useNmap),
      useNirsoft: String(useNirsoft),
      useWebFingerprint: String(useWebFingerprint),
    });
    const source = new EventSource(`/api/scan/stream?${params.toString()}`);
    eventSourceRef.current = source;

    source.addEventListener('progress', (event) => {
      const payload = JSON.parse(event.data) as ScanProgressEvent;
      setCurrentStage(payload.stage);
      setProgress((items) => [payload, ...items].slice(0, 12));
      if (payload.result) {
        setScanResult(payload.result);
      }
    });

    source.addEventListener('done', (event) => {
      const payload = JSON.parse(event.data) as ScanResult;
      const merged = mergeOfflineDevices(previousScanRef.current, payload, target);
      setScanResult(merged);
      previousScanRef.current = null;
      setCurrentStage('finalizado');
      setProgress((items) => [{
        type: 'stage',
        stage: 'done',
        message: 'Varredura finalizada.',
        timestamp: new Date().toISOString(),
      }, ...items].slice(0, 12));
      setLoading(false);
      source.close();
      eventSourceRef.current = null;
    });

    source.addEventListener('error', (event) => {
      if ('data' in event && typeof event.data === 'string' && event.data) {
        const payload = JSON.parse(event.data) as { message: string };
        setError(payload.message);
      } else {
        setError('Conexao de progresso interrompida. O ultimo resultado preservado continua na tela.');
      }
      setLoading(false);
      source.close();
      eventSourceRef.current = null;
    });
  };

  const clearInventory = () => {
    enterWorkMode();
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    previousScanRef.current = null;
    window.localStorage.removeItem(STORAGE_KEY);
    setScanResult(null);
    setSelectedDevice(null);
    setAiAnalysis(null);
    setDiagnostic(null);
    setPoolDiscovery(null);
    setProgress([]);
    setCurrentStage('aguardando');
    setError(null);
    setLoading(false);
  };

  const discoverNetworkPools = async () => {
    enterWorkMode();
    setPoolLoading(true);
    setPoolDiscovery(null);
    setError(null);
    try {
      const params = new URLSearchParams({ target });
      const response = await fetch(`/api/diagnostics/pools?${params.toString()}`);
      const data = await response.json();
      setPoolDiscovery(response.ok ? data : { source: 'Pools', rows: [], error: data.error || 'Falha ao descobrir pools.' });
    } catch {
      setPoolDiscovery({ source: 'Pools', rows: [], error: 'Nao foi possivel descobrir pools.' });
    } finally {
      setPoolLoading(false);
    }
  };

  const stopScan = () => {
    enterWorkMode();
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setLoading(false);
    setCurrentStage('interrompido');
    setProgress((items) => [{
      type: 'stage',
      stage: 'stop',
      message: 'Varredura interrompida no navegador. O ultimo snapshot foi preservado.',
      timestamp: new Date().toISOString(),
    }, ...items].slice(0, 12));
  };

  const analyzeWithAI = async (device: Device) => {
    setAnalyzing(true);
    setAiAnalysis(null);
    try {
      const response = await fetch('/api/ai/analyze-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device }),
      });
      const data = await response.json();
      setAiAnalysis(data.analysis || data.error);
    } catch {
      setAiAnalysis('Nao foi possivel falar com o especialista local. Confira o Ollama ou siga pela analise tecnica manual.');
    } finally {
      setAnalyzing(false);
    }
  };

  const analyzeNetworkWithAI = async () => {
    if (!scanResult) {
      setNetworkAnalysis('Execute uma varredura antes de gerar o parecer geral.');
      setNetworkAnalysisOpen(true);
      return;
    }

    setNetworkAnalyzing(true);
    setNetworkAnalysisOpen(true);
    setNetworkAnalysis(null);
    try {
      const response = await fetch('/api/ai/analyze-network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: scanResult }),
      });
      const data = await response.json();
      setNetworkAnalysis(data.analysis || data.error);
    } catch {
      setNetworkAnalysis('Nao foi possivel gerar o parecer geral. Confira o Ollama ou siga pela analise manual.');
    } finally {
      setNetworkAnalyzing(false);
    }
  };

  const selectDevice = (device: Device) => {
    setSelectedDevice(device);
    setAiAnalysis(null);
    setDiagnostic(null);
  };

  const runDeviceDiagnostic = async (device: Device, kind: 'dns' | 'ping' | 'windows' | 'passive' | 'web') => {
    setDiagnosticLoading(kind);
    setDiagnostic(null);
    try {
      const params = new URLSearchParams({ target: device.ip });
      if (kind === 'ping' || kind === 'windows' || kind === 'web') {
        params.set('ports', (device.openPorts || []).join(','));
      }
      const response = await fetch(`/api/diagnostics/${kind}?${params.toString()}`);
      const data = await response.json();
      setDiagnostic(response.ok ? data : { source: kind, rows: [], error: data.error || 'Diagnostico falhou.' });
    } catch {
      setDiagnostic({ source: kind, rows: [], error: 'Nao foi possivel executar o diagnostico.' });
    } finally {
      setDiagnosticLoading(null);
    }
  };

  const selectFirstHighRisk = () => {
    const [device] = highRiskDevices;
    if (device) {
      selectDevice(device);
      window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  };

  useEffect(() => {
    const cached = window.localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        setScanResult(JSON.parse(cached) as ScanResult);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    fetch('/api/config')
      .then((response) => response.json())
      .then((data: AppConfig) => {
        setConfig(data);
        setTarget(data.defaultScope || data.defaultCidr);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (scanResult) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scanResult));
    }
  }, [scanResult]);

  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);

  return (
    <div className="runescan-dashboard mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-8">
      <motion.header
        layout
        transition={{ layout: { duration: 0.28, ease: 'easeOut' } }}
        className={`panel-surface overflow-visible rounded-xl transition-all ${headerCompact ? 'p-3 md:p-4' : 'p-5 md:p-6'}`}
      >
        <div className={`flex flex-col ${headerCompact ? 'gap-3' : 'gap-7'}`}>
          <AnimatePresence initial={false}>
            {!headerCompact && (
              <motion.div
                key="header-showcase"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
                  <h1 className="text-4xl font-semibold leading-[0.95] tracking-normal md:text-5xl">RuneScan Network</h1>
                  <div className="grid max-w-4xl gap-3 pt-1 text-sm leading-6 text-black/65 md:grid-cols-4 lg:pt-2">
                    <ValueCard text="Descobre hosts por ARP, ICMP, TCP, DNS reverso e ranges." />
                    <ValueCard text="Identifica portas, servicos, paginas web, certificados e fabricantes." />
                    <ValueCard text="Mostra risco, RDP, SMB, Telnet, acessos e diagnosticos por host." />
                    <ValueCard text="Infere sub-redes, pools e topologia; pronto para SNMP, SSH e TShark." />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={`flex min-w-0 flex-col ${headerCompact ? 'gap-2' : 'gap-4'}`}>
            <div className="command-bar flex w-full flex-col gap-3 rounded-xl p-3 lg:flex-row lg:items-center">
              {headerCompact && (
                <button
                  type="button"
                  onClick={() => setHeaderCompact(false)}
                  className="flex h-10 w-12 flex-shrink-0 items-center justify-center rounded-md bg-scan-ink font-mono text-xs font-black tracking-tight text-white transition hover:bg-scan-accent"
                  title="Expandir apresentacao"
                >
                  RSN
                </button>
              )}
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-scan-line bg-white px-3 py-2 font-mono text-xs">
                <Route className="h-4 w-4 flex-shrink-0 text-black/40" />
                <input
                  value={target}
                  onFocus={enterWorkMode}
                  onChange={(event) => setTarget(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent outline-none"
                  placeholder="10.10.100.1-254, 10.10.0.0/16"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                <button
                  type="button"
                  onClick={() => {
                    enterWorkMode();
                    setToolsOpen(true);
                  }}
                  aria-label="Abrir ferramentas integraveis"
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-scan-line bg-white text-scan-ink transition hover:border-scan-accent hover:bg-white hover:text-scan-accent"
                  title="Ferramentas integraveis detectadas"
                >
                  <PlugZap className="h-4 w-4" />
                </button>
                <div className="hidden h-8 w-px bg-scan-line lg:block" />
                <IconToggle
                  active={useNmap}
                  onClick={() => {
                    enterWorkMode();
                    setUseNmap((value) => !value);
                  }}
                  icon={Radar}
                  label="Nmap"
                  title="Ativar/desativar Nmap na varredura"
                />
                <IconToggle
                  active={useNirsoft}
                  onClick={() => {
                    enterWorkMode();
                    setUseNirsoft((value) => !value);
                  }}
                  icon={Search}
                  label="NirSoft"
                  title="Ativar/desativar NirSoft Wireless Network Watcher"
                />
                <IconToggle
                  active={useWebFingerprint}
                  onClick={() => {
                    enterWorkMode();
                    setUseWebFingerprint((value) => !value);
                  }}
                  icon={Globe}
                  label="Web"
                  title="Identificar interfaces HTTP/HTTPS durante a varredura, sem login ou cliques"
                />
                <div className="hidden h-8 w-px bg-scan-line lg:block" />
                <IconToggle
                  active={insightsVisible}
                  onClick={() => {
                    enterWorkMode();
                    setInsightsVisible((value) => !value);
                  }}
                  icon={ChartNoAxesCombined}
                  label="Insights"
                  title="Mostrar/ocultar mapa e graficos da varredura"
                />
                <button
                  onClick={discoverNetworkPools}
                  disabled={poolLoading}
                  aria-label="Descobrir pools/sub-redes provaveis"
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-scan-line bg-white text-scan-ink transition hover:border-green-200 hover:bg-green-50 hover:text-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Inferir pools/sub-redes provaveis testando gateways .1/.254 e ARP local"
                >
                  <LayoutGrid className={`h-4 w-4 ${poolLoading ? 'animate-pulse' : ''}`} />
                </button>
                <button
                  onClick={clearInventory}
                  aria-label="Limpar inventario"
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-scan-line bg-white text-scan-ink transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                  title="Limpar inventario, progresso e diagnosticos salvos neste navegador"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <div className="hidden h-8 w-px bg-scan-line lg:block" />
                <button
                  onClick={performScan}
                  disabled={loading || config?.liveScanEnabled === false}
                  className="flex h-10 min-w-36 items-center justify-center gap-2 rounded-md bg-scan-ink px-4 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-scan-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Varrer rede
                </button>
              </div>
              {loading && (
              <button
                onClick={stopScan}
                className="flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-xs font-bold uppercase tracking-wider text-red-700 transition hover:bg-red-100"
              >
                Parar
              </button>
              )}
            </div>
            {(loading || progress.length > 0 || (scanResult?.collectors?.length || 0) > 0) && (
              <CollectorInlineStatus
                loading={loading}
                currentStage={currentStage}
                progress={progress}
                collectors={scanResult?.collectors || []}
                onOpen={() => setCollectorsOpen(true)}
              />
            )}
          </div>
        </div>
      </motion.header>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Ativos" value={scanResult?.summary.total || 0} icon={<Cpu className="h-4 w-4" />} />
        <StatCard label="Online" value={scanResult?.summary.online || 0} icon={<Zap className="h-4 w-4 text-green-600" />} />
        <StatCard label="Segmentos" value={scanResult?.summary.vlans || 0} icon={<LayoutGrid className="h-4 w-4" />} />
        <StatCard label="Portas abertas" value={scanResult?.summary.openPorts || 0} icon={<Terminal className="h-4 w-4" />} />
        <StatCard
          label="Risco alto"
          value={scanResult?.summary.highRisk || 0}
          icon={<ShieldAlert className="h-4 w-4 text-red-600" />}
          onClick={highRiskDevices.length ? selectFirstHighRisk : undefined}
          title={highRiskDevices.length ? `Abrir ${highRiskDevices[0].name} (${highRiskDevices[0].ip})` : 'Nenhum ativo de alto risco encontrado'}
        />
        <StatCard label="Alvo" value={scanResult?.target || target || '-'} icon={<Network className="h-4 w-4" />} compact />
      </section>

      {poolDiscovery && (
        <PoolDiscoveryPanel
          result={poolDiscovery}
          onScanPool={(range) => {
            setTarget(range);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}

      {scanResult && insightsVisible && (
        <ExecutiveInsights
          result={scanResult}
          onSelectDevice={(device) => {
            selectDevice(device);
            window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
          }}
        />
      )}

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <div className="sticky top-6 flex flex-col gap-4">
            <NetworkTree result={scanResult} devices={scanResult?.devices || []} onSelectDevice={selectDevice} />
            <SegmentPanel result={scanResult} />
          </div>
        </div>

        <div ref={detailsRef} className="lg:col-span-8">
          <AnimatePresence mode="wait">
            {!selectedDevice ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="panel-surface-subtle flex min-h-[520px] flex-col justify-between rounded-xl border-dashed p-8"
              >
                <div className="max-w-xl">
                  <Search className="mb-5 h-10 w-10 text-black/25" />
                  <h2 className="text-2xl font-semibold">Execute uma varredura real</h2>
                  <p className="mt-3 text-sm leading-6 text-black/55">
                    Sem fallback mockado: se a rede nao responder ou a permissao bloquear ICMP/ARP/TCP, o painel mostra vazio e os coletores indicam onde falhou.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Signal label="Risco alto" value={devicesByRisk.high} tone="red" />
                  <Signal label="Risco medio" value={devicesByRisk.medium} tone="orange" />
                  <Signal label="Risco baixo" value={devicesByRisk.low} tone="green" />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={selectedDevice.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-5"
              >
                <DeviceDetails
                  device={selectedDevice}
                  diagnostic={diagnostic}
                  diagnosticLoading={diagnosticLoading}
                  onRunDiagnostic={(kind) => runDeviceDiagnostic(selectedDevice, kind)}
                />
                <AiPanel
                  analyzing={analyzing}
                  analysis={aiAnalysis}
                  onGenerate={() => analyzeWithAI(selectedDevice)}
                  onGenerateNetwork={analyzeNetworkWithAI}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <footer className="panel-surface-subtle rounded-xl p-4 text-center text-xs font-semibold uppercase tracking-widest text-black/45">
        Created by Pilgrims in partnership with Rune Projects
      </footer>

      <NetworkAnalysisModal
        open={networkAnalysisOpen}
        analyzing={networkAnalyzing}
        analysis={networkAnalysis}
        onClose={() => setNetworkAnalysisOpen(false)}
      />
      <ToolsModal open={toolsOpen} tools={tools} onClose={() => setToolsOpen(false)} />
      <CollectorsModal
        open={collectorsOpen}
        collectors={scanResult?.collectors || []}
        localContext={localContext}
        progress={progress}
        onClose={() => setCollectorsOpen(false)}
      />
    </div>
  );
};

const StatCard = ({
  label,
  value,
  icon,
  compact,
  onClick,
  title,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  compact?: boolean;
  onClick?: () => void;
  title?: string;
}) => {
  const Component = onClick ? 'button' : 'div';
  const numericValue = typeof value === 'number' ? value : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      whileHover={onClick ? { y: -3 } : { y: -2 }}
    >
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={`panel-surface-subtle flex min-h-24 w-full flex-col justify-between rounded-xl p-4 text-left transition ${onClick ? 'cursor-pointer hover:border-red-200 hover:bg-red-50/60 hover:shadow-md' : ''}`}
    >
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-black/40">
      {icon}
      {label}
    </div>
    <div className={`font-mono font-black tracking-normal ${compact ? 'truncate text-sm' : 'text-3xl'}`}>
      {numericValue === null ? value : <AnimatedNumber value={numericValue} />}
    </div>
    </Component>
    </motion.div>
  );
};

const AnimatedNumber = ({ value }: { value: number }) => {
  const motionValue = useMotionValue(value);
  const rounded = useTransform(motionValue, (latest) => Math.round(latest).toLocaleString('pt-BR'));

  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.55, ease: 'easeOut' });
    return () => controls.stop();
  }, [motionValue, value]);

  return <motion.span>{rounded}</motion.span>;
};

const ValueCard = ({ text }: { text: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ y: -2, scale: 1.01 }}
    transition={{ duration: 0.25, ease: 'easeOut' }}
    className="rounded-lg border border-scan-line bg-white/55 p-3 shadow-sm"
  >
    <p>{text}</p>
  </motion.div>
);

const IconToggle = ({
  active,
  onClick,
  icon: Icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  title: string;
}) => (
  <motion.button
    type="button"
    onClick={onClick}
    aria-label={title}
    title={`${label}: ${active ? 'ativo' : 'inativo'} - ${title}`}
    whileHover={{ y: -2 }}
    whileTap={{ scale: 0.94 }}
    animate={active ? { scale: [1, 1.05, 1] } : { scale: 1 }}
    transition={{ duration: 0.2, ease: 'easeOut' }}
    className={`flex h-10 w-10 items-center justify-center rounded-md border transition ${
      active
        ? 'border-green-200 bg-green-50 text-green-700 shadow-[0_0_0_3px_rgba(34,197,94,0.08)]'
        : 'border-scan-line bg-white text-black/45 hover:border-scan-accent hover:text-scan-accent'
    }`}
  >
    <Icon className="h-4 w-4" />
  </motion.button>
);

const CollectorInlineStatus = ({
  loading,
  currentStage,
  progress,
  collectors,
  onOpen,
}: {
  loading: boolean;
  currentStage: string;
  progress: ScanProgressEvent[];
  collectors: CollectorRun[];
  onOpen: () => void;
}) => {
  const runningCollector = collectors.find((collector) => collector.status === 'running');
  const latestEvent = progress[0];
  const lastCollector = [...collectors].reverse().find((collector) => collector.message);
  const statusText = runningCollector
    ? `Executando ${runningCollector.name}`
    : loading
      ? latestEvent?.message || 'Pensando na proxima etapa'
      : lastCollector?.message || (currentStage === 'finalizado' ? 'Varredura finalizada' : 'Aguardando execucao');
  const statusMeta = runningCollector?.message || latestEvent?.message || `${collectors.length || 0} coletor(es) registrados`;

  const hasExecution = loading || progress.length > 0 || collectors.length > 0;
  if (!hasExecution) return null;

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.995 }}
      className="mt-4 flex w-full flex-col gap-3 rounded-lg border border-black/5 bg-white/45 px-3 py-2 text-left transition hover:border-scan-accent/40 hover:bg-white/70 md:flex-row md:items-center md:justify-between"
      title="Abrir execucao detalhada dos coletores"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-scan-line bg-white text-black/45">
          <Activity className={`h-3.5 w-3.5 ${loading ? 'animate-pulse text-scan-accent' : ''}`} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm text-black/65">{statusText}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-wider text-black/35">{statusMeta}</p>
        </div>
      </div>
      <ProgressRail loading={loading} currentStage={currentStage} progress={progress} collectors={collectors} />
    </motion.button>
  );
};

const ProgressRail = ({
  loading,
  currentStage,
  progress,
  collectors,
}: {
  loading: boolean;
  currentStage: string;
  progress: ScanProgressEvent[];
  collectors: CollectorRun[];
}) => {
  const latestByStage = new Map<string, ScanProgressEvent>();
  for (const item of progress) {
    if (!latestByStage.has(item.stage)) latestByStage.set(item.stage, item);
  }
  const collectorById = new Map(collectors.map((collector) => [collector.id, collector]));
  const stepStatus = (stepId: string): ProgressStatus => {
    if (stepId === 'setup') {
      if (latestByStage.has('setup')) return currentStage === 'setup' && loading ? 'running' : 'completed';
      return loading && currentStage === 'iniciando' ? 'running' : 'waiting';
    }
    if (stepId === 'done') {
      if (currentStage === 'finalizado' || currentStage === 'done' || latestByStage.has('done')) return 'completed';
      if (currentStage === 'interrompido') return 'failed';
      return 'waiting';
    }
    const collector = collectorById.get(stepId);
    if (collector) return collector.status;
    if (currentStage === stepId && loading) return 'running';
    return 'waiting';
  };

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center justify-center gap-1.5">
      {PROGRESS_STEPS.map((step, index) => {
        const collector = collectorById.get(step.id);
        const status = stepStatus(step.id);
        return (
          <React.Fragment key={step.id}>
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: status === 'running' ? [1, 1.06, 1] : 1 }}
              transition={{ duration: status === 'running' ? 1.1 : 0.22, repeat: status === 'running' ? Infinity : 0, ease: 'easeInOut' }}
              whileHover={{ y: -2 }}
              className={`relative flex h-8 w-8 items-center justify-center rounded-md border ${progressStepClass(status)}`}
              title={`${step.label}: ${progressStatusText(status)}${collector?.items ? ` (${collector.items})` : ''}`}
            >
              <step.icon className="h-3.5 w-3.5" />
              {typeof collector?.items === 'number' && collector.items > 0 && (
                <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full border border-white bg-green-600 px-1 font-mono text-[8px] font-bold text-white">
                  {collector.items > 99 ? '99+' : collector.items}
                </span>
              )}
            </motion.div>
            {index < PROGRESS_STEPS.length - 1 && <div className="h-px w-4 bg-scan-line" />}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const AppModal = ({
  open,
  title,
  icon,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) => (
  <AnimatePresence>
    {open && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          className="panel-surface max-h-[84vh] w-full max-w-4xl overflow-hidden rounded-xl"
        >
          <div className="flex items-center justify-between border-b border-scan-line p-4">
            <div className="flex items-center gap-2">
              {icon}
              <h3 className="text-sm font-semibold">{title}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-scan-line bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition hover:bg-scan-ink hover:text-white"
            >
              Fechar
            </button>
          </div>
          <div className="max-h-[72vh] overflow-y-auto p-4">{children}</div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

const ToolsModal = ({ open, tools, onClose }: { open: boolean; tools: ToolCapability[]; onClose: () => void }) => (
  <AppModal open={open} title="Ferramentas integraveis" icon={<PlugZap className="h-4 w-4 text-scan-accent" />} onClose={onClose}>
    <div className="grid gap-2 md:grid-cols-2">
      {tools.map((tool) => (
        <div key={tool.id} className="rounded-lg border border-scan-line bg-white/75 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-sm font-semibold">{tool.name}</p>
            {tool.available ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Unplug className="h-4 w-4 text-black/30" />}
          </div>
          <p className="mt-2 text-xs leading-5 text-black/55">{tool.purpose}</p>
          <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-wider text-black/35">{tool.available ? tool.version || 'disponivel' : tool.notes || 'indisponivel'}</p>
        </div>
      ))}
      {tools.length === 0 && <p className="p-3 text-sm text-black/45">Detectando ferramentas locais...</p>}
    </div>
  </AppModal>
);

const CollectorsModal = ({
  open,
  collectors,
  localContext,
  progress,
  onClose,
}: {
  open: boolean;
  collectors: CollectorRun[];
  localContext?: LocalNetworkContext;
  progress: ScanProgressEvent[];
  onClose: () => void;
}) => (
  <AppModal open={open} title="Execucao dos coletores" icon={<Activity className="h-4 w-4 text-scan-accent" />} onClose={onClose}>
    <div className="grid gap-3">
      {collectors.map((collector) => (
        <div key={collector.id} className="rounded-lg border border-scan-line bg-white/75 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold">{collector.name}</p>
              <p className="mt-1 text-xs leading-5 text-black/55">{collector.message}</p>
            </div>
            <span className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${collectorClass(collector.status)}`}>{collector.status}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-wider text-black/35">
            <span>{collector.items} item(s)</span>
            {collector.startedAt && <span>inicio {new Date(collector.startedAt).toLocaleTimeString()}</span>}
            {collector.finishedAt && <span>fim {new Date(collector.finishedAt).toLocaleTimeString()}</span>}
          </div>
        </div>
      ))}
      {collectors.length === 0 && (
        <div className="rounded-lg border border-scan-line bg-white/75 p-4 text-sm text-black/50">
          <p className="font-medium text-black/70">{localContext?.hostname || 'Host local'}</p>
          <p className="mt-1 font-mono text-xs">{localContext?.interfaces?.find((entry) => !entry.internal)?.cidr || 'Aguardando primeira varredura'}</p>
        </div>
      )}
      {progress.length > 0 && (
        <div className="mt-2 rounded-lg border border-scan-line bg-black/[0.02] p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-black/35">Eventos recentes</p>
          <div className="grid gap-2">
            {progress.slice(0, 8).map((event, index) => (
              <div key={`${event.timestamp}-${index}`} className="flex items-start gap-3 text-xs text-black/60">
                <span className="mt-0.5 font-mono text-[10px] uppercase text-black/35">{event.stage}</span>
                <span className="min-w-0 flex-1">{event.message}</span>
                <span className="font-mono text-[10px] text-black/35">{new Date(event.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  </AppModal>
);

const ToolPanel = ({ tools, expanded, onToggle }: { tools: ToolCapability[]; expanded: boolean; onToggle: () => void }) => (
  <div className="panel-surface overflow-hidden rounded-xl">
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center justify-between p-4 text-left transition hover:bg-white ${expanded ? 'border-b border-scan-line' : ''}`}
      title={expanded ? 'Recolher ferramentas' : 'Expandir ferramentas'}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Ferramentas integraveis</h3>
        <span className="rounded bg-black/5 px-2 py-1 font-mono text-[10px] font-bold text-black/40">{tools.length}</span>
      </div>
      <div className="flex items-center gap-2">
        <PlugZap className="h-4 w-4 text-black/35" />
        <ChevronDown className={`h-4 w-4 text-black/35 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </div>
    </button>
    <AnimatePresence initial={false}>
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          <div className="grid gap-2 p-3 md:grid-cols-2">
            {tools.map((tool) => (
              <div key={tool.id} className="rounded-md border border-scan-line bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-sm font-semibold">{tool.name}</p>
                  {tool.available ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Unplug className="h-4 w-4 text-black/30" />}
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-black/55">{tool.purpose}</p>
                <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-wider text-black/35">{tool.available ? tool.version || 'disponivel' : tool.notes || 'indisponivel'}</p>
              </div>
            ))}
            {tools.length === 0 && <p className="p-3 text-sm text-black/45">Detectando ferramentas locais...</p>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

const CollectorPanel = ({
  collectors,
  localContext,
  expanded,
  onToggle,
}: {
  collectors: CollectorRun[];
  localContext?: LocalNetworkContext;
  expanded: boolean;
  onToggle: () => void;
}) => (
  <div className="panel-surface overflow-hidden rounded-xl">
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center justify-between p-4 text-left transition hover:bg-white ${expanded ? 'border-b border-scan-line' : ''}`}
      title={expanded ? 'Recolher coletores' : 'Expandir coletores'}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Execucao dos coletores</h3>
        <span className="rounded bg-black/5 px-2 py-1 font-mono text-[10px] font-bold text-black/40">{collectors.length}</span>
      </div>
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-black/35" />
        <ChevronDown className={`h-4 w-4 text-black/35 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </div>
    </button>
    <AnimatePresence initial={false}>
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          <div className="grid gap-3 p-4">
            {collectors.map((collector) => (
              <div key={collector.id} className="flex items-start justify-between gap-3 border-b border-scan-line pb-3 last:border-b-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold">{collector.name}</p>
                  <p className="mt-1 text-xs text-black/50">{collector.message}</p>
                </div>
                <span className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${collectorClass(collector.status)}`}>{collector.status}</span>
              </div>
            ))}
            {collectors.length === 0 && (
              <div className="text-sm text-black/50">
                <p className="font-medium text-black/70">{localContext?.hostname || 'Host local'}</p>
                <p className="mt-1 font-mono text-xs">{localContext?.interfaces?.find((entry) => !entry.internal)?.cidr || 'Aguardando primeira varredura'}</p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

const PROGRESS_STEPS = [
  { id: 'setup', label: 'Setup', icon: Info },
  { id: 'native', label: 'Native', icon: Cpu },
  { id: 'nmap', label: 'Nmap', icon: Radar },
  { id: 'nirsoft', label: 'NirSoft', icon: Search },
  { id: 'web', label: 'Web', icon: Globe },
  { id: 'telnet', label: 'Telnet', icon: Terminal },
  { id: 'tshark', label: 'TShark', icon: Activity },
  { id: 'done', label: 'Fim', icon: CheckCircle2 },
] as const;

type ProgressStatus = CollectorRun['status'] | 'waiting';

const ProgressPanel = ({
  loading,
  currentStage,
  progress,
  collectors,
}: {
  loading: boolean;
  currentStage: string;
  progress: ScanProgressEvent[];
  collectors: CollectorRun[];
}) => {
  const latestByStage = useMemo(() => {
    const map = new Map<string, ScanProgressEvent>();
    for (const item of progress) {
      if (!map.has(item.stage)) map.set(item.stage, item);
    }
    return map;
  }, [progress]);
  const collectorById = useMemo(() => new Map(collectors.map((collector) => [collector.id, collector])), [collectors]);

  const stepStatus = (stepId: string): ProgressStatus => {
    if (stepId === 'setup') {
      if (latestByStage.has('setup')) return currentStage === 'setup' && loading ? 'running' : 'completed';
      return loading && currentStage === 'iniciando' ? 'running' : 'waiting';
    }
    if (stepId === 'done') {
      if (currentStage === 'finalizado' || currentStage === 'done' || latestByStage.has('done')) return 'completed';
      if (currentStage === 'interrompido') return 'failed';
      return 'waiting';
    }

    const collector = collectorById.get(stepId);
    if (collector) return collector.status;
    if (currentStage === stepId && loading) return 'running';
    return 'waiting';
  };

  return (
    <div className="panel-surface overflow-visible rounded-xl">
      <div className="flex flex-col gap-2 border-b border-scan-line p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Activity className={`h-4 w-4 ${loading ? 'animate-pulse text-scan-accent' : 'text-black/35'}`} />
          <h3 className="text-sm font-semibold">Progresso em tempo real</h3>
        </div>
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-black/45">{currentStage}</span>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {PROGRESS_STEPS.map((step, index) => {
            const event = latestByStage.get(step.id);
            const collector = collectorById.get(step.id);
            const status = stepStatus(step.id);
            const message = collector?.message || event?.message || (status === 'waiting' ? 'Aguardando esta etapa.' : 'Processando etapa.');
            const timestamp = collector?.finishedAt || collector?.startedAt || event?.timestamp;

            return (
              <React.Fragment key={step.id}>
                <ProgressStep
                  icon={step.icon}
                  label={step.label}
                  status={status}
                  message={message}
                  timestamp={timestamp}
                  items={collector?.items}
                />
                {index < PROGRESS_STEPS.length - 1 && <div className="h-px w-6 flex-shrink-0 bg-scan-line" />}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const ProgressStep = ({
  icon: Icon,
  label,
  status,
  message,
  timestamp,
  items,
}: {
  icon: React.ElementType;
  label: string;
  status: ProgressStatus;
  message: string;
  timestamp?: string;
  items?: number;
}) => {
  const isRunning = status === 'running';

  return (
    <div className="group relative flex flex-shrink-0 flex-col items-center gap-1">
      <motion.div
        initial={false}
        animate={isRunning ? { scale: [1, 1.06, 1] } : { scale: 1 }}
        transition={{ duration: 1.2, repeat: isRunning ? Infinity : 0, ease: 'easeInOut' }}
        className={`relative flex h-9 w-9 items-center justify-center rounded-md border ${progressStepClass(status)}`}
      >
        {isRunning && <span className="absolute inset-0 rounded-md border border-green-400/50 animate-ping" />}
        <Icon className="relative h-4 w-4" />
        {typeof items === 'number' && items > 0 && (
          <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full border border-white bg-green-600 px-1 font-mono text-[9px] font-bold text-white">
            {items > 99 ? '99+' : items}
          </span>
        )}
      </motion.div>
      <div className="pointer-events-none absolute bottom-full left-1/2 z-[9999] mb-3 w-64 -translate-x-1/2 rounded-md border border-scan-line bg-scan-ink p-3 text-left text-white opacity-0 shadow-xl transition group-hover:opacity-100">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] font-bold uppercase tracking-wider">{label}</p>
          <span className="font-mono text-[10px] uppercase text-white/55">{progressStatusText(status)}</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-white/80">{message}</p>
        <div className="mt-2 flex items-center justify-between gap-3 font-mono text-[10px] text-white/45">
          <span>{typeof items === 'number' ? `${items} item(s)` : 'sem contagem'}</span>
          <span>{timestamp ? new Date(timestamp).toLocaleTimeString() : 'aguardando'}</span>
        </div>
      </div>
    </div>
  );
};

const SegmentPanel = ({ result }: { result: ScanResult | null }) => (
  <div className="panel-surface overflow-hidden rounded-xl">
    <div className="flex items-center justify-between border-b border-scan-line p-4">
      <h3 className="text-sm font-semibold">Segmentos e VLANs</h3>
      <LayoutGrid className="h-4 w-4 text-black/35" />
    </div>
    <div className="max-h-64 overflow-y-auto">
      {(result?.vlans || []).map((vlan) => (
        <div key={vlan.id} className="border-b border-scan-line p-4 last:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-semibold">{vlan.name}</p>
              <p className="mt-1 font-mono text-[11px] text-black/45">{vlan.subnet}</p>
            </div>
            <span className="rounded border border-scan-line px-2 py-1 text-[10px] uppercase text-black/45">{vlan.confidence}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded bg-black/10">
            <div className="h-full bg-scan-accent" style={{ width: `${Math.max(8, (vlan.onlineCount / vlan.deviceCount) * 100)}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-black/45">{vlan.onlineCount}/{vlan.deviceCount} ativos online</p>
        </div>
      ))}
      {!result && <div className="p-6 text-sm text-black/40">Sem dados ainda.</div>}
    </div>
  </div>
);

const PoolDiscoveryPanel = ({ result, onScanPool }: { result: DiagnosticResult; onScanPool: (range: string) => void }) => (
  <div className="panel-surface overflow-hidden rounded-xl">
    <div className="flex items-center justify-between border-b border-scan-line p-4">
      <div className="flex items-center gap-2">
        <LayoutGrid className="h-4 w-4 text-green-600" />
        <h3 className="text-sm font-semibold">Pools/sub-redes provaveis</h3>
      </div>
      <span className="rounded bg-black/5 px-2 py-1 font-mono text-[10px] font-bold uppercase text-black/45">{result.source}</span>
    </div>
    <p className="border-b border-scan-line px-4 py-3 text-xs leading-5 text-black/50">
      Esta etapa encontra pools provaveis testando gateways e ARP. Para listar hosts, clique em um pool e execute a varredura do range completo.
    </p>
    {result.error ? (
      <p className="m-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{result.error}</p>
    ) : (
      <div className="grid gap-2 p-4 md:grid-cols-2">
        {result.rows.map((row, index) => (
          <div key={`${row.Pool || index}`} className="rounded-md border border-scan-line bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono text-sm font-semibold">{row.Pool || 'Pool'}</p>
              <span className="rounded bg-green-50 px-2 py-1 font-mono text-[10px] font-bold uppercase text-green-700">{row.Confianca || 'inferida'}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-black/55">{row.Evidencias}</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="truncate font-mono text-[10px] uppercase tracking-wider text-black/35">{row.Fontes}</p>
              {row.Pool && /^\d{1,3}(?:\.\d{1,3}){3}\/24$/.test(row.Pool) && (
                <button
                  type="button"
                  onClick={() => onScanPool(poolToRange(row.Pool))}
                  className="flex h-8 flex-shrink-0 items-center gap-2 rounded-md border border-scan-line px-2 text-[10px] font-bold uppercase tracking-wider transition hover:border-scan-accent hover:bg-scan-accent hover:text-white"
                  title="Preencher o alvo com este pool para varrer todos os hosts"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Usar range
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

function poolToRange(pool: string) {
  const [network] = pool.split('/');
  const parts = network.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.1-254`;
}

const ExecutiveInsights = ({ result, onSelectDevice }: { result: ScanResult; onSelectDevice: (device: Device) => void }) => {
  const onlineDevices = result.devices.filter((device) => device.status === 'online');
  return (
    <section className="panel-surface overflow-visible rounded-xl p-4">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-scan-accent" />
            <h2 className="text-lg font-semibold">Mapa e insights</h2>
          </div>
          <p className="mt-1 text-xs text-black/45">Visao inferida da varredura atual. Topologia fisica exige SNMP/SSH/LLDP/CDP.</p>
        </div>
        <span className="rounded-md border border-scan-line bg-white/70 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-black/40">
          {result.summary.subnets} sub-rede(s) / {onlineDevices.length} online
        </span>
      </div>

      <InsightMetrics result={result} />

      <FlowNetworkMap result={result} onSelectDevice={onSelectDevice} />
    </section>
  );
};

const InsightMetrics = ({ result }: { result: ScanResult }) => {
  const online = result.devices.filter((device) => device.status === 'online');
  const riskData = [
    { name: 'Alto', value: online.filter((device) => device.riskLevel === 'high').length, color: '#ef4444' },
    { name: 'Medio', value: online.filter((device) => device.riskLevel === 'medium').length, color: '#f97316' },
    { name: 'Baixo', value: online.filter((device) => device.riskLevel === 'low').length, color: '#22c55e' },
  ].filter((item) => item.value > 0);
  const subnetData = result.vlans.slice(0, 8).map((vlan, index) => ({
    name: vlan.subnet.replace('/24', ''),
    ativos: vlan.onlineCount,
    index: index + 1,
  }));
  const exposureCount = online.filter((device) => [23, 3389, 445, 135].some((port) => device.openPorts?.includes(port))).length;
  const webCount = online.filter((device) => getWebFingerprints(device).length > 0).length;

  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-[0.9fr_1.2fr_0.9fr]">
      <div className="rounded-xl border border-scan-line bg-white/65 p-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-black/35">Risco</p>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={riskData.length ? riskData : [{ name: 'Sem dados', value: 1, color: '#d4d4d4' }]} dataKey="value" innerRadius={34} outerRadius={52} paddingAngle={3}>
                {(riskData.length ? riskData : [{ color: '#d4d4d4' }]).map((entry, index) => <Cell key={index} fill={entry.color} />)}
              </Pie>
              <ChartTooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-scan-line bg-white/65 p-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-black/35">Ativos por sub-rede</p>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={subnetData}>
              <XAxis dataKey="index" hide />
              <YAxis hide />
              <ChartTooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.name || ''} />
              <Line type="monotone" dataKey="ativos" stroke="#101418" strokeWidth={2.4} dot={{ r: 4, fill: '#ff5f1f', strokeWidth: 0 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="grid gap-2">
        <MetricPill label="Acessos sensiveis" value={exposureCount} tone="orange" />
        <MetricPill label="Web identificado" value={webCount} tone="green" />
        <MetricPill label="Offline preservado" value={result.devices.filter((device) => device.status === 'offline').length} tone="gray" />
      </div>
    </div>
  );
};

const MetricPill = ({ label, value, tone }: { label: string; value: number; tone: 'orange' | 'green' | 'gray' }) => {
  const toneClass = {
    orange: 'border-orange-200 bg-orange-50 text-orange-700',
    green: 'border-green-200 bg-green-50 text-green-700',
    gray: 'border-black/10 bg-white/65 text-black/55',
  }[tone];

  return (
    <div className={`flex items-center justify-between rounded-xl border p-3 ${toneClass}`}>
      <span className="text-xs font-bold uppercase tracking-widest">{label}</span>
      <span className="font-mono text-xl font-black"><AnimatedNumber value={value} /></span>
    </div>
  );
};

type FlowNodeData = {
  label: string;
  detail: string;
  kind: 'root' | 'subnet' | 'device';
  risk?: Device['riskLevel'];
  device?: Device;
  count?: number;
};

const flowNodeTypes = {
  runescan: ({ data }: NodeProps<Node<FlowNodeData>>) => {
    const node = data as FlowNodeData;
    return (
      <div className={`min-w-36 rounded-xl border bg-white/95 px-3 py-2 shadow-[0_14px_30px_rgba(16,20,24,0.12)] ${flowNodeClass(node)}`}>
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-black/30" />
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-black/30" />
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${node.kind === 'root' ? 'bg-scan-ink' : node.risk === 'high' ? 'bg-red-500' : node.risk === 'medium' ? 'bg-orange-500' : 'bg-green-500'}`} />
          <p className="truncate font-mono text-xs font-bold">{node.label}</p>
          {typeof node.count === 'number' && <span className="ml-auto rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-black/45">{node.count}</span>}
        </div>
        <p className="mt-1 truncate font-mono text-[10px] text-black/40">{node.detail}</p>
      </div>
    );
  },
};

const FlowNetworkMap = ({ result, onSelectDevice }: { result: ScanResult; onSelectDevice: (device: Device) => void }) => {
  const { nodes, edges } = useMemo(() => buildFlowElements(result), [result]);

  return (
    <div className="h-[720px] overflow-hidden rounded-xl border border-scan-line bg-white/70">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.35}
        maxZoom={1.35}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, node) => {
          const device = (node.data as FlowNodeData).device;
          if (device) onSelectDevice(device);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} size={1} color="rgba(16,20,24,0.14)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

function buildFlowElements(result: ScanResult): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = [{
    id: 'root',
    type: 'runescan',
    position: { x: 0, y: 260 },
    data: { label: 'RuneScan', detail: result.target, kind: 'root', count: result.summary.online },
  }];
  const edges: Edge[] = [];
  const online = result.devices.filter((device) => device.status === 'online');
  const subnets = result.vlans.slice(0, 8);
  const hostColumns = 3;
  const hostColumnGap = 340;
  const hostRowGap = 128;
  const poolGap = 120;
  let yCursor = 0;

  subnets.forEach((subnet, subnetIndex) => {
    const y = yCursor;
    const subnetId = `subnet-${subnet.id}`;
    const devices = online
      .filter((device) => device.subnet === subnet.subnet || device.vlan === subnet.name)
      .sort((a, b) => riskWeight(b) - riskWeight(a) || ipToNumber(a.ip) - ipToNumber(b.ip))
      .slice(0, 9);
    const hostRows = Math.max(1, Math.ceil(devices.length / hostColumns));

    nodes.push({
      id: subnetId,
      type: 'runescan',
        position: { x: 320, y },
      data: { label: subnet.name.replace('Sub-rede ', ''), detail: subnet.subnet, kind: 'subnet', count: devices.length, risk: devices.some((device) => device.riskLevel === 'high') ? 'high' : 'low' },
    });
    edges.push(flowEdge(`root-${subnetId}`, 'root', subnetId));

    devices.forEach((device, deviceIndex) => {
      const deviceId = `device-${device.id}`;
      const column = deviceIndex % hostColumns;
      const row = Math.floor(deviceIndex / hostColumns);
      nodes.push({
        id: deviceId,
        type: 'runescan',
        position: { x: 760 + column * hostColumnGap, y: y - 54 + row * hostRowGap },
        data: {
          label: device.name,
          detail: `${device.ip} / ${(device.openPorts || []).slice(0, 4).join(', ') || 'sem portas'}`,
          kind: 'device',
          risk: device.riskLevel,
          device,
        },
      });
      edges.push(flowEdge(`${subnetId}-${deviceId}`, subnetId, deviceId));
    });

    yCursor += hostRows * hostRowGap + poolGap;
  });

  return { nodes, edges };
}

function flowEdge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    animated: false,
    style: { stroke: 'rgba(16,20,24,0.24)', strokeWidth: 1.7 },
  };
}

function flowNodeClass(node: FlowNodeData) {
  if (node.kind === 'root') return 'border-black/20';
  if (node.risk === 'high') return 'border-red-200';
  if (node.risk === 'medium') return 'border-orange-200';
  return 'border-green-200';
}

const OrganicNetworkMap = ({ result, onSelectDevice }: { result: ScanResult; onSelectDevice: (device: Device) => void }) => {
  const groups = result.vlans.slice(0, 5).map((subnet, index) => {
    const devices = result.devices
      .filter((device) => device.status === 'online' && (device.subnet === subnet.subnet || device.vlan === subnet.name))
      .sort((a, b) => riskWeight(b) - riskWeight(a) || ipToNumber(a.ip) - ipToNumber(b.ip))
      .slice(0, 8);
    return { subnet, devices, index };
  }).filter((group) => group.devices.length > 0);

  const trunkX = 150;
  const height = Math.max(360, 130 + groups.reduce((total, group) => total + Math.max(80, group.devices.length * 32), 0));
  let cursorY = 58;

  const layout = groups.map((group) => {
    const y = cursorY;
    const branchX = 300 + (group.index % 2) * 34;
    const labelX = 420 + (group.index % 2) * 24;
    const deviceRows = group.devices.map((device, deviceIndex) => ({
      device,
      x: labelX,
      y: y + 32 + deviceIndex * 34,
      dotX: branchX + 36 + (deviceIndex % 2) * 18,
    }));
    cursorY += Math.max(104, group.devices.length * 34 + 74);
    return { ...group, y, branchX, labelX, deviceRows };
  });

  return (
    <div className="relative min-h-[380px] overflow-hidden rounded-xl border border-black/5 bg-white/70">
      <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(circle,rgba(16,20,24,0.12)_1px,transparent_1px)] [background-size:22px_22px]" />
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 760 ${height}`} preserveAspectRatio="xMidYMin slice" aria-hidden="true">
        <path d={`M ${trunkX} 36 C ${trunkX - 8} 110, ${trunkX + 12} ${height - 120}, ${trunkX} ${height - 34}`} fill="none" stroke="rgba(16,20,24,0.78)" strokeWidth="4" strokeLinecap="round" />
        {layout.map((group) => (
          <g key={group.subnet.id}>
            <path
              d={`M ${trunkX} ${group.y} C ${trunkX + 42} ${group.y}, ${group.branchX - 54} ${group.y - 20}, ${group.branchX} ${group.y + 18}`}
              fill="none"
              stroke="rgba(16,20,24,0.58)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path
              d={`M ${group.branchX} ${group.y + 18} C ${group.branchX - 8} ${group.y + 52}, ${group.branchX + 10} ${group.y + group.deviceRows.length * 28 + 42}, ${group.branchX} ${group.y + group.deviceRows.length * 34 + 42}`}
              fill="none"
              stroke="rgba(16,20,24,0.28)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {group.deviceRows.map((row) => (
              <path
                key={`${group.subnet.id}-${row.device.id}`}
                d={`M ${group.branchX} ${row.y} C ${group.branchX + 24} ${row.y}, ${row.dotX - 10} ${row.y - 14}, ${row.dotX} ${row.y}`}
                fill="none"
                stroke="rgba(16,20,24,0.18)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            ))}
          </g>
        ))}
      </svg>

      <div className="relative" style={{ minHeight: height }}>
        <div className="absolute left-[126px] top-6 rounded-full border border-black/10 bg-scan-ink px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white shadow-lg">
          Root
        </div>
        {layout.map((group) => (
          <div key={group.subnet.id}>
            <button
              type="button"
              className="absolute h-5 w-5 rounded-full border-4 border-white bg-scan-ink shadow-lg"
              style={{ left: group.branchX - 10, top: group.y + 8 }}
              title={`${group.subnet.name} / ${group.subnet.subnet}`}
            />
            <div
              className="absolute rounded-lg border border-scan-line bg-white/90 px-3 py-2 shadow-[0_12px_28px_rgba(16,20,24,0.14)]"
              style={{ left: group.labelX, top: group.y - 6 }}
            >
              <p className="font-mono text-xs font-bold">{group.subnet.name}</p>
              <p className="mt-0.5 font-mono text-[10px] text-black/40">{group.subnet.onlineCount}/{group.subnet.deviceCount} online</p>
            </div>
            {group.deviceRows.map((row) => (
              <button
                key={row.device.id}
                type="button"
                onClick={() => onSelectDevice(row.device)}
                className="absolute flex items-center gap-2 rounded-lg border border-scan-line bg-white/95 px-2.5 py-1.5 text-left shadow-[0_10px_24px_rgba(16,20,24,0.12)] transition hover:-translate-y-0.5 hover:border-scan-accent hover:shadow-lg"
                style={{ left: row.x + 58, top: row.y - 16 }}
                title={`${row.device.name} (${row.device.ip})`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${nodeDotClass(row.device)}`} />
                <span className="max-w-36 truncate font-mono text-[11px] font-semibold">{row.device.name}</span>
                <span className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[9px] uppercase text-black/45">{deviceLabel(row.device)}</span>
              </button>
            ))}
          </div>
        ))}
        {layout.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-black/40">
            Execute uma varredura para desenhar o mapa inferido.
          </div>
        )}
      </div>
    </div>
  );
};

function mergeOfflineDevices(previous: ScanResult | null, next: ScanResult, rawTarget: string): ScanResult {
  if (!previous?.devices.length) return normalizeScanSummary(next);

  const currentIds = new Set(next.devices.map((device) => device.id));
  const offlineDevices = previous.devices
    .filter((device) => !currentIds.has(device.id) && targetContainsIp(rawTarget, device.ip))
    .map((device): Device => ({
      ...device,
      status: 'offline',
      parentId: undefined,
      details: 'Nao respondeu na ultima varredura; dados preservados do inventario anterior.',
      evidence: Array.from(new Set([...(device.evidence || []), 'Ausente na ultima varredura do range atual'])),
      lastSeen: device.lastSeen,
    }));

  return normalizeScanSummary({
    ...next,
    devices: [...next.devices, ...offlineDevices].sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip)),
  });
}

function normalizeScanSummary(result: ScanResult): ScanResult {
  const vlans = summarizeClientVlans(result.devices);
  const subnets = new Set(result.devices.map((device) => device.subnet).filter(Boolean));
  const openPorts = result.devices.reduce((total, device) => total + (device.status === 'online' ? device.openPorts?.length || 0 : 0), 0);

  return {
    ...result,
    vlans,
    summary: {
      total: result.devices.length,
      online: result.devices.filter((device) => device.status === 'online').length,
      vlans: vlans.length,
      subnets: subnets.size,
      openPorts,
      highRisk: result.devices.filter((device) => device.status === 'online' && device.riskLevel === 'high').length,
    },
  };
}

function summarizeClientVlans(devices: Device[]) {
  const grouped = new Map<string, Device[]>();
  for (const device of devices) {
    const key = device.vlan || device.subnet || 'Desconhecida';
    grouped.set(key, [...(grouped.get(key) || []), device]);
  }

  return Array.from(grouped.entries()).map(([name, items], index) => ({
    id: `segment-${index + 1}`,
    name,
    subnet: items[0]?.subnet || 'NI',
    deviceCount: items.length,
    onlineCount: items.filter((item) => item.status === 'online').length,
    confidence: name.startsWith('VLAN') ? 'confirmed' as const : 'inferred' as const,
  }));
}

function targetContainsIp(rawTarget: string, ip: string) {
  const targetParts = rawTarget.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean);
  if (targetParts.length === 0) return false;
  const ipNumber = ipToNumber(ip);

  return targetParts.some((entry) => {
    if (entry.includes('/')) {
      const [network, prefixText] = entry.split('/');
      if (!isIpLiteral(network)) return false;
      const prefix = Number(prefixText);
      if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
      const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
      return (ipNumber & mask) === (ipToNumber(network) & mask);
    }

    if (entry.includes('-')) {
      const match = entry.match(/^(\d{1,3}(?:\.\d{1,3}){3})-(\d{1,3}|\d{1,3}(?:\.\d{1,3}){3})$/);
      if (!match) return false;
      const startIp = match[1];
      const startParts = startIp.split('.');
      const endIp = match[2].includes('.') ? match[2] : `${startParts.slice(0, 3).join('.')}.${match[2]}`;
      if (!isIpLiteral(startIp) || !isIpLiteral(endIp)) return false;
      return ipNumber >= ipToNumber(startIp) && ipNumber <= ipToNumber(endIp);
    }

    return entry === ip;
  });
}

function ipToNumber(ip: string) {
  return ip.split('.').reduce((total, part) => ((total << 8) + Number(part)) >>> 0, 0);
}

function isIpLiteral(value: string) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => {
    const numeric = Number(part);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
  });
}

const DeviceDetails = ({
  device,
  diagnostic,
  diagnosticLoading,
  onRunDiagnostic,
}: {
  device: Device;
  diagnostic: DiagnosticResult | null;
  diagnosticLoading: string | null;
  onRunDiagnostic: (kind: 'dns' | 'ping' | 'windows' | 'passive' | 'web') => void;
}) => {
  const actions = getDeviceActions(device);
  const riskReasons = getRiskReasons(device);
  const hasWebSurface = actions.some((action) => action.kind === 'http' || action.kind === 'https');
  const webFingerprints = getWebFingerprints(device);

  return (
    <div className="panel-surface rounded-xl p-6">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded bg-scan-ink px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">{deviceTypeLabel(device.type)}</span>
            <span className="rounded border border-scan-line px-2 py-1 text-[10px] uppercase tracking-wider text-black/45">{device.source || 'desconhecido'}</span>
            <span className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${riskClass(device.riskLevel)}`}>{device.riskLevel || 'sem risco'}</span>
          </div>
          <h2 className="truncate text-3xl font-semibold">{device.name}</h2>
          <p className="mt-1 font-mono text-sm text-black/45">{device.ip}</p>
          {riskReasons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {riskReasons.map((reason) => (
                <span key={reason} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-700">
                  {reason}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={`rounded-full border px-4 py-2 font-mono text-[10px] font-bold uppercase ${device.status === 'online' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {device.status}
        </div>
      </div>

      {actions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={`${action.kind}-${action.port}`}
              onClick={() => openDeviceAction(action.href)}
              title={action.hint}
              className="flex h-9 items-center gap-2 rounded-md border border-scan-line bg-white px-3 text-xs font-bold uppercase tracking-wider text-scan-ink transition hover:border-scan-accent hover:bg-scan-accent hover:text-white"
            >
              <action.icon className="h-4 w-4" />
              {action.label}
              <ExternalLink className="h-3.5 w-3.5 opacity-60" />
            </button>
          ))}
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onRunDiagnostic('dns')}
          disabled={diagnosticLoading !== null}
          className="flex h-9 items-center gap-2 rounded-md border border-scan-line bg-white px-3 text-xs font-bold uppercase tracking-wider text-scan-ink transition hover:border-green-200 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
          title="Consultar nome, PTR, servidores DNS e ARP local"
        >
          <Search className="h-4 w-4" />
          {diagnosticLoading === 'dns' ? 'Nome...' : 'Nome/DNS'}
        </button>
        <button
          type="button"
          onClick={() => onRunDiagnostic('ping')}
          disabled={diagnosticLoading !== null}
          className="flex h-9 items-center gap-2 rounded-md border border-scan-line bg-white px-3 text-xs font-bold uppercase tracking-wider text-scan-ink transition hover:border-green-200 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
          title="Testar ICMP e portas TCP detectadas"
        >
          <Activity className="h-4 w-4" />
          {diagnosticLoading === 'ping' ? 'Testando...' : 'Ping/TCP'}
        </button>
        <button
          type="button"
          onClick={() => onRunDiagnostic('windows')}
          disabled={diagnosticLoading !== null}
          className="flex h-9 items-center gap-2 rounded-md border border-scan-line bg-white px-3 text-xs font-bold uppercase tracking-wider text-scan-ink transition hover:border-green-200 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
          title="Consultar ARP, NetBIOS, rota curta e portas via Windows local"
        >
          <Monitor className="h-4 w-4" />
          {diagnosticLoading === 'windows' ? 'Windows...' : 'Windows'}
        </button>
        {hasWebSurface && (
          <button
            type="button"
            onClick={() => onRunDiagnostic('web')}
            disabled={diagnosticLoading !== null}
            className="flex h-9 items-center gap-2 rounded-md border border-scan-line bg-white px-3 text-xs font-bold uppercase tracking-wider text-scan-ink transition hover:border-green-200 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Ler title, headers, redirects e certificado sem login nem clique na interface"
          >
            <Globe className="h-4 w-4" />
            {diagnosticLoading === 'web' ? 'Lendo...' : 'Identificar Web'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onRunDiagnostic('passive')}
          disabled={diagnosticLoading !== null}
          className="flex h-9 items-center gap-2 rounded-md border border-scan-line bg-white px-3 text-xs font-bold uppercase tracking-wider text-scan-ink transition hover:border-green-200 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
          title="Capturar por alguns segundos ARP/DNS/LLDP/CDP/host com TShark"
        >
          <Radar className="h-4 w-4" />
          {diagnosticLoading === 'passive' ? 'Capturando...' : 'Passiva'}
        </button>
      </div>

      <div className="grid gap-5">
        {webFingerprints.length > 0 && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Globe className="h-4 w-4 text-green-700" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-green-700">Web identificado</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {webFingerprints.map((item) => (
                <span key={item} className="rounded-md border border-green-200 bg-white px-2 py-1.5 font-mono text-xs leading-5 text-green-900">
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <DetailItem label="MAC" value={formatValue(device.mac)} />
          <DetailItem label="Fabricante" value={formatValue(device.vendor, 'Nao identificado')} />
          <DetailItem label="VLAN/Sub-rede" value={device.vlan} />
          <DetailItem label="Subnet" value={formatValue(device.subnet)} />
          <DetailItem label="Portas" value={device.openPorts?.join(', ') || 'Nenhuma'} />
          <DetailItem label="Latencia" value={device.latencyMs ? `${device.latencyMs} ms` : 'Nao medido'} />
          <DetailItem label="Confianca" value={device.confidence || 'low'} />
          <DetailItem label="Conectado a" value={device.parentId || 'Raiz'} />
        </div>
        <DetailList
          label="Servicos detectados"
          empty="Nenhum servico identificado"
          items={(device.services || []).map((service) => `${service.port}/${service.protocol} ${service.service || 'servico'}${service.product ? ` - ${service.product}` : ''}`)}
        />
        <DetailList label="Evidencias" empty="Sem evidencias detalhadas" items={device.evidence || []} />
        {diagnostic && <DiagnosticPanel result={diagnostic} />}
      </div>
    </div>
  );
};

const AiPanel = ({
  analyzing,
  analysis,
  onGenerate,
  onGenerateNetwork,
}: {
  analyzing: boolean;
  analysis: string | null;
  onGenerate: () => void;
  onGenerateNetwork: () => void;
}) => (
  <div className="relative overflow-hidden rounded-xl bg-scan-ink p-6 text-white shadow-[0_18px_45px_rgba(16,20,24,0.2)]">
    <ShieldCheck className="absolute right-6 top-6 h-28 w-28 text-white/5" />
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-scan-accent">
          <FileSearch className="h-4 w-4" />
        </div>
        <h3 className="text-lg font-semibold">Parecer tecnico local</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onGenerateNetwork}
          className="relative flex h-9 items-center justify-center gap-2 rounded-md border border-white/15 px-3 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white hover:text-scan-ink"
          title="Gerar parecer geral da varredura em modal"
        >
          <Network className="h-4 w-4" />
          Parecer geral
        </button>
        <button
          onClick={onGenerate}
          disabled={analyzing}
          className="relative flex h-9 items-center justify-center gap-2 rounded-md bg-white px-3 text-xs font-bold uppercase tracking-wider text-scan-ink transition hover:bg-scan-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" />
          Gerar parecer
        </button>
      </div>
    </div>
    {analyzing ? (
      <div className="space-y-3 py-2">
        <div className="h-4 w-full animate-pulse rounded bg-white/10" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-white/10" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
      </div>
    ) : (
      <div className="relative whitespace-pre-wrap font-mono text-sm leading-7 text-white/85">
        {analysis || 'Clique em Gerar parecer para consultar o Ollama apenas sobre o host selecionado.'}
      </div>
    )}
  </div>
);

const NetworkAnalysisModal = ({
  open,
  analyzing,
  analysis,
  onClose,
}: {
  open: boolean;
  analyzing: boolean;
  analysis: string | null;
  onClose: () => void;
}) => (
  <AnimatePresence>
    {open && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          className="max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-lg border border-scan-line bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-scan-line p-4">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-scan-accent" />
              <h3 className="text-sm font-semibold">Parecer geral da rede</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-scan-line px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition hover:bg-scan-ink hover:text-white"
            >
              Fechar
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-5">
            {analyzing ? (
              <div className="space-y-3">
                <div className="h-4 w-full animate-pulse rounded bg-black/10" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-black/10" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-black/10" />
              </div>
            ) : (
              <div className="whitespace-pre-wrap font-mono text-sm leading-7 text-black/75">
                {analysis || 'Sem parecer gerado.'}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

const DetailItem = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <span className="block text-[10px] font-bold uppercase tracking-widest text-black/30">{label}</span>
    <span className="mt-1 block break-words font-mono text-sm">{value}</span>
  </div>
);

const DetailList = ({ label, items, empty }: { label: string; items: string[]; empty: string }) => (
  <div className="min-w-0 border-t border-scan-line pt-4">
    <span className="block text-[10px] font-bold uppercase tracking-widest text-black/30">{label}</span>
    {items.length > 0 ? (
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item, index) => (
          <span key={`${item}-${index}`} className="rounded-md border border-scan-line bg-black/[0.02] px-2 py-1.5 font-mono text-xs leading-5 text-black/75">
            {item}
          </span>
        ))}
      </div>
    ) : (
      <p className="mt-1 font-mono text-sm text-black/45">{empty}</p>
    )}
  </div>
);

const DiagnosticPanel = ({ result }: { result: DiagnosticResult }) => (
  <div className="min-w-0 border-t border-scan-line pt-4">
    <div className="flex items-center justify-between gap-3">
      <span className="block text-[10px] font-bold uppercase tracking-widest text-black/30">Diagnostico auxiliar</span>
      <span className="rounded bg-black/5 px-2 py-1 font-mono text-[10px] font-bold text-black/45">{result.source}</span>
    </div>
    {result.error ? (
      <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{result.error}</p>
    ) : result.rows.length > 0 ? (
      <div className="mt-2 grid gap-2">
        {result.rows.slice(0, 8).map((row, index) => (
          <div key={index} className="rounded-md border border-scan-line bg-black/[0.02] p-3">
            <div className="grid gap-2 md:grid-cols-2">
              {Object.entries(row)
                .filter(([, value]) => String(value).trim())
                .slice(0, 8)
                .map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-black/30">{key}</p>
                    <p className="break-words font-mono text-xs text-black/75">{String(value)}</p>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <p className="mt-2 font-mono text-sm text-black/45">Sem registros retornados.</p>
    )}
  </div>
);

const Signal = ({ label, value, tone }: { label: string; value: number; tone: 'red' | 'orange' | 'green' }) => {
  const tones = {
    red: 'border-red-200 bg-red-50 text-red-700',
    orange: 'border-orange-200 bg-orange-50 text-orange-700',
    green: 'border-green-200 bg-green-50 text-green-700',
  };

  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-65">{label}</p>
      <p className="mt-2 font-mono text-2xl font-black">{value}</p>
    </div>
  );
};

interface DeviceAction {
  kind: string;
  label: string;
  href: string;
  hint: string;
  port: number;
  icon: React.ElementType;
}

function getDeviceActions(device: Device): DeviceAction[] {
  const ports = new Set(device.openPorts || []);
  const serviceByPort = new Map((device.services || []).map((service) => [service.port, service]));
  const actions: DeviceAction[] = [];
  const add = (action: DeviceAction) => {
    if (!actions.some((item) => item.kind === action.kind && item.port === action.port)) actions.push(action);
  };

  for (const port of ports) {
    const service = serviceByPort.get(port);
    const serviceName = `${service?.service || ''} ${service?.product || ''}`.toLowerCase();
    const looksHttps = serviceName.includes('ssl') || serviceName.includes('https') || [443, 8443].includes(port);
    const looksHttp = serviceName.includes('http') || [80, 8080, 8000, 8008, 8888].includes(port);

    if (looksHttps) {
      add({
        kind: 'https',
        label: port === 443 ? 'HTTPS' : `HTTPS :${port}`,
        href: `https://${device.ip}${port === 443 ? '' : `:${port}`}`,
        hint: `Abrir interface web segura de ${device.ip}:${port}`,
        port,
        icon: Lock,
      });
    } else if (looksHttp) {
      add({
        kind: 'http',
        label: port === 80 ? 'HTTP' : `HTTP :${port}`,
        href: `http://${device.ip}${port === 80 ? '' : `:${port}`}`,
        hint: `Abrir interface web de ${device.ip}:${port}`,
        port,
        icon: Globe,
      });
    }

    if (port === 23) {
      add({
        kind: 'telnet',
        label: 'Telnet',
        href: `telnet://${device.ip}:23`,
        hint: `Abrir cliente Telnet local para ${device.ip}. Sem login automatico.`,
        port,
        icon: Terminal,
      });
    }

    if (port === 3389) {
      add({
        kind: 'rdp',
        label: 'Baixar RDP',
        href: `/api/rdp?target=${encodeURIComponent(device.ip)}&name=${encodeURIComponent(device.name || device.ip)}`,
        hint: `Baixar arquivo .rdp pronto para ${device.ip}`,
        port,
        icon: Video,
      });
    }

    if (port === 22) {
      add({
        kind: 'ssh',
        label: 'SSH',
        href: `ssh://${device.ip}:22`,
        hint: `Abrir cliente SSH local para ${device.ip}`,
        port,
        icon: KeyRound,
      });
    }
  }

  return actions.sort((a, b) => actionOrder(a.kind) - actionOrder(b.kind) || a.port - b.port);
}

function actionOrder(kind: string) {
  return ['https', 'http', 'rdp', 'ssh', 'telnet'].indexOf(kind);
}

function openDeviceAction(href: string) {
  if (href.startsWith('http') || href.startsWith('/api/rdp')) {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }

  window.location.href = href;
}

function getRiskReasons(device: Device) {
  const ports = new Set(device.openPorts || []);
  const reasons: string[] = [];
  if (ports.has(23)) reasons.push('Telnet exposto');
  if (ports.has(3389)) reasons.push('RDP exposto');
  if ([135, 139, 445].some((port) => ports.has(port))) reasons.push('SMB/RPC exposto');
  if (device.evidence?.some((item) => item.toLowerCase().includes('risco') || item.toLowerCase().includes('telnet'))) {
    reasons.push('Evidencia critica');
  }
  if (device.riskLevel === 'high' && reasons.length === 0) reasons.push('Porta sensivel');
  return Array.from(new Set(reasons)).slice(0, 4);
}

function riskWeight(device: Device) {
  if (device.riskLevel === 'high') return 3;
  if (device.riskLevel === 'medium') return 2;
  if (device.status === 'online') return 1;
  return 0;
}

function nodeClass(device: Device) {
  if (device.status === 'offline') return 'border-black/10 text-black/35';
  if (device.riskLevel === 'high') return 'border-red-200 text-red-700 shadow-[0_0_0_3px_rgba(239,68,68,0.08)]';
  if (device.riskLevel === 'medium') return 'border-orange-200 text-orange-700';
  return 'border-green-200 text-green-700';
}

function nodeDotClass(device: Device) {
  if (device.status === 'offline') return 'bg-black/25';
  if (device.riskLevel === 'high') return 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]';
  if (device.riskLevel === 'medium') return 'bg-orange-500';
  return 'bg-green-500';
}

function deviceLabel(device: Device) {
  if (device.type === 'router') return 'RTR';
  if (device.type === 'switch') return 'SW';
  if (device.type === 'ap') return 'AP';
  if (device.type === 'server') return 'SRV';
  if (device.type === 'workstation') return 'PC';
  if (device.type === 'printer') return 'PRN';
  if (device.type === 'camera') return 'CAM';
  return device.ip.split('.').at(-1) || '?';
}

function getWebFingerprints(device: Device) {
  const fromServices = (device.services || [])
    .filter((service) => service.product && `${service.service || ''} ${service.product}`.toLowerCase().includes('fortigate')
      || `${service.service || ''} ${service.product || ''}`.toLowerCase().includes('microsoft iis')
      || `${service.service || ''} ${service.product || ''}`.toLowerCase().includes('aruba')
      || `${service.service || ''} ${service.product || ''}`.toLowerCase().includes('unifi')
      || `${service.service || ''} ${service.product || ''}`.toLowerCase().includes('pfsense')
      || `${service.service || ''} ${service.product || ''}`.toLowerCase().includes('mikrotik')
      || `${service.service || ''} ${service.product || ''}`.toLowerCase().includes('vmware')
      || `${service.service || ''} ${service.product || ''}`.toLowerCase().includes('zabbix')
      || `${service.service || ''} ${service.product || ''}`.toLowerCase().includes('ricoh')
      || `${service.service || ''} ${service.product || ''}`.toLowerCase().includes('hikvision')
      || `${service.service || ''} ${service.product || ''}`.toLowerCase().includes('dahua')
      || `${service.service || ''} ${service.product || ''}`.toLowerCase().includes('axis'))
    .map((service) => `${service.port}/${service.protocol} ${service.product}`);

  const fromEvidence = (device.evidence || [])
    .filter((item) => item.toLowerCase().startsWith('web fingerprint:'))
    .map((item) => item.replace(/^Web fingerprint:\s*/i, ''));

  return Array.from(new Set([...fromEvidence, ...fromServices])).slice(0, 6);
}

function formatValue(value?: string, fallback = 'Nao informado') {
  if (!value || value === 'NI') return fallback;
  return value;
}

function deviceTypeLabel(type: Device['type']) {
  if (type === 'unknown') return '?';
  if (type === 'ap') return 'wifi/ap';
  return type;
}

function riskClass(risk?: Device['riskLevel']) {
  if (risk === 'high') return 'bg-red-50 text-red-700';
  if (risk === 'medium') return 'bg-orange-50 text-orange-700';
  return 'bg-green-50 text-green-700';
}

function collectorClass(status: CollectorRun['status']) {
  if (status === 'completed') return 'bg-green-50 text-green-700';
  if (status === 'failed') return 'bg-red-50 text-red-700';
  if (status === 'running') return 'bg-blue-50 text-blue-700';
  return 'bg-black/5 text-black/45';
}

function progressStepClass(status: ProgressStatus) {
  if (status === 'completed') return 'border-green-200 bg-green-50 text-green-700 shadow-[0_0_0_3px_rgba(34,197,94,0.08)]';
  if (status === 'running') return 'border-green-200 bg-green-50 text-green-700 shadow-[0_0_0_3px_rgba(34,197,94,0.14)]';
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'skipped') return 'border-black/10 bg-black/[0.03] text-black/35';
  return 'border-scan-line bg-white text-black/30';
}

function progressStatusText(status: ProgressStatus) {
  if (status === 'completed') return 'concluido';
  if (status === 'running') return 'rodando';
  if (status === 'failed') return 'falhou';
  if (status === 'skipped') return 'pulado';
  if (status === 'ready') return 'pronto';
  return 'aguardando';
}
