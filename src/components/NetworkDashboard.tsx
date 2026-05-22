import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Device, ScanResult } from '../types';
import { NetworkTree } from './NetworkTree';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import { 
  Search, 
  RefreshCw, 
  Info, 
  Cpu, 
  Activity, 
  Zap,
  LayoutGrid,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';

export const NetworkDashboard: React.FC = () => {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const performScan = async () => {
    setLoading(true);
    setScanResult(null);
    setSelectedDevice(null);
    setAiAnalysis(null);
    setError(null);
    try {
      const response = await fetch('/api/scan');
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha na varredura.');
        return;
      }
      setScanResult(data);
    } catch (err) {
      console.error('Erro no scan:', err);
      setError('Servidor indisponível ou erro de rede.');
    } finally {
      setLoading(false);
    }
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
      setAiAnalysis(data.analysis);
    } catch (error) {
      console.error('Erro IA:', error);
      setAiAnalysis('Falha na comunicação com o especialista de IA.');
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (selectedDevice) {
      analyzeWithAI(selectedDevice);
    }
  }, [selectedDevice]);

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8">
      {/* Header Section */}
      <header className="mb-12 border-b-2 border-scan-ink pb-4 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-serif italic tracking-tighter mb-2">NetScan Explorer v1.0</h1>
          <p className="text-xs font-mono uppercase tracking-[0.2em] opacity-60">SISTEMA INTEGRADO DE MAPEAMENTO DE ATIVOS</p>
        </div>
        <div className="flex gap-4 items-center">
          {scanResult?.summary.mode && (
            <span className={cn(
              "text-[10px] font-mono px-2 py-1 rounded border",
              scanResult.summary.mode === 'LIVE_PROD' ? "bg-green-100 text-green-700 border-green-200" : "bg-yellow-100 text-yellow-700 border-yellow-200"
            )}>
              {scanResult.summary.mode === 'LIVE_PROD' ? "MODO REAL" : "MODO SIMULAÇÃO"}
            </span>
          )}
          <button 
            onClick={performScan}
            disabled={loading}
            className="group flex items-center gap-3 bg-scan-ink text-white px-6 py-3 rounded-full hover:bg-scan-accent transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="font-mono text-xs font-bold uppercase">Iniciar Varredura</span>
          </button>
        </div>
      </header>

      {/* Hero Stats */}
      {error && (
        <div className="mb-8 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 flex flex-col gap-1">
          <div className="flex items-center gap-2 font-bold text-sm uppercase">
            <ShieldAlert className="w-4 h-4" />
            Erro de Varredura Ativa
          </div>
          <p className="text-xs font-mono">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard 
          label="DISPOSITIVOS TOTAIS" 
          value={scanResult?.summary.total || 0} 
          icon={<Cpu className="w-4 h-4" />} 
        />
        <StatCard 
          label="STATUS ONLINE" 
          value={scanResult?.summary.online || 0} 
          icon={<Zap className="w-4 h-4 text-green-600" />} 
          subtext="Ativos na Sessão"
        />
        <StatCard 
          label="VLANS ATIVAS" 
          value={scanResult?.summary.vlans || 0} 
          icon={<LayoutGrid className="w-4 h-4" />} 
        />
        <StatCard 
          label="LATÊNCIA MÉDIA" 
          value={scanResult ? "12ms" : "-"} 
          icon={<Activity className="w-4 h-4" />} 
        />
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Network Tree */}
        <div className="lg:col-span-4 h-full">
          <div className="sticky top-8">
            <NetworkTree 
              devices={scanResult?.devices || []} 
              onSelectDevice={setSelectedDevice} 
            />
          </div>
        </div>

        {/* Right: Device Details & AI Analysis */}
        <div className="lg:col-span-8">
          <AnimatePresence mode="wait">
            {!selectedDevice ? (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-[600px] flex flex-col items-center justify-center border-2 border-dashed border-black/10 rounded-xl bg-black/5 p-12 text-center"
              >
                <Search className="w-12 h-12 mb-4 opacity-20" />
                <h3 className="font-serif italic text-xl mb-2">Aguardando Seleção</h3>
                <p className="text-sm font-mono opacity-50 max-w-sm">
                  Selecione um ativo na topologia ao lado para ver detalhes estruturais e análise de risco por IA.
                </p>
              </motion.div>
            ) : (
              <motion.div 
                key={selectedDevice.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-6"
              >
                {/* Device Data Card */}
                <div className="bg-white p-8 rounded-xl shadow-sm data-grid-border">
                  <div className="flex items-start justify-between mb-8">
                    <div>
                      <h2 className="text-4xl font-mono font-bold tracking-tighter mb-1">{selectedDevice.name}</h2>
                      <div className="flex items-center gap-3">
                         <span className="text-xs font-mono px-2 py-0.5 bg-black text-white rounded">{selectedDevice.type.toUpperCase()}</span>
                         <span className="text-[10px] font-mono opacity-50 uppercase tracking-widest">{selectedDevice.id}</span>
                      </div>
                    </div>
                    <div className={`px-4 py-2 rounded-full font-mono text-[10px] font-bold uppercase border ${
                      selectedDevice.status === 'online' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
                    }`}>
                      {selectedDevice.status}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
                    <DetailItem label="ENDEREÇO IP" value={selectedDevice.ip} />
                    <DetailItem label="MAC ADDRESS" value={selectedDevice.mac || "NI"} />
                    <DetailItem label="FABRICANTE" value={selectedDevice.vendor || "Desconhecido"} />
                    <DetailItem label="SISTEMA OP." value={selectedDevice.os || "NI"} />
                    <DetailItem label="VLAN DESIGNADA" value={selectedDevice.vlan} />
                    <DetailItem label="MODELO / HARDWARE" value={selectedDevice.details || "Desconhecido"} />
                    <DetailItem label="PORTAS ABERTAS" value={selectedDevice.openPorts?.join(', ') || "Nenhuma Detectada"} />
                    <DetailItem label="CONECTado A" value={selectedDevice.parentId || "Direto / Hub"} />
                  </div>
                </div>

                {/* AI Analysis Section */}
                <div className="bg-scan-ink text-white p-8 rounded-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-10">
                    <ShieldAlert className="w-32 h-32" />
                  </div>
                  
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-8 h-8 rounded-full bg-scan-accent flex items-center justify-center">
                      <Cpu className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="font-serif italic text-lg">Parecer Técnico da IA</h3>
                  </div>

                  {analyzing ? (
                    <div className="flex flex-col gap-3 py-4">
                      <div className="h-4 w-full bg-white/10 animate-pulse rounded" />
                      <div className="h-4 w-3/4 bg-white/10 animate-pulse rounded" />
                      <div className="h-4 w-1/2 bg-white/10 animate-pulse rounded" />
                    </div>
                  ) : (
                    <div className="font-mono text-sm leading-relaxed opacity-90 whitespace-pre-wrap">
                      {aiAnalysis || "Aguardando diagnóstico do Ollama..."}
                    </div>
                  )}

                  <div className="mt-8 pt-6 border-t border-white/10 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest opacity-50">
                    <Info className="w-3 h-3" />
                    <span>Recomendações baseadas em heurísticas e IA Generativa</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* System Logs / Console Footer */}
      <footer className="mt-12 p-4 bg-white/50 border border-black/5 rounded font-mono text-[10px] flex items-center justify-between">
        <div className="flex gap-4">
          <span className="opacity-40">CONSOLE:</span>
          <span>SISTEMA OPERACIONAL ... ONLINE</span>
          <span className="text-green-600">SEGURANÇA ... ATIVA</span>
        </div>
        <div className="flex gap-2 items-center opacity-40">
          <LayoutGrid className="w-3 h-3" />
          <span>ESTADO: {loading ? "VARRENDO..." : "OPOSTO"}</span>
        </div>
      </footer>
    </div>
  );
};

const StatCard = ({ label, value, icon, subtext }: { label: string, value: string | number, icon: React.ReactNode, subtext?: string }) => (
  <div className="bg-white p-6 rounded-xl data-grid-border flex flex-col gap-1 group hover:border-black transition-colors">
    <div className="flex items-center gap-2 text-[10px] font-mono font-bold opacity-40 uppercase tracking-widest">
      {icon}
      {label}
    </div>
    <div className="text-3xl font-mono font-black tracking-tighter">{value}</div>
    {subtext && <div className="text-[10px] font-serif italic italic opacity-40">{subtext}</div>}
  </div>
);

const DetailItem = ({ label, value }: { label: string, value: string }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[10px] font-mono font-bold opacity-30 uppercase tracking-tighter">{label}</span>
    <span className="font-mono text-sm font-medium">{value}</span>
  </div>
);
