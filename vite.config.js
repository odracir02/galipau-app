import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Development: mounts the Express API inside the Vite dev server, so
// `npm run dev` runs the UI and the API in a single process on one port.
// Uses the development database (data/dev), never the real one.
const galipauApi = () => ({
  name: 'galipau-api',
  apply: 'serve',
  async configureServer(server) {
    if (process.env.VITEST) return
    const { cargarConfig } = await import('./server/config.js')
    const { iniciarServicios, crearLogger } = await import('./server/arranque.js')
    const config = cargarConfig({ ...process.env, NODE_ENV: 'development' }, { modo: 'desarrollo' })
    const servicios = await iniciarServicios(config, { logger: crearLogger() })
    server.config.logger.info(`  Galipau API: development database at ${config.rutaBaseDatos}`)
    server.middlewares.use((req, res, next) => (req.url.startsWith('/api') ? servicios.app(req, res, next) : next()))
    server.httpServer?.once('close', () => servicios.cerrar())
  },
})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), galipauApi()],
  server: {
    host: '127.0.0.1',
    open: true,
  },
})
