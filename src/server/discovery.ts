import os from "os";
import dns from "dns/promises";
import net from "net";
import http from "http";
import https from "https";
import path from "path";
import fs from "fs/promises";
import zlib from "zlib";
import { execFile } from "child_process";
import { promisify } from "util";
import type {
  CollectorRun,
  Device,
  DiscoverySource,
  LocalInterface,
  LocalNetworkContext,
  RouteEntry,
  ScanResult,
  ServiceProbe,
  ToolCapability,
  VlanSummary,
} from "../types";
import { isAbortError, validateScanTarget } from "./scan-policy";

const execFileAsync = promisify(execFile);

const COMMON_PORTS = [22, 23, 53, 80, 135, 139, 443, 445, 515, 631, 3389, 5000, 5001, 8080, 8443];
const GATEWAY_HINT_PORTS = [22, 23, 80, 443, 8443];
const PORT_TIMEOUT_MS = 450;
const POOL_PROBE_TIMEOUT_MS = 140;
const WEB_FINGERPRINT_TIMEOUT_MS = 4500;
const PING_CONCURRENCY = 48;
const PORT_CONCURRENCY = 24;
const SERVICE_SCAN_HOST_LIMIT = 512;
const WNETWATCHER_TIMEOUT_MS = 120000;
const NMAP_DISCOVERY_CONCURRENCY = 2;
const NMAP_DISCOVERY_TIMEOUT_MS = 75000;
const NMAP_SERVICE_CONCURRENCY = 2;
const NMAP_SERVICE_BATCH_SIZE = 32;
const NMAP_SERVICE_TIMEOUT_MS = 120000;

interface PingResult {
  ip: string;
  online: boolean;
  latencyMs?: number;
}

interface ScanOptions {
  target: string;
  useNmap?: boolean;
  useNirsoft?: boolean;
  useWebFingerprint?: boolean;
  onProgress?: (event: ScanProgressEvent) => void;
  signal?: AbortSignal;
}

interface ParsedTarget {
  input: string;
  cidr: string;
  prefix: number;
  hosts: string[];
  nmapTargets: string[];
}

export interface ScanProgressEvent {
  type: "stage" | "snapshot" | "log";
  stage: string;
  message: string;
  timestamp: string;
  changes?: {
    deviceCount: number;
    onlineCount: number;
    collectors: Array<Pick<CollectorRun, "id" | "status" | "items" | "message">>;
  };
}

export function buildProgressChanges(devices: Device[], collectors: CollectorRun[]): NonNullable<ScanProgressEvent["changes"]> {
  return {
    deviceCount: devices.length,
    onlineCount: devices.filter((device) => device.status === "online").length,
    collectors: collectors.map(({ id, status, items, message }) => ({ id, status, items, message })),
  };
}

export function partialCollectorStatus(attempted: number, succeeded: number): CollectorRun["status"] {
  if (attempted <= 0) return "skipped";
  return succeeded > 0 ? "completed" : "failed";
}

export async function getToolCapabilities(): Promise<ToolCapability[]> {
  const [nmap, tshark, netsh, nirsoft, dnsDataView, pingInfoView, ollama] = await Promise.all([
    commandCapability("nmap", ["--version"], "active-scan", "Nmap", "Varredura ativa, ping sweep, fingerprint de servicos e exportacao estruturada.", [
      "C:\\Program Files\\Nmap\\nmap.exe",
      "C:\\Program Files (x86)\\Nmap\\nmap.exe",
    ]),
    commandCapability("tshark", ["--version"], "passive-capture", "TShark", "Captura passiva de trafego, descoberta por ARP/DHCP/LLDP quando executado com permissao.", [
      "C:\\Program Files\\Wireshark\\tshark.exe",
      "C:\\Program Files (x86)\\Wireshark\\tshark.exe",
    ]),
    commandCapability("netsh", ["interface", "show", "interface"], "windows-utility", "Netsh", "Contexto local de interfaces, WLAN e rotas no Windows."),
    commandCapability("WNetWatcher.exe", ["/?"], "windows-utility", "NirSoft Wireless Network Watcher", "Fonte auxiliar para detectar dispositivos na rede local e exportar CSV.", [
      path.join(process.cwd(), "WNetWatcher.exe"),
      path.join(process.cwd(), "tools", "nirsoft", "WNetWatcher.exe"),
      path.join(os.homedir(), "Downloads", "WNetWatcher.exe"),
    ]),
    commandCapability("DNSDataView.exe", ["/?"], "windows-utility", "NirSoft DNSDataView", "Consulta manual de registros DNS/PTR com exportacao CSV para enriquecer hosts selecionados.", [
      path.join(process.cwd(), "tools", "nirsoft", "DNSDataView.exe"),
      path.join(process.cwd(), "DNSDataView.exe"),
      path.join(os.homedir(), "Downloads", "DNSDataView.exe"),
    ]),
    commandCapability("PingInfoView.exe", ["/?"], "windows-utility", "NirSoft PingInfoView", "Teste manual de ICMP/TCP ping para hosts e portas selecionadas.", [
      path.join(process.cwd(), "tools", "nirsoft", "PingInfoView.exe"),
      path.join(process.cwd(), "PingInfoView.exe"),
      path.join(os.homedir(), "Downloads", "PingInfoView.exe"),
    ]),
    commandCapability("ollama", ["--version"], "ai", "Ollama", "Analise local dos ativos e da rede sem enviar o inventario para um servico externo."),
  ]);

  return [
    {
      id: "native",
      name: "Coletores nativos",
      category: "native",
      available: true,
      purpose: "Ping, ARP, DNS reverso e conexao TCP em portas comuns usando recursos do sistema.",
    },
    nmap,
    tshark,
    netsh,
    nirsoft,
    dnsDataView,
    pingInfoView,
    ollama,
    {
      id: "snmp",
      name: "SNMP",
      category: "planned",
      available: false,
      purpose: "Confirmar VLANs, interfaces, ARP, tabela MAC, inventario e uptime em switches/roteadores.",
      notes: "Planejado para credenciais autorizadas por cliente.",
    },
    {
      id: "ssh",
      name: "SSH/CLI",
      category: "planned",
      available: false,
      purpose: "Coletar comandos de switches quando SNMP nao entregar toda a topologia.",
      notes: "Planejado para Cisco, Aruba/HPE, MikroTik, Fortinet e outros perfis.",
    },
  ];
}

export function getDefaultCidr() {
  const preferred = getPreferredLocalInterface();
  return preferred ? safeDefaultCidr(preferred) : "192.168.1.0/24";
}

export function getDefaultScope() {
  const first = getPreferredLocalInterface();
  if (!first) return "192.168.1.0/24";
  return safeDefaultCidr(first);
}

function safeDefaultCidr(networkInterface: LocalInterface) {
  const prefix = Number(networkInterface.cidr.split("/")[1] || 32);
  if (prefix >= 20) return networkInterface.cidr;
  return `${networkInterface.address.split(".").slice(0, 3).join(".")}.0/24`;
}

function getPreferredLocalInterface() {
  const external = getLocalInterfaces().filter((entry) => !entry.internal);
  const physical = external.find((entry) => {
    const prefix = Number(entry.cidr.split("/")[1] || 32);
    return prefix <= 30 && !/warp|vpn|openvpn|tap|tunnel|virtual|loopback/i.test(entry.name);
  });
  return physical || external.find((entry) => Number(entry.cidr.split("/")[1] || 32) <= 30) || external[0];
}

export function getLocalNetworkContext(): LocalNetworkContext {
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    interfaces: getLocalInterfaces(),
    routes: [],
  };
}

