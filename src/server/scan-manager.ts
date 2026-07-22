import { randomUUID } from 'crypto';

export interface ManagedScan {
  id: string;
  target: string;
  startedAt: string;
  controller: AbortController;
}

export class ScanBusyError extends Error {
  constructor(active: ManagedScan) {
    super(`Ja existe uma varredura em andamento para ${active.target}, iniciada em ${active.startedAt}.`);
    this.name = 'ScanBusyError';
  }
}

export class ScanManager {
  private active: ManagedScan | null = null;

  begin(target: string) {
    if (this.active && !this.active.controller.signal.aborted) throw new ScanBusyError(this.active);
    const scan: ManagedScan = {
      id: randomUUID(),
      target,
      startedAt: new Date().toISOString(),
      controller: new AbortController(),
    };
    this.active = scan;
    return scan;
  }

  finish(id: string) {
    if (this.active?.id === id) this.active = null;
  }

  cancel() {
    if (!this.active || this.active.controller.signal.aborted) return null;
    const scan = this.snapshot();
    this.active.controller.abort();
    return scan;
  }

  snapshot() {
    if (!this.active) return null;
    return { id: this.active.id, target: this.active.target, startedAt: this.active.startedAt };
  }

  current() {
    return this.active;
  }
}
