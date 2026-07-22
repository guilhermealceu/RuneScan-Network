import assert from 'node:assert/strict';
import test from 'node:test';
import { ScanBusyError, ScanManager } from '../src/server/scan-manager';

test('permite apenas uma varredura ativa', () => {
  const manager = new ScanManager();
  const first = manager.begin('192.168.1.0/24');
  assert.throws(() => manager.begin('192.168.2.0/24'), ScanBusyError);
  manager.finish(first.id);
  const second = manager.begin('192.168.2.0/24');
  assert.equal(second.target, '192.168.2.0/24');
});

test('cancelamento aborta o sinal da varredura ativa', () => {
  const manager = new ScanManager();
  const scan = manager.begin('10.0.0.0/24');
  const cancelled = manager.cancel();
  assert.equal(cancelled?.id, scan.id);
  assert.equal(scan.controller.signal.aborted, true);
  assert.equal(manager.cancel(), null);
});

test('finish antigo nao remove uma varredura mais nova', () => {
  const manager = new ScanManager();
  const first = manager.begin('10.0.0.1');
  manager.cancel();
  const second = manager.begin('10.0.0.2');
  manager.finish(first.id);
  assert.equal(manager.current()?.id, second.id);
});
