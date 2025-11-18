import 'reflect-metadata';
import app from './app';
import { config } from './config/env';

console.log(`🚀 Report service running on port ${config.port}`);
Bun.serve({
  port: config.port,
  fetch: app.fetch,
});
