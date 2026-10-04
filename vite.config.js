import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolveServerConfig } from './server/config.js';

const { bindAddress, port } = resolveServerConfig();
const proxyAddress = bindAddress === '0.0.0.0' ? '127.0.0.1' : bindAddress === '::' ? '::1' : bindAddress;
const formattedProxyAddress = proxyAddress.includes(':') ? `[${proxyAddress}]` : proxyAddress;

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': `http://${formattedProxyAddress}:${port}`,
    },
  },
});
