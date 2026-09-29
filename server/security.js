import net from 'node:net';

function isIpv4Loopback(address) {
  if (net.isIP(address) !== 4) return false;
  return Number(address.split('.')[0]) === 127;
}

export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::1') return true;
  if (isIpv4Loopback(normalized)) return true;

  const mappedPrefix = '::ffff:';
  if (normalized.startsWith(mappedPrefix)) {
    return isIpv4Loopback(normalized.slice(mappedPrefix.length));
  }
  return false;
}

export function requireLoopback(req, res, next) {
  const remoteAddress = req.socket?.remoteAddress;
  if (!isLoopbackAddress(remoteAddress)) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'This endpoint is available only from localhost.' }));
    return;
  }
  next();
}
