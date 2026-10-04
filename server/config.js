import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultBindAddress = '127.0.0.1';
const defaultPort = 3001;

export function readAppConfig() {
  const configPath = [path.join(projectDir, 'config.json'), path.join(projectDir, 'config.example.json')]
    .find((candidate) => fs.existsSync(candidate));
  if (!configPath) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

export function resolveServerConfig(config = readAppConfig(), env = process.env) {
  const configPort = Number(config.port);
  const environmentPort = Number(env.PORT);
  const port = Number.isInteger(environmentPort) && environmentPort > 0 && environmentPort <= 65535
    ? environmentPort
    : Number.isInteger(configPort) && configPort > 0 && configPort <= 65535
      ? configPort
      : defaultPort;
  const bindAddress = typeof config.bindAddress === 'string' && net.isIP(config.bindAddress)
    ? config.bindAddress
    : defaultBindAddress;
  const networkMode = config.networkMode === 'lan' ? 'lan' : 'local';

  return { bindAddress, networkMode, port };
}