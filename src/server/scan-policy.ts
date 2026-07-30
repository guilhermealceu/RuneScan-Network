const DEFAULT_MAX_SCAN_ADDRESSES = 4096;
const DEFAULT_MAX_SCAN_TARGETS = 16;
const DEFAULT_MAX_CAPTURE_SECONDS = 20;
const MIN_CAPTURE_SECONDS = 5;

export interface ScanPolicy {
  maxAddresses: number;
  maxTargets: number;
  maxCaptureSeconds: number;
}

export interface ValidatedScanTarget {
  targets: string[];
  addressCount: number;
}

export function getScanPolicy(): ScanPolicy {
  return {
    maxAddresses: positiveInteger(process.env.MAX_SCAN_ADDRESSES, DEFAULT_MAX_SCAN_ADDRESSES),
    maxTargets: positiveInteger(process.env.MAX_SCAN_TARGETS, DEFAULT_MAX_SCAN_TARGETS),
    maxCaptureSeconds: positiveInteger(process.env.MAX_CAPTURE_SECONDS, DEFAULT_MAX_CAPTURE_SECONDS),
  };
}

export function validateScanTarget(rawTarget: unknown, policy = getScanPolicy()): ValidatedScanTarget {
  const value = String(rawTarget ?? '').trim();
  if (!value) throw new Error('Informe ao menos um alvo. Exemplo: 192.168.1.0/24');
  if (value.length > 2048) throw new Error('O campo de alvo excede o limite de 2048 caracteres.');

  const targets = value.split(/[\s,;]+/).map((target) => target.trim()).filter(Boolean);
  if (targets.length > policy.maxTargets) {
    throw new Error(`Muitos alvos: informe no maximo ${policy.maxTargets} bloco(s) por varredura.`);
  }

  let addressCount = 0;
  for (const target of targets) {
    addressCount += targetSize(target);
    if (addressCount > policy.maxAddresses) {
      throw new Error(`Escopo muito grande: ${addressCount} enderecos solicitados; o limite atual e ${policy.maxAddresses}. Divida a varredura ou ajuste MAX_SCAN_ADDRESSES conscientemente.`);
    }
  }

  return { targets, addressCount };
}

export function validateCaptureDuration(rawSeconds: unknown, policy = getScanPolicy()) {
  const seconds = Number(rawSeconds);
  if (!Number.isFinite(seconds)) throw new Error('Duracao de captura invalida.');
  const rounded = Math.round(seconds);
  if (rounded < MIN_CAPTURE_SECONDS || rounded > policy.maxCaptureSeconds) {
    throw new Error(`A captura deve durar entre ${MIN_CAPTURE_SECONDS} e ${policy.maxCaptureSeconds} segundos.`);
  }
  return rounded;
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function targetSize(target: string) {
  if (target.includes('/')) {
    const match = target.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
    if (!match) throw new Error(`CIDR invalido: ${target}. Exemplo: 192.168.1.0/24`);
    validateIpv4(match[1]);
    const prefix = Number(match[2]);
    if (prefix < 16 || prefix > 32) throw new Error(`CIDR fora do limite /16-/32: ${target}`);
    return prefix === 32 ? 1 : 2 ** (32 - prefix);
  }

  if (target.includes('-')) {
    const match = target.match(/^(\d{1,3}(?:\.\d{1,3}){3})-(\d{1,3}|\d{1,3}(?:\.\d{1,3}){3})$/);
    if (!match) throw new Error(`Intervalo invalido: ${target}`);
    const startIp = match[1];
    validateIpv4(startIp);
    const startParts = startIp.split('.');
    const endIp = match[2].includes('.') ? match[2] : `${startParts.slice(0, 3).join('.')}.${match[2]}`;
    validateIpv4(endIp);
    const start = ipv4ToNumber(startIp);
    const end = ipv4ToNumber(endIp);
    if (end < start) throw new Error(`Intervalo invalido: o IP final e menor que o inicial em ${target}.`);
    return end - start + 1;
  }

  validateIpv4(target);
  return 1;
}

function validateIpv4(ip: string) {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((part) => {
    if (!/^\d{1,3}$/.test(part)) return true;
    const value = Number(part);
    return !Number.isInteger(value) || value < 0 || value > 255;
  })) {
    throw new Error(`IPv4 invalido: ${ip}`);
  }
}

function ipv4ToNumber(ip: string) {
  return ip.split('.').reduce((total, part) => ((total << 8) + Number(part)) >>> 0, 0);
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
