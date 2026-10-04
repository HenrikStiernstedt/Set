import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackAddress, requireGameAccess, requireLoopback } from './security.js';

test('recognizes IPv4 loopback addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.42.0.9'), true);
  assert.equal(isLoopbackAddress('126.0.0.1'), false);
  assert.equal(isLoopbackAddress('192.168.1.10'), false);
});

test('recognizes IPv6 and IPv4-mapped loopback addresses', () => {
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::ffff:192.168.1.10'), false);
  assert.equal(isLoopbackAddress('fe80::1%lo0'), false);
});

test('loopback guard rejects non-local clients without trusting forwarded headers', () => {
  const headers = { 'x-forwarded-for': '127.0.0.1', origin: 'http://localhost' };
  const req = { socket: { remoteAddress: '192.168.1.10' }, headers };
  let nextCalled = false;
  let statusCode;
  let responseBody = '';
  const res = {
    writeHead(code) { statusCode = code; },
    end(body) { responseBody = body; },
  };

  requireLoopback(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.match(responseBody, /localhost/);
});

test('loopback guard allows a local socket peer', () => {
  const req = { socket: { remoteAddress: '::ffff:127.0.0.1' } };
  let nextCalled = false;
  requireLoopback(req, { writeHead() {}, end() {} }, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('LAN game access permits remote peers only in LAN mode', () => {
  const req = { socket: { remoteAddress: 'remote-peer' } };
  let localModeCalled = false;
  let lanModeCalled = false;
  let statusCode;
  const res = { writeHead(code) { statusCode = code; }, end() {} };

  requireGameAccess(req, res, () => { localModeCalled = true; }, 'local');
  requireGameAccess(req, res, () => { lanModeCalled = true; }, 'lan');

  assert.equal(localModeCalled, false);
  assert.equal(statusCode, 403);
  assert.equal(lanModeCalled, true);
});
