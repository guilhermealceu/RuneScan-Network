import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type ScanAuditEvent = "started" | "completed" | "cancelled" | "failed" | "cancel_requested";

export interface ScanAuditInput {
  event: ScanAuditEvent;
  scanId: string;
  sourceIp: string;
  userAgent?: string;
  target: string;
  transport: "json" | "stream" | "control";
  durationMs?: number;
  message?: string;
}

export interface ScanAuditRecord extends ScanAuditInput {
  timestamp: string;
}

export function buildScanAuditRecord(input: ScanAuditInput, now = new Date()): ScanAuditRecord {
  return {
    ...input,
    sourceIp: clean(input.sourceIp, 100),
    userAgent: input.userAgent ? clean(input.userAgent, 200) : undefined,
    target: clean(input.target, 512),
    message: input.message ? clean(input.message, 300) : undefined,
    durationMs: input.durationMs === undefined ? undefined : Math.max(0, Math.round(input.durationMs)),
    timestamp: now.toISOString(),
  };
}

export class ScanAuditLogger {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath = process.env.AUDIT_LOG_PATH || path.join("logs", "runescan-audit.jsonl")) {}

  write(input: ScanAuditInput): Promise<void> {
    const record = buildScanAuditRecord(input);
    this.queue = this.queue.then(async () => {
      try {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
      } catch (error) {
        console.error("Falha ao registrar auditoria da varredura:", error);
      }
    });
    return this.queue;
  }
}

function clean(value: string, maxLength: number): string {
  return value.replace(/[\r\n\0]/g, " ").slice(0, maxLength);
}