export async function scanNetwork(options: ScanOptions): Promise<ScanResult> {
  validateScanTarget(options.target);
  options.signal?.throwIfAborted();
  const tools = await getToolCapabilities();
  options.signal?.throwIfAborted();
  const context = getLocalNetworkContext();
  const collectors: CollectorRun[] = [];
  const targets = parseTargets(options.target);
  const primaryTarget = targets.map((target) => target.input).join(", ");
  const nativeTargets = targets.filter((target) => target.prefix >= 24 || target.hosts.length > 0);
  const broadTargets = targets.filter((target) => target.prefix < 24 && target.hosts.length === 0);
  const devices: Device[] = [];
  const notes = [
    "Esta execucao nao usa dados mockados. Se nada aparecer, o resultado real foi vazio ou bloqueado por firewall/permissao.",
    "O escopo total respeita MAX_SCAN_ADDRESSES; redes amplas devem ser divididas em blocos menores ou liberadas conscientemente.",
    "VLANs exibidas como sub-rede sao inferidas. VLAN confirmada exige SNMP/SSH em switches, roteadores ou controladoras.",
    "A topologia fisica sera mais precisa quando houver LLDP/CDP, tabela MAC e ARP coletadas dos equipamentos de camada 2/3.",
  ];

  const emit = (type: ScanProgressEvent["type"], stage: string, message: string, changes?: ScanProgressEvent["changes"]) => {
    options.onProgress?.({
      type,
      stage,
      message,
      timestamp: new Date().toISOString(),
      changes,
    });
  };

  const snapshot = (stage: string, message: string) => {
    emit("snapshot", stage, message, buildProgressChanges(devices, collectors));
  };

  emit("stage", "setup", `Escopo normalizado: ${primaryTarget}`);

  const nativeCollector = createCollector("native", "Native discovery", "native", "running");
  collectors.push(nativeCollector);
  emit("stage", "native", `Iniciando coletor nativo em ${nativeTargets.length} alvo(s) /24-/30.`);

  for (const target of nativeTargets) {
    const { cidr, hosts } = target;
    emit("stage", "native", `Ping/ARP em ${cidr} (${hosts.length} hosts).`);
    const pingResults = await mapLimit(hosts, PING_CONCURRENCY, (ip) => pingHost(ip, options.signal), options.signal);
    const arpTable = await getArpTable(options.signal);
    const candidates = new Set<string>();

    for (const result of pingResults) {
      if (result.online) candidates.add(result.ip);
    }
    for (const ip of arpTable.keys()) {
      if (hosts.includes(ip)) candidates.add(ip);
    }

    const onlineByIp = new Map(pingResults.map((result) => [result.ip, result]));
    mergeDevices(devices, await buildNativeDevices(Array.from(candidates), cidr, arpTable, onlineByIp, options.signal));
    snapshot("native", `Coletor nativo encontrou ${devices.length} ativo(s) ate agora.`);
  }

  finishCollector(
    nativeCollector,
    "completed",
    devices.length,
    broadTargets.length
      ? `Varreu ${nativeTargets.length} alvo(s) /24-/30; ${broadTargets.length} alvo(s) amplo(s) ficaram para Nmap.`
      : `Encontrou ${devices.length} candidatos por ICMP/ARP/TCP.`,
  );
  snapshot("native", nativeCollector.message);

  const nmapTool = tools.find((tool) => tool.id === "nmap");
  if (options.useNmap && nmapTool?.available) {
    const nmapCollector = createCollector("nmap", "Nmap service probe", "nmap", "running");
    collectors.push(nmapCollector);
    snapshot("nmap", `Iniciando Nmap em ${targets.length} alvo(s).`);
    try {
      const nmapResult = await runNmap(
        targets,
        nmapTool.command || "nmap",
        devices.map((device) => device.ip),
        emit,
        options.signal,
      );
      mergeDevices(devices, nmapResult.devices);

      const successfulSteps = nmapResult.discoverySucceeded + nmapResult.probeSucceeded;
      const attemptedSteps = nmapResult.discoveryAttempted + nmapResult.probeAttempted;
      const warningText = nmapResult.warnings.length > 0
        ? ` ${nmapResult.warnings.length} lote(s) falharam sem descartar os demais.`
        : "";
      const message = `Nmap concluiu ${successfulSteps}/${attemptedSteps} lote(s) e enriqueceu ${nmapResult.devices.length} ativo(s).${warningText}`;

      if (nmapResult.warnings.length > 0) {
        notes.push(...nmapResult.warnings.slice(0, 8).map((warning) => `Nmap parcial: ${warning}`));
      }

      finishCollector(
        nmapCollector,
        partialCollectorStatus(attemptedSteps, successfulSteps),
        nmapResult.devices.length,
        successfulSteps > 0 ? message : nmapResult.warnings[0] || "Nmap nao concluiu nenhum lote.",
      );
      snapshot("nmap", nmapCollector.message);
    } catch (error) {
      if (isAbortError(error)) throw error;
      finishCollector(nmapCollector, "failed", 0, error instanceof Error ? error.message : "Falha ao executar Nmap.");
      snapshot("nmap", nmapCollector.message);
    }
  } else {
    collectors.push(createCollector(
      "nmap",
      "Nmap service probe",
      "nmap",
      "skipped",
      nmapTool?.available ? "Desativado nesta execucao." : "Nmap nao encontrado no PATH.",
    ));
    snapshot("nmap", "Nmap ignorado nesta execucao.");
  }

  const nirsoftTool = tools.find((tool) => tool.id === "wnetwatcher.exe");
  if (options.useNirsoft !== false && nirsoftTool?.available) {
    const nirsoftCollector = createCollector("nirsoft", "NirSoft Wireless Network Watcher", "nirsoft", "running");
    collectors.push(nirsoftCollector);
    snapshot("nirsoft", "Iniciando importacao do NirSoft WNetWatcher.");
    try {
      const nirsoftDevices = await runWirelessNetworkWatcher(nirsoftTool.command || "WNetWatcher.exe", options.signal);
      mergeDevices(devices, nirsoftDevices);
      finishCollector(nirsoftCollector, "completed", nirsoftDevices.length, `Importou ${nirsoftDevices.length} ativos do NirSoft.`);
      snapshot("nirsoft", nirsoftCollector.message);
    } catch (error) {
      if (isAbortError(error)) throw error;
      finishCollector(nirsoftCollector, "skipped", 0, error instanceof Error ? error.message : "WNetWatcher nao retornou dados nesta execucao.");
      snapshot("nirsoft", nirsoftCollector.message);
    }
  } else {
    collectors.push(createCollector(
      "nirsoft",
      "NirSoft Wireless Network Watcher",
      "nirsoft",
      "skipped",
      nirsoftTool?.available ? "Desativado nesta execucao." : "WNetWatcher.exe nao encontrado.",
    ));
    snapshot("nirsoft", "NirSoft ignorado nesta execucao.");
  }

  if (options.useWebFingerprint) {
    options.signal?.throwIfAborted();
    const webCollector = createCollector("web", "Web fingerprint", "web", "running");
    collectors.push(webCollector);
    snapshot("web", "Identificando interfaces HTTP/HTTPS sem login ou clique.");
    const webFindings = await enrichWebFingerprints(devices, options.signal);
    finishCollector(
      webCollector,
      "completed",
      webFindings,
      webFindings > 0
        ? `Identificou ${webFindings} interface(s) web com evidencia forte.`
        : "Nenhuma assinatura web forte encontrada nos ativos com HTTP/HTTPS.",
    );
    snapshot("web", webCollector.message);
  } else {
    collectors.push(createCollector(
      "web",
      "Web fingerprint",
      "web",
      "skipped",
      "Desativado nesta execucao.",
    ));
    snapshot("web", "Fingerprint web ignorado nesta execucao.");
  }

  const telnetCollector = createCollector("telnet", "Telnet exposure check", "tcp", "running");
  collectors.push(telnetCollector);
  snapshot("telnet", "Testando exposicao Telnet em ativos com porta 23 aberta.");
  options.signal?.throwIfAborted();
  const telnetFindings = await enrichTelnetExposure(devices, options.signal);
  finishCollector(
    telnetCollector,
    "completed",
    telnetFindings,
    telnetFindings > 0
      ? `Confirmou Telnet exposto em ${telnetFindings} ativo(s), sem tentativa de login.`
      : "Nenhum Telnet aberto confirmado nos ativos descobertos.",
  );
  snapshot("telnet", telnetCollector.message);

  const tsharkTool = tools.find((tool) => tool.id === "tshark");
  collectors.push(createCollector(
    "tshark",
    "Passive capture",
    "tshark",
    "skipped",
    tsharkTool?.available
      ? "Disponivel no diagnostico Passivo de cada host; nao executado automaticamente para evitar captura global desnecessaria."
      : "TShark/Wireshark CLI nao encontrado no PATH.",
  ));

  inferTopology(devices);
  options.signal?.throwIfAborted();

  const finalResult = buildResult(primaryTarget, devices, notes, collectors, tools, context);
  emit("stage", "done", "Varredura finalizada; enviando resultado consolidado.");
  return finalResult;
}

function getLocalInterfaces(): LocalInterface[] {
  const interfaces = os.networkInterfaces();
  const result: LocalInterface[] = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4") {
        result.push({
          name,
          address: entry.address,
          netmask: entry.netmask,
          cidr: maskToCidr(entry.address, entry.netmask),
          mac: entry.mac,
          internal: entry.internal,
        });
      }
    }
  }

  return result;
}

