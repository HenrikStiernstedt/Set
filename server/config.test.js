import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveServerConfig } from './config.js';

test('server config defaults to loopback and port 3001', () => {
  assert.deepEqual(resolveServerConfig({}, {}), { bindAddress: '127.0.0.1', networkMode: 'local', port: 3001 });
});

test('server config accepts a bind address and port and lets PORT override the port', () => {
  assert.deepEqual(resolveServerConfig({ bindAddress: '0.0.0.0', networkMode: 'lan', port: 8080 }, { PORT: '9000' }), {
    bindAddress: '0.0.0.0',
    networkMode: 'lan',
    port: 9000,
  });
});

test('server config falls back when address or port are invalid', () => {
  assert.deepEqual(resolveServerConfig({ bindAddress: 'not-an-ip', port: 70000 }, {}), {
    bindAddress: '127.0.0.1',
    networkMode: 'local',
    port: 3001,
  });
});