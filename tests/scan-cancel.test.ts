import assert from 'node:assert/strict';
import test from 'node:test';
import { scanNetwork } from '../src/server/discovery';

test('scanNetwork respeita um sinal ja cancelado antes de iniciar coletores', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    scanNetwork({ target: '127.0.0.1', signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
});