function maskToCidr(address: string, netmask: string) {
  const prefix = netmask
    .split(".")
    .map(Number)
    .reduce((bits, octet) => bits + octet.toString(2).split("1").length - 1, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipToNumber(address) & mask;
  return `${numberToIp(network)}/${prefix}`;
}

function parseTargets(rawTarget: string) {
  const targets = rawTarget
    .split(/[\s,;]+/)
    .map((target) => target.trim())
    .filter(Boolean);

  if (targets.length === 0) {
    throw new Error("Informe ao menos um alvo. Exemplo: 10.10.100.1-254 ou 10.10.100.0/24");
  }

  const parsed = targets.map(parseTarget);
  const seen = new Set<string>();
  return parsed.filter((target) => {
    const key = `${target.input}|${target.hosts.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseTarget(target: string): ParsedTarget {
  if (target.includes("/") ) return parseCidr(target);
  if (target.includes("-")) return parseIpRange(target);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(target)) {
    validateIp(target);
    const cidr = `${target}/32`;
    return { input: target, cidr, prefix: 32, hosts: [target], nmapTargets: [target] };
  }

  throw new Error("Alvo invalido. Use CIDR ou range. Exemplos: 10.10.100.1-254, 10.10.100.10-10.10.100.80, 10.10.100.0/24");
}

function parseCidr(cidr: string): ParsedTarget {
  const match = cidr.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match) throw new Error("CIDR invalido. Exemplo: 192.168.1.0/24");

  const ip = match[1];
  const prefix = Number(match[2]);
  validateIp(ip);
  if (prefix < 16 || prefix > 32) {
    throw new Error("Use um intervalo entre /16 e /32. Para algo maior, divida o escopo.");
  }

  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipToNumber(ip) & mask;
  const broadcast = network | (~mask >>> 0);
  const hosts: string[] = [];
  if (prefix === 32) {
    hosts.push(ip);
  } else if (prefix >= 24) {
    for (let host = network + 1; host < broadcast; host += 1) {
      hosts.push(numberToIp(host));
    }
  }

  const normalized = `${numberToIp(network)}/${prefix}`;
  return { input: normalized, cidr: normalized, prefix, hosts, nmapTargets: [normalized] };
}

function parseIpRange(rawRange: string): ParsedTarget {
  const match = rawRange.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})-(\d{1,3}|\d{1,3}(?:\.\d{1,3}){3})$/);
  if (!match) {
    throw new Error("Range invalido. Exemplos: 10.10.100.1-254 ou 10.10.100.10-10.10.100.80");
  }

  const startIp = match[1];
  const endText = match[2];
  const startParts = startIp.split(".").map(Number);
  validateIp(startIp);
  const endIp = endText.includes(".") ? endText : `${startParts.slice(0, 3).join(".")}.${endText}`;
  validateIp(endIp);

  const start = ipToNumber(startIp);
  const end = ipToNumber(endIp);
  if (end < start) throw new Error("Range invalido: IP final menor que IP inicial.");
  if (end - start > 4095) throw new Error("Range muito grande. Divida o escopo em blocos menores.");

  const hosts: string[] = [];
  for (let ip = start; ip <= end; ip += 1) {
    hosts.push(numberToIp(ip));
  }

  const subnet = `${startParts.slice(0, 3).join(".")}.0/24`;
  return {
    input: rawRange,
    cidr: subnet,
    prefix: 24,
    hosts,
    nmapTargets: [toNmapRange(startIp, endIp)],
  };
}

function toNmapRange(startIp: string, endIp: string) {
  const startParts = startIp.split(".");
  const endParts = endIp.split(".");
  if (startParts.slice(0, 3).join(".") === endParts.slice(0, 3).join(".")) {
    return `${startParts.slice(0, 3).join(".")}.${startParts[3]}-${endParts[3]}`;
  }

  return `${startIp}-${endIp}`;
}

function validateIp(ip: string) {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw new Error(`IP invalido: ${ip}`);
  }
}

function isIpLiteral(value: string) {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => {
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

async function buildNativeDevices(ips: string[], cidr: string, arpTable: Map<string, string>, onlineByIp: Map<string, PingResult>, signal?: AbortSignal) {
  const gatewayIp = ips.find((ip) => ip.endsWith(".1")) || ips[0];
  const gatewayId = gatewayIp ? deviceId(gatewayIp) : undefined;

  return mapLimit(ips.sort((a, b) => ipToNumber(a) - ipToNumber(b)), 16, async (ip): Promise<Device> => {
    signal?.throwIfAborted();
    const services = await scanPorts(ip, signal);
    const ports = services.map((service) => service.port);
    const mac = arpTable.get(ip);
    const name = await lookupName(ip);
    const type = inferType({ ip, ports, mac, name });
    const id = deviceId(ip);

    return {
      id,
      name,
      ip,
      mac,
      vendor: mac ? "Fabricante via OUI pendente" : "Desconhecido",
      type,
      vlan: `Sub-rede ${cidr}`,
      status: "online",
      parentId: id === gatewayId ? undefined : gatewayId,
      details: type === "unknown" ? "Detectado por ICMP/ARP; tipo nao confirmado" : "Classificacao inferida por evidencia local",
      openPorts: ports,
      services,
      lastSeen: new Date().toISOString(),
      subnet: cidr,
      source: arpTable.has(ip) ? "arp" : "native",
      latencyMs: onlineByIp.get(ip)?.latencyMs,
      confidence: ports.length > 0 || mac ? "medium" : "low",
      riskLevel: inferRisk(ports),
      evidence: [
        onlineByIp.get(ip)?.online ? "ICMP respondeu" : "Presente em ARP local",
        ports.length > 0 ? `Portas abertas: ${ports.join(", ")}` : "Sem portas comuns abertas",
      ],
    };
  }, signal);
}

async function pingHost(ip: string, signal?: AbortSignal): Promise<PingResult> {
  const start = Date.now();
  const args = process.platform === "win32" ? ["-n", "1", "-w", "650", ip] : ["-c", "1", "-W", "1", ip];
  try {
    await execFileAsync("ping", args, { timeout: 1200, signal });
    return { ip, online: true, latencyMs: Date.now() - start };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { ip, online: false };
  }
}

async function getArpTable(signal?: AbortSignal) {
  const entries = new Map<string, string>();
  try {
    const { stdout } = await execFileAsync("arp", ["-a"], { timeout: 2500, signal });
    const regex = /(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F:-]{11,17})/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(stdout)) !== null) {
      entries.set(match[1], match[2].replaceAll("-", ":").toUpperCase());
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    // ARP is opportunistic.
  }
  return entries;
}

async function scanPorts(ip: string, signal?: AbortSignal): Promise<ServiceProbe[]> {
  const checks = await mapLimit(COMMON_PORTS, PORT_CONCURRENCY, async (port) => ({
    port,
    open: await isPortOpen(ip, port, signal),
  }), signal);

  return checks
    .filter((check) => check.open)
    .map((check) => ({
      port: check.port,
      protocol: "tcp",
      state: "open",
      service: serviceName(check.port),
    }));
}

async function isPortOpen(ip: string, port: number, signal?: AbortSignal) {
  return isPortOpenWithTimeout(ip, port, PORT_TIMEOUT_MS, signal);
}

async function isPortOpenWithTimeout(ip: string, port: number, timeoutMs: number, signal?: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve(open);
    };
    const onAbort = () => done(false);

    if (signal?.aborted) return done(false);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, ip);
  });
}

async function lookupName(ip: string) {
  try {
    const names = await dns.reverse(ip);
    return names[0];
  } catch {
    return `host-${ip.split(".").at(-1)}`;
  }
}

async function runNmap(
  targets: ParsedTarget[],
  command: string,
  seedIps: string[] = [],
  emit?: (type: ScanProgressEvent["type"], stage: string, message: string) => void,
  signal?: AbortSignal,
): Promise<NmapRunResult> {
  signal?.throwIfAborted();
  const discovered = new Set(seedIps.filter(isIpLiteral));
  const devices: Device[] = [];
  const warnings: string[] = [];
  const discoveryTargets = expandNmapDiscoveryTargets(targets);
  emit?.("stage", "nmap", `Nmap ping sweep em ${discoveryTargets.length} alvo(s), com ${discovered.size} IP(s) ja encontrados pelo coletor nativo.`);

  const discoveryRuns = await mapLimit(discoveryTargets, NMAP_DISCOVERY_CONCURRENCY, async (target, index) => {
    signal?.throwIfAborted();
    emit?.("stage", "nmap", `Nmap descoberta: alvo ${index + 1}/${discoveryTargets.length} (${target}).`);
    try {
      const { stdout } = await execFileAsync(
        command,
        ["-sn", "-n", "-T4", "--max-retries", "1", "--host-timeout", "8s", "-PE", "-PS22,80,443,445", "-PA80,443,445", "-oG", "-", target],
        { timeout: NMAP_DISCOVERY_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 8, windowsHide: true, signal },
      );
      return { target, stdout, ok: true };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return { target, stdout: commandPartialStdout(error), ok: false, error: formatCommandFailure(error) };
    }
  }, signal);

  let discoverySucceeded = 0;
  for (const run of discoveryRuns) {
    if (run.ok) discoverySucceeded += 1;
    else warnings.push(`descoberta ${run.target}: ${run.error}`);
    for (const line of run.stdout.split(/\r?\n/)) {
      const hostMatch = line.match(/^Host:\s+(\S+).+Status:\s+Up/);
      if (hostMatch) discovered.add(hostMatch[1]);
    }
    emit?.("stage", "nmap", `Nmap descoberta: ${discovered.size} host(s) up ate agora.`);
  }

  if (discovered.size === 0) {
    return {
      devices,
      warnings,
      discoverySucceeded,
      discoveryAttempted: discoveryRuns.length,
      probeSucceeded: 0,
      probeAttempted: 0,
    };
  }

  const discoveredIps = Array.from(discovered).sort((a, b) => ipToNumber(a) - ipToNumber(b));
  const probeIps = discoveredIps.slice(0, SERVICE_SCAN_HOST_LIMIT);
  emit?.("stage", "nmap", `Nmap servicos: sondando ${probeIps.length}/${discoveredIps.length} host(s) descobertos.`);

  const probeBatches = chunkItems(probeIps, NMAP_SERVICE_BATCH_SIZE);
  const probeRuns = await mapLimit(probeBatches, NMAP_SERVICE_CONCURRENCY, async (batch, index) => {
    signal?.throwIfAborted();
    emit?.("stage", "nmap", `Nmap servicos: lote ${index + 1}/${probeBatches.length} (${batch.length} host(s)).`);
    try {
      const { stdout } = await execFileAsync(
        command,
        [
          "-n", "-Pn", "-T4", "--max-retries", "1", "--host-timeout", "20s",
          "-oG", "-", "-sV", "--version-light", "-p", COMMON_PORTS.join(","), ...batch,
        ],
        { timeout: NMAP_SERVICE_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 8, windowsHide: true, signal },
      );
      return { index, stdout, ok: true };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return { index, stdout: commandPartialStdout(error), ok: false, error: formatCommandFailure(error) };
    }
  }, signal);

  let probeSucceeded = 0;
  const probed = new Set<string>();
  for (const run of probeRuns) {
    if (run.ok) probeSucceeded += 1;
    else warnings.push(`servicos lote ${run.index + 1}/${probeRuns.length}: ${run.error}`);

    for (const line of run.stdout.split(/\r?\n/)) {
      const hostMatch = line.match(/^Host:\s+(\S+)\s+\(([^)]*)\)\s+Ports:\s+(.+)$/);
      if (!hostMatch) continue;

      const [, ip, rawName, rawPorts] = hostMatch;
      probed.add(ip);
      const services = rawPorts.split(",").flatMap((entry): ServiceProbe[] => {
        const parts = entry.trim().split("/");
        if (parts.length < 5 || parts[1] !== "open") return [];
        return [{
          port: Number(parts[0]),
          state: "open",
          protocol: parts[2] === "udp" ? "udp" : "tcp",
          service: parts[4] || undefined,
          product: parts.slice(6).join(" ").trim() || undefined,
        }];
      });
      const ports = services.map((service) => service.port);

      const name = rawName || `host-${ip.split(".").at(-1)}`;
      const type = inferType({ ip, ports, name, services });

      devices.push({
        id: deviceId(ip),
        name,
        ip,
        type,
        vlan: `Sub-rede ${bestSubnetForIp(ip, targets)}`,
        status: "online",
        details: type === "unknown" ? "Enriquecido por Nmap; tipo nao confirmado" : "Enriquecido por Nmap",
        openPorts: ports,
        services,
        subnet: bestSubnetForIp(ip, targets),
        source: "nmap",
        confidence: "high",
        riskLevel: inferRisk(ports),
        evidence: ["Nmap ping sweep", "Nmap service/version probe"],
      });
    }
  }

  for (const ip of discoveredIps) {
    if (probed.has(ip)) continue;
    const subnet = bestSubnetForIp(ip, targets);
    devices.push({
      id: deviceId(ip),
      name: `host-${ip.split(".").at(-1)}`,
      ip,
      type: ip.endsWith(".1") ? "router" : "unknown",
      vlan: `Sub-rede ${subnet}`,
      status: "online",
      details: discoveredIps.length > SERVICE_SCAN_HOST_LIMIT ? "Detectado por Nmap ping sweep; servico nao sondado por limite de escala" : "Detectado por Nmap ping sweep",
      openPorts: [],
      services: [],
      subnet,
      source: "nmap",
      confidence: "medium",
      riskLevel: "low",
      evidence: ["Nmap ping sweep"],
    });
  }

  return {
    devices,
    warnings,
    discoverySucceeded,
    discoveryAttempted: discoveryRuns.length,
    probeSucceeded,
    probeAttempted: probeRuns.length,
  };
}

function commandPartialStdout(error: unknown) {
  const stdout = (error as { stdout?: unknown })?.stdout;
  return typeof stdout === "string" ? stdout : "";
}

function formatCommandFailure(error: unknown) {
  const failure = error as { killed?: boolean; signal?: string; stderr?: unknown; message?: string };
  if (failure?.killed) return "tempo limite excedido";
  const stderr = typeof failure?.stderr === "string" ? failure.stderr.split(/\r?\n/).find(Boolean) : undefined;
  if (stderr) return stderr.trim().slice(0, 240);
  const message = failure?.message?.split(/\r?\n/).find(Boolean);
  return (message || `falha ao executar comando${failure?.signal ? ` (${failure.signal})` : ""}`).slice(0, 240);
}

function expandNmapDiscoveryTargets(targets: ParsedTarget[]) {
  const expanded: string[] = [];

  for (const target of targets) {
    if (target.hosts.length > 0 || target.prefix >= 24) {
      expanded.push(...target.nmapTargets);
      continue;
    }

    const [networkIp] = target.cidr.split("/");
    const network = ipToNumber(networkIp);
    const subnetCount = 2 ** (24 - target.prefix);
    for (let index = 0; index < subnetCount; index += 1) {
      const subnetNetwork = network + (index << 8);
      expanded.push(numberToIp(subnetNetwork + 1));
      expanded.push(numberToIp(subnetNetwork + 254));
    }
  }

  return Array.from(new Set(expanded));
}

async function runWirelessNetworkWatcher(command: string, signal?: AbortSignal): Promise<Device[]> {
  const outputFile = path.join(os.tmpdir(), `wnetwatcher-${Date.now()}.csv`);
  const configFile = path.join(os.tmpdir(), `wnetwatcher-${Date.now()}.cfg`);
  try {
    const preferredInterface = getPreferredLocalInterface();
    const range = preferredInterface ? cidrHostRange(preferredInterface.cidr) : undefined;
    if (!range) throw new Error("Nao foi possivel determinar a faixa IPv4 da interface fisica local.");

    await fs.writeFile(configFile, [
      "[General]",
      "UseNetworkAdapter=0",
      "UseIPAddressesRange=1",
      `IPAddressFrom=${range.from}`,
      `IPAddressTo=${range.to}`,
      "ScanOnProgramStart=1",
      "BackgroundScan=0",
      "AutoShowAdvancedOptions=0",
      "ScanIPv6Addresses=0",
      "ShowInactiveDevices=0",
      "ShowPrevDevices=0",
      "",
    ].join("\r\n"), "utf-8");

    signal?.throwIfAborted();
    await execFileAsync(command, ["/cfg", configFile, "/scomma", outputFile], { timeout: WNETWATCHER_TIMEOUT_MS, windowsHide: true, signal });
    const csv = await readTextFileWhenReady(outputFile, 5000, undefined, signal);
    return parseWNetWatcherCsv(csv);
  } catch (error) {
    if (isAbortError(error)) throw error;
    const partialCsv = await readTextFileWhenReady(outputFile, 1500, undefined, signal).catch(() => "");
    const partialDevices = partialCsv ? parseWNetWatcherCsv(partialCsv) : [];
    if (partialDevices.length > 0) return partialDevices;

    const seconds = Math.round(WNETWATCHER_TIMEOUT_MS / 1000);
    const details = error instanceof Error && error.message ? ` Detalhe: ${error.message.split(/\r?\n/)[0]}` : "";
    throw new Error(`WNetWatcher nao exportou CSV em ${seconds}s e foi ignorado. Confira F9/Advanced Options no NirSoft para adaptador/range ou deixe NirSoft desmarcado; Nmap e coletores nativos continuam.${details}`);
  } finally {
    await fs.unlink(outputFile).catch(() => undefined);
    await fs.unlink(configFile).catch(() => undefined);
  }
}

function cidrHostRange(cidr: string) {
  const match = cidr.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match) return undefined;
  const prefix = Number(match[2]);
  if (prefix < 20 || prefix > 30) return undefined;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipToNumber(match[1]) & mask;
  const broadcast = network | (~mask >>> 0);
  return {
    from: numberToIp(network + 1),
    to: numberToIp(broadcast - 1),
  };
}

export async function runDnsLookup(target: string) {
  const rows: Record<string, string>[] = [
    { Item: "Alvo", Resultado: target },
    { Item: "Servidores DNS locais", Resultado: dns.getServers().join(", ") || "Nao informado pelo sistema" },
  ];
  const targetIsIp = isIpLiteral(target);

  if (targetIsIp) {
    const ptrName = `${target.split(".").reverse().join(".")}.in-addr.arpa`;
    rows.push({ Item: "Consulta PTR", Resultado: ptrName });
    try {
      const names = await dns.reverse(target);
      rows.push(...names.map((name) => ({ Item: "PTR encontrado", Resultado: name })));
    } catch {
      rows.push({ Item: "PTR encontrado", Resultado: "Nao existe registro reverso para este IP" });
    }

    const arpTable = await getArpTable();
    rows.push({ Item: "MAC via ARP local", Resultado: arpTable.get(target) || "Nao apareceu na tabela ARP local" });
  } else {
    try {
      const addresses = await dns.lookup(target, { all: true });
      rows.push(...addresses.map((entry) => ({ Item: `Resolucao IPv${entry.family}`, Resultado: entry.address })));
    } catch {
      rows.push({ Item: "Resolucao direta", Resultado: "Nome nao resolveu em A/AAAA" });
    }
  }

  const command = await resolveCommand("DNSDataView.exe", [
    path.join(process.cwd(), "tools", "nirsoft", "DNSDataView.exe"),
    path.join(process.cwd(), "DNSDataView.exe"),
    path.join(os.homedir(), "Downloads", "DNSDataView.exe"),
  ]);

  if (command) {
    const outputFile = path.join(os.tmpdir(), `dnsdataview-${Date.now()}.csv`);
    const configFile = path.join(os.tmpdir(), `dnsdataview-${Date.now()}.cfg`);
    try {
      await execFileAsync(command, [
        "/cfg", configFile,
        "/Domains", target,
        "/ARecords", "1",
        "/AAAARecords", "1",
        "/CNAMERecords", "1",
        "/NSRecords", "1",
        "/MXRecords", "1",
        "/SOARecords", "1",
        "/PTRRecords", "1",
        "/SRVRecords", "1",
        "/scomma", outputFile,
      ], { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 });
      const csv = await readTextFileWhenReady(outputFile);
      const dnsDataRows = parseCsvRecords(csv).slice(0, 30);
      if (dnsDataRows.length > 0) {
        rows.push(...dnsDataRows.map((row) => ({
          Item: row.Type || row["Record Type"] || "DNSDataView",
          Nome: row.HostName || row.Name || row.Host || target,
          Resultado: row.Data || row.Value || row.Address || JSON.stringify(row),
        })));
      } else {
        rows.push({ Item: "DNSDataView", Resultado: "Executou, mas nao retornou registros adicionais" });
      }
      return {
        source: "Nome/DNS",
        rows,
      };
    } finally {
      await fs.unlink(outputFile).catch(() => undefined);
      await fs.unlink(configFile).catch(() => undefined);
    }
  }

  return {
    source: "Nome/DNS",
    rows,
  };
}

export async function runPingDiagnostics(target: string, ports: number[] = []) {
  const uniquePorts = Array.from(new Set(ports.filter((port) => Number.isFinite(port)).slice(0, 12)));
  const ping = await pingHost(target);
  const tcp = await mapLimit(uniquePorts, 6, async (port) => ({
    port,
    open: await isPortOpen(target, port),
  }));

  const rows: Record<string, string>[] = [
    { Teste: "ICMP nativo", Alvo: target, Resultado: ping.online ? "online" : "sem resposta", Latencia: ping.latencyMs ? `${ping.latencyMs} ms` : "" },
    ...tcp.map((entry) => ({ Teste: "TCP nativo", Alvo: `${target}:${entry.port}`, Resultado: entry.open ? "aberta" : "fechada/filtrada", Latencia: "" })),
  ];

  const command = await resolveCommand("PingInfoView.exe", [
    path.join(process.cwd(), "tools", "nirsoft", "PingInfoView.exe"),
    path.join(process.cwd(), "PingInfoView.exe"),
    path.join(os.homedir(), "Downloads", "PingInfoView.exe"),
  ]);

  if (command) {
    const hostsFile = path.join(os.tmpdir(), `pinginfoview-hosts-${Date.now()}.txt`);
    const outputFile = path.join(os.tmpdir(), `pinginfoview-${Date.now()}.xml`);
    const targets = [target, ...uniquePorts.map((port) => `${target}:${port}`)];
    try {
      await fs.writeFile(hostsFile, targets.join("\r\n"), "utf-8");
      await execFileAsync(command, [
        "/loadfile", hostsFile,
        "/sxml", outputFile,
        "/PingEvery", "0",
        "/StartPingImmediately", "1",
        "/PingTimeout", "1500",
        "/ResolveAddresses", "0",
      ], { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 });

      const xml = await readTextFileWhenReady(outputFile, 5000, /<\/pings_list>/i);
      const nirsoftRows = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)).slice(0, 20);
      rows.push(...nirsoftRows.map((match) => ({
        Teste: "PingInfoView",
        Alvo: readSimpleXmlTag(match[1], "ip_address") || target,
        Resultado: readSimpleXmlTag(match[1], "last_ping_status") || "executado",
        Latencia: formatPingInfoLatency(readSimpleXmlTag(match[1], "average_ping_time")),
      })));
      if (nirsoftRows.length === 0) {
        rows.push({ Teste: "PingInfoView", Alvo: target, Resultado: "executou sem linhas adicionais", Latencia: "" });
      }
    } catch (error) {
      rows.push({ Teste: "PingInfoView", Alvo: target, Resultado: `falhou sem interromper o diagnostico: ${formatCommandFailure(error)}`, Latencia: "" });
    } finally {
      await fs.unlink(hostsFile).catch(() => undefined);
      await fs.unlink(outputFile).catch(() => undefined);
    }
  }

  return {
    source: command ? "ICMP/TCP nativo + PingInfoView" : "ICMP/TCP nativo",
    rows,
  };
}

function readSimpleXmlTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return (match?.[1] || "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPingInfoLatency(value: string) {
  if (!value.trim()) return "";
  const latency = Number(value);
  return Number.isFinite(latency) ? `${latency.toFixed(1)} ms` : "";
}

export async function runWindowsDiagnostics(target: string, ports: number[] = []) {
  const rows: Record<string, string>[] = [];
  const arpTable = await getArpTable();
  rows.push({ Item: "ARP local", Resultado: arpTable.get(target) || "Sem MAC na tabela ARP local" });

  const route = await runCommandRows("tracert", ["-d", "-h", "4", "-w", "700", target], 8000);
  const firstHop = route
    .map((row) => row.Output)
    .find((line) => /\s\d{1,3}(?:\.\d{1,3}){3}\s*$/.test(line) && !line.includes(target));
  rows.push({ Item: "Primeiro salto", Resultado: firstHop?.trim() || "Nao identificado via tracert curto" });

  const netbios = await runCommandRows("nbtstat", ["-A", target], 5000);
  const netbiosNames = netbios
    .map((row) => row.Output)
    .filter((line) => /<\d{2}>/.test(line))
    .slice(0, 6)
    .map((line) => line.trim());
  rows.push({ Item: "NetBIOS", Resultado: netbiosNames.join(" | ") || "Sem resposta NetBIOS" });

  const uniquePorts = Array.from(new Set(ports.filter((port) => Number.isFinite(port)).slice(0, 16)));
  const tcp = await mapLimit(uniquePorts, 6, async (port) => ({
    port,
    open: await isPortOpen(target, port),
  }));
  rows.push(...tcp.map((entry) => ({
    Item: `TCP ${entry.port}`,
    Resultado: entry.open ? "aberta" : "fechada/filtrada",
  })));

  if (tcp.some((entry) => entry.port === 3389 && entry.open)) {
    rows.push({ Item: "RDP", Resultado: "Porta 3389 aberta; perfil .rdp disponivel nas acoes do host" });
  }

  return {
    source: "Windows local",
    rows,
  };
}

export async function runPassiveCapture(target: string, seconds = 10) {
  const command = await resolveCommand("tshark", [
    "C:\\Program Files\\Wireshark\\tshark.exe",
    "C:\\Program Files (x86)\\Wireshark\\tshark.exe",
  ]);
  if (!command) {
    return {
      source: "TShark passivo",
      rows: [{ Item: "TShark", Resultado: "Nao encontrado. Instale Wireshark/TShark para captura passiva." }],
    };
  }

  const duration = Math.min(Math.max(Math.round(seconds), 5), 20);
  const interfaces = await listTsharkInterfaces(command);
  const captureInterface = chooseTsharkInterface(interfaces);
  if (!captureInterface) {
    return {
      source: "TShark passivo",
      rows: [{ Item: "Interfaces", Resultado: "TShark nao retornou interfaces de captura." }],
    };
  }

  const displayFilter = `(arp or dns or lldp or cdp or ip.addr == ${target})`;
  try {
    const { stdout } = await execFileAsync(command, [
      "-i", captureInterface.id,
      "-a", `duration:${duration}`,
      "-Y", displayFilter,
      "-T", "fields",
      "-E", "separator=|",
      "-E", "quote=n",
      "-e", "frame.time_relative",
      "-e", "_ws.col.Protocol",
      "-e", "eth.src",
      "-e", "eth.dst",
      "-e", "ip.src",
      "-e", "ip.dst",
      "-e", "_ws.col.Info",
    ], { timeout: (duration + 8) * 1000, windowsHide: true, maxBuffer: 1024 * 1024 * 8 });

    const rows = stdout.split(/\r?\n/).filter(Boolean).slice(0, 30).map((line) => {
      const [time, protocol, ethSrc, ethDst, ipSrc, ipDst, info] = line.split("|");
      return {
        Tempo: time ? `${Number(time).toFixed(2)}s` : "",
        Protocolo: protocol || "",
        Origem: ipSrc || ethSrc || "",
        Destino: ipDst || ethDst || "",
        Info: info || "",
      };
    });

    return {
      source: "TShark passivo",
      rows: rows.length > 0 ? rows : [{ Item: "Captura", Resultado: `Nada relevante em ${duration}s (${displayFilter}) na interface ${captureInterface.description}` }],
    };
  } catch (error) {
    return {
      source: "TShark passivo",
      rows: [{
        Item: "Captura",
        Resultado: error instanceof Error
          ? `Falhou: ${error.message.split(/\r?\n/)[0]}`
          : "Falhou ao executar TShark.",
      }],
    };
  }
}

export async function runWebFingerprint(target: string, ports: number[] = []): Promise<{ source: string; rows: Record<string, string>[] }> {
  const candidates = webCandidates(target, ports);
  const rows = await mapLimit(candidates, 3, async (candidate) => {
    const result = await probeWeb(candidate.url);
    if (!result.ok) {
      return {
        URL: candidate.url,
        Status: "sem resposta",
        Produto: "nao confirmado",
        Evidencia: result.error || "timeout/recusado",
      };
    }

    const fingerprint = fingerprintWeb(result);
    return {
      URL: result.finalUrl,
      Status: result.status ? String(result.status) : "conectou",
      Produto: fingerprint.product || "nao confirmado",
      Tipo: fingerprint.type || "nao confirmado",
      Confianca: fingerprint.confidence || "baixa",
      Titulo: result.title || "",
      Servidor: result.headers.server || "",
      Redirect: result.redirects.join(" -> "),
      Certificado: result.certificate || "",
      Evidencia: fingerprint.evidence.join(" | ") || result.sample || "HTTP respondeu sem assinatura clara",
    };
  });

  return {
    source: "Web fingerprint",
    rows: rows.length > 0 ? rows : [{ Item: "Web", Resultado: "Nenhuma porta web conhecida para testar neste host." }],
  };
}

export async function discoverPools(rawTarget: string) {
  const scopes = buildPoolScopes(rawTarget);
  const candidates = Array.from(new Set(scopes.flatMap((scope) => gatewayCandidates(scope))));
  const arpTable = await getArpTable();
  const evidence = new Map<string, { pool: string; hits: Set<string>; sources: Set<string> }>();

  const addEvidence = (ip: string, source: string) => {
    if (!isPoolCandidateIp(ip) || !scopes.some((scope) => ipInParsedTarget(ip, scope))) return;
    const pool = `${ip.split(".").slice(0, 3).join(".")}.0/24`;
    const current = evidence.get(pool) || { pool, hits: new Set<string>(), sources: new Set<string>() };
    current.hits.add(ip);
    current.sources.add(source);
    evidence.set(pool, current);
  };

  for (const ip of arpTable.keys()) {
    addEvidence(ip, "ARP local");
  }

  const gatewaySignals = await mapLimit(candidates, 96, async (ip) => {
    const openPort = await firstOpenGatewayPort(ip);
    return openPort ? { ip, source: `Gateway hint TCP/${openPort}` } : undefined;
  });

  for (const signal of gatewaySignals) {
    if (signal) addEvidence(signal.ip, signal.source);
  }

  const rows = Array.from(evidence.values())
    .sort((a, b) => ipToNumber(a.pool.split("/")[0]) - ipToNumber(b.pool.split("/")[0]))
    .map((item) => {
      const hits = Array.from(item.hits).sort((a, b) => ipToNumber(a) - ipToNumber(b));
      return {
        Pool: item.pool,
        Evidencias: formatEvidenceIps(hits),
        Hosts: String(hits.length),
      Fontes: Array.from(item.sources).join(", "),
      Confianca: item.sources.has("ARP local") && item.sources.size > 1 ? "alta" : "media",
      };
    });

  return {
    source: "ARP + gateway hints",
    rows: rows.length > 0 ? rows : [{ Pool: "Nenhum pool adicional inferido", Evidencias: "Sem gateway .1/.254 ou ARP local nos escopos testados", Fontes: "probe", Confianca: "baixa" }],
  };
}

interface WebCandidate {
  url: string;
  port: number;
  scheme: "http" | "https";
}

export interface WebProbeResult {
  ok: boolean;
  finalUrl: string;
  status?: number;
  headers: Record<string, string>;
  redirects: string[];
  title?: string;
  sample?: string;
  bodyText: string;
  certificate?: string;
  error?: string;
}

export type WebDiagnosticRow = Record<string, string> & {
  URL: string;
  Status: string;
  Produto: string;
  Tipo: string;
  Confianca: string;
  Titulo: string;
  Servidor: string;
  Redirect: string;
  Certificado: string;
  Evidencia: string;
};

function webCandidates(target: string, ports: number[]): WebCandidate[] {
  const uniquePorts = Array.from(new Set(ports.filter((port) => Number.isFinite(port) && port > 0 && port <= 65535)));
  const detectedWebPorts = uniquePorts.filter((port) => [80, 443, 5000, 5001, 8000, 8008, 8080, 8443, 8888].includes(port));
  const fallbackPorts = detectedWebPorts.length ? detectedWebPorts : [443, 8443, 80, 8080];
  const candidates: WebCandidate[] = [];

  for (const port of fallbackPorts.slice(0, 8)) {
    const schemes: Array<"http" | "https"> = [443, 5001, 8443].includes(port) ? ["https"] : ["http"];
    if (![80, 443].includes(port) && !schemes.includes("https")) schemes.push("https");
    for (const scheme of schemes) {
      candidates.push({
        scheme,
        port,
        url: `${scheme}://${target}${defaultPort(scheme) === port ? "" : `:${port}`}/`,
      });
    }
  }

  return candidates;
}

