import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './src/server/routes.ts';
import { apiNotFoundHandler, globalJsonErrorHandler } from './src/server/errorHandler.ts';
import { assertB17Ready } from './src/db/b17Readiness.ts';
import { jsonInput } from './src/server/jsonInput.ts';

// Scratch proofs never consume ambient configuration, including when testing actual startup.
if (process.env.B17_SCRATCH_OPT_IN !== 'YES') dotenv.config();

// FAIL CLOSED (fix batch 1): JWT_SECRET has no fallback anywhere. Refuse to
// boot when it is missing instead of serving an insecure demo.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
  console.error('[Security] JWT_SECRET environment variable is not set. Refusing to boot.');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scratch = process.env.B17_SCRATCH_OPT_IN === 'YES';
const PORT = scratch ? 0 : 3000;
const HOST = scratch ? '127.0.0.1' : '0.0.0.0';
const app = express();

// Body parsers
app.use(jsonInput);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Mount API routes
app.use('/api', apiRoutes);

// Development with Vite vs Production static serving
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  // No normal serving/listening until the explicit offline activation is verified.
  await assertB17Ready();
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // App-level JSON safety net (malformed-body vector): failures in the
  // top-level JSON input parser occur before routing, so they skip the
  // apiRouter-level handlers (Express skips sub-routers in error flow).
  // Mount the SAME shipped handlers at app level, LAST (after vite/static
  // middleware): unknown routes → 404 JSON, any escaped error → JSON
  // (never the Express-default HTML page). Router-level mounts stay as-is.
  app.use(apiNotFoundHandler);
  app.use(globalJsonErrorHandler);

  const server = app.listen(PORT, HOST, () => {
    console.log(`[ESG GRI Server] Full-stack ESG & GRI service running on http://${HOST}:${(server.address() as { port: number }).port}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server Error] Port ${PORT} is already in use. Existing process running.`);
    } else {
      console.error('[Server Error]', err);
    }
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
