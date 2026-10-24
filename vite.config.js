// GraphHopper läuft lokal auf Port 8989 (graphhopper/start.sh)
const graphhopperProxy = {
  '/graphhopper': {
    target: 'http://localhost:8989',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/graphhopper/, ''),
  },
};

export default {
  build: {
    sourcemap: true,
  },
  server: {
    proxy: graphhopperProxy,
  },
  preview: {
    proxy: graphhopperProxy,
  },
}