function defaultPort(scheme: "http" | "https") {
  return scheme === "https" ? 443 : 80;
}

async function probeWeb(url: string, redirects: string[] = []): Promise<WebProbeResult> {
  try {
    const response = await httpRequest(url);
    const location = response.headers.location;
    if (response.status && response.status >= 300 && response.status < 400 && location && redirects.length < 2) {
      const nextUrl = new URL(location, url).toString();
      return probeWeb(nextUrl, [...redirects, `${response.status} ${nextUrl}`]);
    }

    const bodyText = htmlToText(response.body).slice(0, 5000);
    return {
      ok: true,
      finalUrl: url,
      status: response.status,
      headers: response.headers,
      redirects,
      title: extractTitle(response.body),
      sample: bodyText.slice(0, 220),
      bodyText: response.body.slice(0, 6000),
      certificate: response.certificate,
    };
  } catch (error) {
    return {
      ok: false,
      finalUrl: url,
      headers: {},
      redirects,
      bodyText: "",
      error: error instanceof Error ? error.message : "falha na conexao",
    };
  }
}

function httpRequest(urlText: string): Promise<{ status?: number; headers: Record<string, string>; body: string; certificate?: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText);
    const client = url.protocol === "https:" ? https : http;
    const request = client.request({
      method: "GET",
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      rejectUnauthorized: false,
      timeout: WEB_FINGERPRINT_TIMEOUT_MS,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.3",
        "User-Agent": "RuneScanNetwork/1.0 web-fingerprint",
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      const certificate = url.protocol === "https:" ? formatCertificate(response.socket) : undefined;
      response.on("data", (chunk: Buffer) => {
        if (Buffer.concat(chunks).length < 512 * 1024) chunks.push(chunk);
      });
      response.on("end", () => {
        const headers = normalizeHeaders(response.headers);
        const body = decodeResponseBody(Buffer.concat(chunks), headers["content-encoding"]);
        resolve({
          status: response.statusCode,
          headers,
          body,
          certificate,
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });
    request.on("error", reject);
    request.end();
  });
}

function decodeResponseBody(buffer: Buffer, encoding = "") {
  try {
    const normalized = encoding.toLowerCase();
    if (normalized.includes("gzip")) return zlib.gunzipSync(buffer).toString("utf8");
    if (normalized.includes("deflate")) return zlib.inflateSync(buffer).toString("utf8");
    if (normalized.includes("br")) return zlib.brotliDecompressSync(buffer).toString("utf8");
    return buffer.toString("utf8");
  } catch {
    return buffer.toString("utf8");
  }
}

function normalizeHeaders(headers: http.IncomingHttpHeaders) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) normalized[key.toLowerCase()] = value.join(", ");
    else if (value) normalized[key.toLowerCase()] = String(value);
  }
  if (normalized["set-cookie"]) {
    normalized["set-cookie"] = normalized["set-cookie"]
      .split(",")
      .map((cookie) => cookie.split("=")[0]?.trim())
      .filter(Boolean)
      .join(", ");
  }
  return normalized;
}

