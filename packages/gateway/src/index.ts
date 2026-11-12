import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { bootFromEnv } from './bootstrap.js';

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectExecution()) {
  let booted: ReturnType<typeof bootFromEnv>;
  try {
    booted = bootFromEnv(process.env);
  } catch {
    console.error('Shlita refused to start.');
    console.error('- Security configuration could not be loaded.');
    process.exit(1);
  }

  if (!booted.ok) {
    console.error('Shlita refused to start.');
    for (const error of booted.errors) console.error(`- ${error}`);
    process.exit(1);
  }

  const { app, config, engine, lifecycle } = booted;
  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    console.log(`Shlita gateway listening on http://localhost:${config.port}`);
    console.log(`Ledger: ${config.dbPath}`);
    console.log(`Simulation: ${config.allowSimulation ? 'enabled' : 'disabled'}`);
    console.log(`Demo enrollment: ${config.seedDemo ? 'enabled' : 'disabled'}`);
  });

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    lifecycle.accepting = false;
    const finish = () => {
      try {
        engine.close();
      } catch {
        // The ledger may already be closed.
      }
      process.exit(0);
    };
    const timer = setTimeout(finish, 2000);
    const closer = server as { close(callback?: () => void): void; closeAllConnections?: () => void };
    closer.close(() => {
      clearTimeout(timer);
      finish();
    });
    closer.closeAllConnections?.();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
