/**
 * Payment Service entry point.
 * Starts the BullMQ worker (checkout/cancel requests) and webhook HTTP server.
 */

import 'dotenv/config';
import { Redis } from 'ioredis';
import { BullMQBroker } from '@bugspotter/message-broker';
import { createProvider } from './providers/factory.js';
import { startPaymentWorker } from './payment-worker.js';
import { startWebhookServer } from './webhook-server.js';

async function main() {
  const provider = createProvider();
  console.log(`[payment-service] Provider: ${provider.name}`);

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  // Create broker for publishing webhook events
  const broker = new BullMQBroker({ connection });
  broker.registerQueue('payment-events');

  const worker = startPaymentWorker(provider, connection);
  const server = await startWebhookServer(provider, broker);

  console.log(`[payment-service] Ready — worker + webhook server running`);

  const shutdown = async (signal: string) => {
    console.log(`[payment-service] ${signal} received, shutting down...`);
    await worker.close();
    await server.close();
    await broker.shutdown();
    connection.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[payment-service] Fatal error:', err);
  process.exit(1);
});