function formatCertificate(socket: NodeJS.ReadableStream | null) {
  if (!socket) return undefined;
  const secureSocket = socket as NodeJS.ReadableStream & {
    getPeerCertificate?: () => { subject?: Record<string, string>; issuer?: Record<string, string>; valid_to?: string };
  };
  const cert = secureSocket.getPeerCertificate?.();
  if (!cert || Object.keys(cert).length === 0) return undefined;
  const subject = cert.subject?.CN || cert.subject?.O || "";
  const issuer = cert.issuer?.CN || cert.issuer?.O || "";
  return [subject ? `CN=${subject}` : "", issuer ? `Issuer=${issuer}` : "", cert.valid_to ? `Valido ate ${cert.valid_to}` : ""].filter(Boolean).join(" / ");
}

function extractTitle(html: string) {
  return decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function htmlToText(html: string) {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function fingerprintWeb(result: WebProbeResult) {
  const text = [
    result.finalUrl,
    result.title || "",
    result.bodyText,
    result.headers.server || "",
    result.headers["www-authenticate"] || "",
    result.headers["set-cookie"] || "",
    result.certificate || "",
  ].join(" ").toLowerCase();

  const rules: Array<{ product: string; type: string; confidence: string; needles: string[] }> = [
    { product: "Lenovo XClarity Controller", type: "server management", confidence: "alta", needles: ["xclarity controller", "lenovo xclarity", "cn=xcc-", " xcc-"] },
    { product: "Dell iDRAC", type: "server management", confidence: "alta", needles: ["idrac", "integrated dell remote access"] },
    { product: "HPE iLO", type: "server management", confidence: "alta", needles: ["hpe ilo", " hp ilo", "integrated lights-out", "cn=ilo"] },
    { product: "Supermicro BMC/IPMI", type: "server management", confidence: "alta", needles: ["supermicro", "ipmi login"] },
    { product: "OpenBMC", type: "server management", confidence: "alta", needles: ["openbmc", "bmcweb"] },
    { product: "IBM Integrated Management Module", type: "server management", confidence: "alta", needles: ["integrated management module", "ibm imm", "imm2"] },
    { product: "Cisco Device", type: "switch", confidence: "alta", needles: ["cisco switch", "cisco router", "cisco systems", "cisco web", "cisco ios", "cisco"] },
    { product: "FortiGate/Fortinet", type: "router/firewall", confidence: "alta", needles: ["fortigate", "fortinet", "fortiguard", "fortitoken"] },
    { product: "Aruba/Instant On", type: "wifi/ap", confidence: "alta", needles: ["aruba", "instant on", "airwave", "virtual controller"] },
    { product: "UniFi/Ubiquiti", type: "wifi/ap", confidence: "alta", needles: ["unifi", "ubiquiti"] },
    { product: "pfSense", type: "router/firewall", confidence: "alta", needles: ["pfsense"] },
    { product: "MikroTik RouterOS", type: "router", confidence: "alta", needles: ["mikrotik", "routeros", "winbox"] },
    { product: "VMware ESXi", type: "server/hypervisor", confidence: "alta", needles: ["vmware esx", "vmware esxi", "id_eesx_welcome", "esx welcome"] },
    { product: "Microsoft IIS", type: "server/web", confidence: "alta", needles: ["microsoft-iis", " iis7", "internet information services"] },
    { product: "Zabbix", type: "monitoramento", confidence: "alta", needles: ["zabbix"] },
    { product: "Ricoh", type: "printer", confidence: "alta", needles: ["ricoh", "web image monitor"] },
    { product: "Hikvision", type: "camera", confidence: "alta", needles: ["hikvision"] },
    { product: "Dahua", type: "camera", confidence: "alta", needles: ["dahua"] },
    { product: "Axis", type: "camera", confidence: "alta", needles: ["axis communications", "axis network camera"] },
  ];

  for (const rule of rules) {
    const evidence = rule.needles.filter((needle) => text.includes(needle));
    if (evidence.length > 0) {
      return { product: rule.product, type: rule.type, confidence: rule.confidence, evidence };
    }
  }

  const weakEvidence = [
    result.title ? `title: ${result.title}` : "",
    result.headers.server ? `server: ${result.headers.server}` : "",
    result.headers["www-authenticate"] ? `auth: ${result.headers["www-authenticate"]}` : "",
    result.certificate ? `cert: ${result.certificate}` : "",
  ].filter(Boolean);

  return { product: "", type: "", confidence: weakEvidence.length ? "baixa" : "", evidence: weakEvidence };
}

export function managementIdentityFromRows(rows: Array<Record<string, string>>) {
  const text = rows.map((row) => `${row.Produto || ""} ${row.Tipo || ""} ${row.Certificado || ""}`).join(" ").toLowerCase();
  const signatures: Array<{ needles: string[]; vendor: string; hostname: RegExp }> = [
    { needles: ["lenovo xclarity", "xcc-"], vendor: "Lenovo", hostname: /^XCC[-_]/i },
    { needles: ["dell idrac", "idrac"], vendor: "Dell Technologies", hostname: /^iDRAC[-_]/i },
    { needles: ["hpe ilo", "hp ilo", "lights-out"], vendor: "Hewlett Packard Enterprise", hostname: /^(?:iLO|IL)[-_]?/i },
    { needles: ["supermicro bmc", "supermicro", "ipmi"], vendor: "Supermicro", hostname: /^(?:BMC|SMC)[-_]/i },
    { needles: ["openbmc", "bmcweb"], vendor: "OpenBMC", hostname: /^(?:BMC|OpenBMC)[-_]?/i },
    { needles: ["ibm integrated management", "ibm imm", "imm2"], vendor: "IBM", hostname: /^IMM\d?[-_]/i },
  ];
  const signature = signatures.find((item) => item.needles.some((needle) => text.includes(needle)));
  if (!signature) return undefined;

  const certificateNames = rows
    .map((row) => row.Certificado?.match(/(?:^|\s)CN=([^/,\s]+)/i)?.[1])
    .filter((name): name is string => Boolean(name));
  const name = certificateNames.find((candidate) => signature.hostname.test(candidate));
  return { vendor: signature.vendor, name };
}

async function firstOpenGatewayPort(ip: string) {
  const checks = await Promise.all(GATEWAY_HINT_PORTS.map(async (port) => ({
    port,
    open: await isPortOpenWithTimeout(ip, port, POOL_PROBE_TIMEOUT_MS),
  })));
  return checks.find((check) => check.open)?.port;
}

function formatEvidenceIps(ips: string[]) {
  const visible = ips.slice(0, 12).join(", ");
  return ips.length > 12 ? `${visible} ... (+${ips.length - 12})` : visible;
}

function isPoolCandidateIp(ip: string) {
  if (!isIpLiteral(ip)) return false;
  const [a, b, , d] = ip.split(".").map(Number);
  if (d === 0 || d === 255) return false;
  if (a === 224 || a === 239) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

function ipInParsedTarget(ip: string, target: ParsedTarget) {
  const ipNumber = ipToNumber(ip);
  const [networkIp, prefixText] = target.cidr.split("/");
  const prefix = Number(prefixText);
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNumber & mask) === (ipToNumber(networkIp) & mask);
}

function buildPoolScopes(rawTarget: string) {
  try {
    const parsed = parseTargets(rawTarget);
    const broad = parsed.filter((target) => target.prefix < 24);
    if (broad.length > 0) return broad;
    return parsed.map((target) => {
      const [network] = target.cidr.split("/");
      const parts = network.split(".");
      const cidr = `${parts[0]}.${parts[1]}.0.0/16`;
      return parseCidr(cidr);
    });
  } catch {
    return [parseCidr(getDefaultScope())];
  }
}

function gatewayCandidates(scope: ParsedTarget) {
  const [networkIp] = scope.cidr.split("/");
  if (scope.prefix >= 24) {
    const parts = networkIp.split(".");
    return [`${parts[0]}.${parts[1]}.${parts[2]}.1`, `${parts[0]}.${parts[1]}.${parts[2]}.254`];
  }

  const candidates: string[] = [];
  const network = ipToNumber(networkIp);
  const subnetCount = 2 ** (24 - scope.prefix);
  for (let index = 0; index < subnetCount; index += 1) {
    const subnetNetwork = network + (index << 8);
    candidates.push(numberToIp(subnetNetwork + 1), numberToIp(subnetNetwork + 254));
  }
  return candidates;
}

export function buildRdpProfile(target: string) {
  return [
    "screen mode id:i:2",
    "use multimon:i:0",
    "desktopwidth:i:1920",
    "desktopheight:i:1080",
    "session bpp:i:32",
    "compression:i:1",
    "keyboardhook:i:2",
    "audiocapturemode:i:0",
    "videoplaybackmode:i:1",
    `full address:s:${target}`,
    "prompt for credentials:i:1",
    "authentication level:i:2",
    "enablecredsspsupport:i:1",
    "gatewayusagemethod:i:4",
    "redirectclipboard:i:1",
    "redirectprinters:i:0",
    "redirectcomports:i:0",
    "redirectsmartcards:i:1",
    "",
  ].join("\r\n");
}

async function listTsharkInterfaces(command: string) {
  try {
    const { stdout } = await execFileAsync(command, ["-D"], { timeout: 5000, windowsHide: true });
    return stdout.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^(\d+)\.\s+(.+)$/);
      if (!match) return [];
      return [{ id: match[1], description: match[2].trim() }];
    });
  } catch {
    return [];
  }
}

