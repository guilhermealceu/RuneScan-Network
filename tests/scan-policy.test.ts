import assert from 'node:assert/strict';
import test from 'node:test';
import { isAbortError, validateCaptureDuration, validateScanTarget } from '../src/server/scan-policy';
import { parseRoutePrintDefaultGateway } from '../src/server/discovery';

const policy = { maxAddresses: 4096, maxTargets: 4, maxCaptureSeconds: 20 };

test('aceita e contabiliza uma rede /24', () => {
  const result = validateScanTarget('192.168.1.0/24', policy);
  assert.equal(result.addressCount, 256);
  assert.deepEqual(result.targets, ['192.168.1.0/24']);
});

test('aceita IP, intervalo curto e multiplos alvos', () => {
  const result = validateScanTarget('10.0.0.10, 10.0.0.20-25;10.0.1.1', policy);
  assert.equal(result.addressCount, 8);
});

test('rejeita IPv4 e CIDR invalidos', () => {
  assert.throws(() => validateScanTarget('999.1.1.1', policy), /IPv4 invalido/);
  assert.throws(() => validateScanTarget('10.0.0.0/8', policy), /CIDR fora do limite/);
  assert.throws(() => validateScanTarget('10.0.0.300/24', policy), /IPv4 invalido/);
});

test('rejeita escopo e quantidade de blocos acima da politica', () => {
  assert.throws(() => validateScanTarget('10.0.0.0/16', policy), /Escopo muito grande/);
  assert.throws(() => validateScanTarget('10.0.0.1 10.0.0.2 10.0.0.3 10.0.0.4 10.0.0.5', policy), /Muitos alvos/);
});

test('valida a duracao da captura passiva', () => {
  assert.equal(validateCaptureDuration(10, policy), 10);
  assert.throws(() => validateCaptureDuration(2, policy), /entre 5 e 20/);
  assert.throws(() => validateCaptureDuration(21, policy), /entre 5 e 20/);
  assert.throws(() => validateCaptureDuration('abc', policy), /invalida/);
});

test('reconhece cancelamento por AbortController', () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(isAbortError(controller.signal.reason), true);
});

test('extrai gateway e IPv4 ativo da rota padrao do Windows', () => {
  const parsed = parseRoutePrintDefaultGateway('\n          0.0.0.0          0.0.0.0         10.0.0.1        10.0.0.58     35\n');
  assert.deepEqual(parsed, { gateway: '10.0.0.1', interfaceIp: '10.0.0.58' });
});
