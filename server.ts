import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './src/server/routes.ts';
import { runMigrations, isDatabaseConfigured } from './src/db/index.ts';

dotenv.config();

// FAIL CLOSED (fix batch 1): JWT_SECRET has no fallback anywhere. Refuse to
// boot when it is missing instead of serving an insecure demo.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
  console.error('[Security] JWT_SECRET environment variable is not set. Refusing to boot.');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const app = express();

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Mount API routes
app.use('/api', apiRoutes);

// Automatically attempt database schema migration if DATABASE_URL is provided on startup
if (isDatabaseConfigured()) {
  runMigrations()
    .then((res) => {
      if (res.success) {
        console.log('[Database] Schema and RLS policies verified successfully.');
      } else {
        console.log('[Database] Notice during schema verification:', res.message);
      }
    })
    .catch((err) => {
      console.error('[Database] Connection probe warning:', err.message);
    });
} else {
  console.log('[Database] DATABASE_URL is not set. Running in configuration mode.');
}

// Development with Vite vs Production static serving
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
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

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[GreenEdge Server] Full-stack ESG & GRI service running on http://0.0.0.0:${PORT}`);
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