function chooseTsharkInterface(interfaces: Array<{ id: string; description: string }>) {
  const localNames = getLocalInterfaces()
    .filter((entry) => !entry.internal)
    .map((entry) => entry.name.toLowerCase());

  const byLocalName = interfaces.find((entry) => localNames.some((name) => entry.description.toLowerCase().includes(name)));
  if (byLocalName) return byLocalName;

  const physical = interfaces.find((entry) => /wi-fi|wifi|ethernet/i.test(entry.description) && !/loopback|tap|openvpn|conex.o local\*/i.test(entry.description));
  if (physical) return physical;

  return interfaces.find((entry) => !/loopback|tap|openvpn|etwdump|conex.o local\*/i.test(entry.description)) || interfaces[0];
}

async function runCommandRows(command: string, args: string[], timeout: number) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 });
    return (stdout || stderr).split(/\r?\n/).filter((line) => line.trim()).map((line) => ({ Output: line }));
  } catch (error) {
    return [{ Output: error instanceof Error ? error.message.split(/\r?\n/)[0] : `Falha ao executar ${command}` }];
  }
}

function parseWNetWatcherCsv(csv: string): Device[] {
  const rows = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length < 2) return [];

  const records = parseCsvRecords(csv, (header) => header.toLowerCase().replaceAll(" ", ""));
  return records.flatMap((record): Device[] => {
    const ip = record.ipaddress || "";
    if (!ip) return [];

    const name = record.devicename || record.computername || `host-${ip.split(".").at(-1)}`;
    const mac = record.macaddress || undefined;
    const vendor = record.networkadaptercompany || undefined;
    const active = (record.active || "yes").toLowerCase();
    const subnet = `${ip.split(".").slice(0, 3).join(".")}.0/24`;

    return [{
      id: deviceId(ip),
      name,
      ip,
      mac,
      vendor,
      type: inferType({ ip, ports: [], mac, name, vendor }),
      vlan: `Sub-rede ${subnet}`,
      status: active === "no" ? "offline" : "online",
      details: record.deviceinformation || "Importado do NirSoft WNetWatcher",
      openPorts: [],
      services: [],
      subnet,
      source: "nirsoft",
      confidence: mac ? "medium" : "low",
      riskLevel: "low",
      evidence: ["NirSoft Wireless Network Watcher export"],
    }];
  });
}

function parseCsvRecords(csv: string, normalizeHeader: (header: string) => string = (header) => header) {
  const rows = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length < 2) return [];

  const headers = splitCsvLine(rows[0]).map(normalizeHeader);
  return rows.slice(1).map((row) => {
    const values = splitCsvLine(row);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function mergeDevices(target: Device[], incoming: Device[]) {
  const byId = new Map(target.map((device) => [device.id, device]));
  for (const device of incoming) {
    const current = byId.get(device.id);
    if (!current) {
      target.push(device);
      byId.set(device.id, device);
      continue;
    }

    current.name = device.name || current.name;
    current.openPorts = Array.from(new Set([...(current.openPorts || []), ...(device.openPorts || [])])).sort((a, b) => a - b);
    current.services = mergeServices(current.services || [], device.services || []);
    current.source = current.source === "arp" ? "arp" : device.source;
    current.confidence = "high";
    current.riskLevel = inferRisk(current.openPorts);
    current.type = inferType({
      ip: current.ip,
      ports: current.openPorts || [],
      mac: current.mac,
      name: current.name,
      vendor: current.vendor,
      services: current.services,
    });
    current.details = [current.details, device.details].filter(Boolean).join(" / ");
    current.evidence = Array.from(new Set([...(current.evidence || []), ...(device.evidence || [])]));
  }
}

function mergeServices(a: ServiceProbe[], b: ServiceProbe[]) {
  const merged = new Map<string, ServiceProbe>();
  for (const service of [...a, ...b]) {
    merged.set(`${service.protocol}-${service.port}`, { ...merged.get(`${service.protocol}-${service.port}`), ...service });
  }
  return Array.from(merged.values()).sort((left, right) => left.port - right.port);
}

async function enrichTelnetExposure(devices: Device[], signal?: AbortSignal) {
  const telnetDevices = devices.filter((device) => device.openPorts?.includes(23));
  const results = await mapLimit(telnetDevices, 12, async (device) => {
    signal?.throwIfAborted();
    const banner = await probeTelnetBanner(device.ip, signal);
    if (banner === null) return false;

    const services = device.services || [];
    const existing = services.find((service) => service.protocol === "tcp" && service.port === 23);
    if (existing) {
      existing.state = "open";
      existing.service = existing.service || "telnet";
      existing.product = banner || existing.product || "Telnet respondeu sem banner";
    } else {
      services.push({
        port: 23,
        protocol: "tcp",
        state: "open",
        service: "telnet",
        product: banner || "Telnet respondeu sem banner",
      });
    }

    device.services = services;
    device.openPorts = Array.from(new Set([...(device.openPorts || []), 23])).sort((a, b) => a - b);
    device.riskLevel = "high";
    device.confidence = "high";
    device.evidence = Array.from(new Set([
      ...(device.evidence || []),
      banner ? `Telnet exposto: ${banner}` : "Telnet exposto: porta 23 aceitou conexao",
      "Sem tentativa de login ou envio de credenciais",
    ]));
    return true;
  }, signal);

  return results.filter(Boolean).length;
}

async function enrichWebFingerprints(devices: Device[], signal?: AbortSignal) {
  const webDevices = devices
    .filter((device) => device.status === "online" && webPorts(device).length > 0)
    .slice(0, 256);

  const results = await mapLimit(webDevices, 8, async (device) => {
    signal?.throwIfAborted();
    const diagnostic = await runWebFingerprint(device.ip, webPorts(device));
    const strongRows = diagnostic.rows.filter(isStrongWebRow);
    if (strongRows.length === 0) return 0;

    const services = device.services || [];
    for (const row of strongRows) {
      const port = webPortFromUrl(row.URL);
      const existing = services.find((service) => service.protocol === "tcp" && service.port === port);
      const product = [row.Produto, row.Titulo && row.Titulo !== row.Produto ? row.Titulo : ""].filter(Boolean).join(" - ");
      if (existing) {
        existing.service = existing.service || (row.URL.startsWith("https://") ? "https" : "http");
        existing.product = existing.product ? mergeProduct(existing.product, product) : product;
      } else {
        services.push({
          port,
          protocol: "tcp",
          state: "open",
          service: row.URL.startsWith("https://") ? "https" : "http",
          product,
        });
      }
    }

    device.services = mergeServices(services, []);
    device.type = strongerType(device.type, strongRows);
    const managementIdentity = managementIdentityFromRows(strongRows);
    const identityEvidence: string[] = [];
    if (managementIdentity) {
      if (device.vendor && !isPlaceholderVendor(device.vendor) && device.vendor !== managementIdentity.vendor) {
        identityEvidence.push(`Fabricante do MAC: ${device.vendor}; interface de gerenciamento: ${managementIdentity.vendor}`);
      }
      device.vendor = managementIdentity.vendor;
      if (managementIdentity.name && isGenericDeviceName(device.name, device.ip)) device.name = managementIdentity.name;
      device.details = `Controladora de gerenciamento do servidor identificada como ${strongRows[0].Produto}`;
    }
    device.confidence = "high";
    device.evidence = Array.from(new Set([
      ...(device.evidence || []),
      ...strongRows.map((row) => `Web fingerprint: ${row.Produto}${row.Tipo ? ` (${row.Tipo})` : ""} em ${row.URL}`),
      ...strongRows.filter((row) => row.Certificado).map((row) => `Identidade TLS: ${row.Certificado}`),
      ...identityEvidence,
    ]));
    return strongRows.length;
  }, signal);

  return results.reduce((total, count) => total + count, 0);
}

function isStrongWebRow(row: Record<string, string>): row is WebDiagnosticRow {
  return Boolean(row.URL && row.Produto && row.Produto !== "nao confirmado" && row.Confianca === "alta");
}

function webPorts(device: Device) {
  const serviceByPort = new Map((device.services || []).map((service) => [service.port, service]));
  return (device.openPorts || []).filter((port) => {
    if ([80, 443, 5000, 5001, 8000, 8008, 8080, 8443, 8888].includes(port)) return true;
    const service = serviceByPort.get(port);
    const text = `${service?.service || ""} ${service?.product || ""}`.toLowerCase();
    return text.includes("http") || text.includes("ssl");
  });
}

function webPortFromUrl(urlText: string) {
  try {
    const url = new URL(urlText);
    if (url.port) return Number(url.port);
    return url.protocol === "https:" ? 443 : 80;
  } catch {
    return 80;
  }
}

function mergeProduct(current: string, next: string) {
  if (!next || current.toLowerCase().includes(next.toLowerCase())) return current;
  if (next.toLowerCase().includes(current.toLowerCase())) return next;
  return `${current}; ${next}`;
}

function isPlaceholderVendor(vendor?: string) {
  return !vendor || /desconhecido|unknown|generic|oui pendente/i.test(vendor);
}

function isGenericDeviceName(name: string, ip: string) {
  return !name || name === ip || /^host-\d+$/i.test(name) || /^unknown$/i.test(name);
}

function strongerType(current: Device["type"], rows: Record<string, string>[]): Device["type"] {
  const text = rows.map((row) => `${row.Produto} ${row.Tipo}`).join(" ").toLowerCase();
  if (hasAny(text, ["fortigate", "fortinet", "pfsense", "mikrotik", "router/firewall"])) return "router";
  if (hasAny(text, ["cisco", "switch"])) return "switch";
  if (hasAny(text, ["aruba", "unifi", "ubiquiti", "wifi/ap"])) return "ap";
  if (hasAny(text, ["ricoh", "printer"])) return "printer";
  if (hasAny(text, ["hikvision", "dahua", "axis", "camera"])) return "camera";
  if (hasAny(text, ["server", "iis", "esxi", "idrac", "ilo", "xclarity", "xcc-", "openbmc", "supermicro bmc", "integrated management module", "zabbix"])) return "server";
  return current;
}

async function probeTelnetBanner(ip: string, signal?: AbortSignal) {
  return new Promise<string | null>((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let banner = "";

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve(value);
    };
    const onAbort = () => finish(null);

    if (signal?.aborted) return finish(null);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.setTimeout(1800);
    socket.once("connect", () => {
      setTimeout(() => finish(cleanTelnetBanner(banner)), 700);
    });
    socket.on("data", (chunk) => {
      banner += chunk.toString("utf8");
      if (banner.length >= 160) {
        finish(cleanTelnetBanner(banner));
      }
    });
    socket.once("timeout", () => finish(banner ? cleanTelnetBanner(banner) : null));
    socket.once("error", () => finish(null));
    socket.connect(23, ip);
  });
}

function cleanTelnetBanner(raw: string) {
  const cleaned = raw
    .replace(/\uFFFD/g, " ")
    .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || !/[a-z0-9]/i.test(cleaned)) return "";
  return cleaned.slice(0, 120);
}

function inferTopology(devices: Device[]) {
  const gatewaysBySubnet = new Map<string, Device>();
  for (const device of devices) {
    if (device.subnet && device.ip.endsWith(".1")) gatewaysBySubnet.set(device.subnet, device);
  }

  for (const device of devices) {
    const gateway = device.subnet ? gatewaysBySubnet.get(device.subnet) : undefined;
    if (gateway && device.id !== gateway.id && !device.parentId) {
      device.parentId = gateway.id;
    }
  }
}

function buildResult(
  target: string,
  devices: Device[],
  notes: string[],
  collectors: CollectorRun[],
  tools: ToolCapability[],
  localContext: LocalNetworkContext,
): ScanResult {
  const vlans = summarizeVlans(devices);
  const subnets = new Set(devices.map((device) => device.subnet).filter(Boolean));
  const openPorts = devices.reduce((total, device) => total + (device.openPorts?.length || 0), 0);

  return {
    timestamp: new Date().toISOString(),
    mode: "live",
    target,
    devices,
    vlans,
    discoveryNotes: notes,
    collectors,
    tools,
    localContext,
    summary: {
      total: devices.length,
      online: devices.filter((device) => device.status === "online").length,
      vlans: vlans.length,
      subnets: subnets.size,
      openPorts,
      highRisk: devices.filter((device) => device.riskLevel === "high").length,
    },
  };
}

function summarizeVlans(devices: Device[]): VlanSummary[] {
  const grouped = new Map<string, Device[]>();
  for (const device of devices) {
    const key = device.vlan || device.subnet || "Desconhecida";
    grouped.set(key, [...(grouped.get(key) || []), device]);
  }

  return Array.from(grouped.entries()).map(([name, items], index) => ({
    id: `segment-${index + 1}`,
    name,
    subnet: items[0]?.subnet || "NI",
    deviceCount: items.length,
    onlineCount: items.filter((item) => item.status === "online").length,
    confidence: name.startsWith("VLAN") ? "confirmed" : "inferred",
  }));
}

function createCollector(id: string, name: string, source: DiscoverySource, status: CollectorRun["status"], message = ""): CollectorRun {
  const now = new Date().toISOString();
  return {
    id,
    name,
    source,
    status,
    startedAt: status === "running" ? now : undefined,
    finishedAt: status === "skipped" ? now : undefined,
    items: 0,
    message,
  };
}

function finishCollector(collector: CollectorRun, status: CollectorRun["status"], items: number, message: string) {
  collector.status = status;
  collector.items = items;
  collector.message = message;
  collector.finishedAt = new Date().toISOString();
}

async function commandCapability(
  command: string,
  args: string[],
  category: ToolCapability["category"],
  name: string,
  purpose: string,
  candidates: string[] = [],
): Promise<ToolCapability> {
  const resolved = await resolveCommand(command, candidates);
  if (!resolved) {
    return {
      id: command.toLowerCase(),
      name,
      category,
      available: false,
      command,
      purpose,
      notes: "Nao encontrado no PATH nem nos caminhos conhecidos.",
    };
  }

  const portableExecutables = new Set([
    "wnetwatcher.exe",
    "dnsdataview.exe",
    "pinginfoview.exe",
  ]);

  if (portableExecutables.has(command.toLowerCase())) {
    return {
      id: command.toLowerCase(),
      name,
      category,
      available: true,
      command: resolved,
      version: "Portable executable",
      purpose,
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(resolved, args, { timeout: 3500, windowsHide: true });
    return {
      id: command.toLowerCase(),
      name,
      category,
      available: true,
      command: resolved,
      version: firstVersionLine(stdout || stderr),
      purpose,
    };
  } catch {
    return {
      id: command.toLowerCase(),
      name,
      category,
      available: false,
      command: resolved,
      purpose,
      notes: "Encontrado, mas nao respondeu ao teste de versao.",
    };
  }
}

async function resolveCommand(command: string, candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  try {
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(lookup, [command], { timeout: 2500, windowsHide: true });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || command;
  } catch {
    return undefined;
  }
}

function firstVersionLine(output: string) {
  return output.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
}

function bestSubnetForIp(ip: string, targets: ParsedTarget[]) {
  const ipNumber = ipToNumber(ip);
  const matches = targets
    .filter((target) => {
      const [networkIp, prefixText] = target.cidr.split("/");
      const prefix = Number(prefixText);
      const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
      return (ipNumber & mask) === (ipToNumber(networkIp) & mask);
    })
    .sort((a, b) => b.prefix - a.prefix);

  if (!matches[0]) return `${ip.split(".").slice(0, 3).join(".")}.0/24`;
  if (matches[0].prefix < 24) return `${ip.split(".").slice(0, 3).join(".")}.0/24`;
  return matches[0].cidr;
}

function inferType(context: { ip: string; ports: number[]; mac?: string; name?: string; vendor?: string; services?: ServiceProbe[] }): Device["type"] {
  const { ip, ports, mac, name = "", vendor = "", services = [] } = context;
  const text = [
    name,
    vendor,
    mac,
    ...services.flatMap((service) => [service.service || "", service.product || ""]),
  ].join(" ").toLowerCase();
  const host = name.toLowerCase();
  const hasWindowsRemote = ports.includes(3389) && [135, 139, 445].some((port) => ports.includes(port));
  const hasServerName = /(^|[^a-z0-9])(dc|dct|ad|rds|rdp|bkp|backup|epo|esx|vcenter|srv|server|sql|db|fs|fls)\d*([^a-z0-9]|$)/i.test(host)
    || /(dc|dct|rds|bkp|backup|epo|esx|vcenter|srv|sql|fls)\d+/i.test(host);
  const hasServerService = hasAny(text, [
    "vmware esx",
    "esxi",
    "iis",
    "microsoft-iis",
    "internet information services",
    "apache",
    "nginx",
    "tomcat",
    "windows server",
    "microsoft terminal service",
    "ms-wbt-server",
    "microsoft dns",
    "epolicy orchestrator",
    "xclarity controller",
    "idrac",
    "integrated lights-out",
    "openbmc",
    "supermicro bmc",
    "integrated management module",
  ]);

  if (ip.endsWith(".1") || hasAny(text, ["router", "gateway", "firewall", "fortigate", "fortinet", "mikrotik", "pfsense", "cisco ios"])) return "router";
  if (hasAny(text, ["aruba", "instant on", "iap-", "ap-", "access point", "wireless ap", "ubiquiti", "unifi", "ruckus", "omada"])) return "ap";
  if (hasAny(text, ["switch", "procurve", "catalyst", "nexus", "comware", "jetstream"])) return "switch";
  if (hasAny(text, ["ricoh", "brother", "hp laserjet", "lexmark", "xerox", "epson", "printer"]) || ports.includes(515) || ports.includes(631)) return "printer";
  if (hasAny(text, ["hikvision", "dahua", "axis", "ip camera", "camera", "rtsp", "onvif"]) || ports.includes(554)) return "camera";
  if (hasServerService || hasServerName || ports.includes(5000) || ports.includes(5001) || (ports.includes(53) && hasWindowsRemote)) return "server";
  if (hasWindowsRemote || ports.includes(445) || ports.includes(135)) return "workstation";
  if (ports.includes(22) && mac && hasAny(text, ["cisco", "hpe", "aruba", "juniper"])) return "switch";
  return "unknown";
}

function hasAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function inferRisk(ports: number[]): "low" | "medium" | "high" {
  if (ports.some((port) => [23, 3389, 445, 135].includes(port))) return "high";
  if (ports.some((port) => [22, 80, 8080, 5000].includes(port))) return "medium";
  return "low";
}

function serviceName(port: number) {
  const services: Record<number, string> = {
    22: "ssh",
    23: "telnet",
    53: "dns",
    80: "http",
    135: "msrpc",
    139: "netbios-ssn",
    443: "https",
    445: "microsoft-ds",
    515: "printer",
    631: "ipp",
    3389: "rdp",
    5000: "http-alt",
    5001: "https-alt",
    8080: "http-proxy",
    8443: "https-alt",
  };
  return services[port];
}

function ipToNumber(ip: string) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function numberToIp(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

function deviceId(ip: string) {
  return `dev-${ip.replaceAll(".", "-")}`;
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function readTextFileWhenReady(filePath: string, timeoutMs = 5000, completionPattern?: RegExp, signal?: AbortSignal) {
  const deadline = Date.now() + timeoutMs;
  let previous = "";

  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const current = await fs.readFile(filePath).then(decodeTextBuffer).catch(() => "");
    if (current.length > 0 && completionPattern?.test(current)) return current;
    if (current.length > 0 && !completionPattern && current === previous) return current;
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (previous.length > 0) return previous;
  throw new Error(`Arquivo de saida nao ficou disponivel em ${Math.round(timeoutMs / 1000)}s.`);
}

function decodeTextBuffer(buffer: Buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  return buffer.toString("utf-8").replace(/^\uFEFF/, "");
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>, signal?: AbortSignal) {
  const results: R[] = [];
  let index = 0;

  async function runner() {
    while (index < items.length) {
      signal?.throwIfAborted();
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

interface NmapRunResult {
  devices: Device[];
  warnings: string[];
  discoverySucceeded: number;
  discoveryAttempted: number;
  probeSucceeded: number;
  probeAttempted: number;
}
