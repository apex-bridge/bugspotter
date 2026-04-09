/**
 * Webhook Server — minimal Fastify instance for receiving payment provider webhooks.
 * Verifies signatures, normalizes events, publishes to "payment-events" BullMQ queue.
 */

import Fastify from 'fastify';
import type { IMessageBroker } from '@bugspotter/message-broker';
import type { PaymentProvider, WebhookEvent } from './providers/types.js';
import { WebhookError } from './errors.js';

export interface PaymentEventJobData extends WebhookEvent {
  provider: string;
}

export async function startWebhookServer(provider: PaymentProvider, broker: IMessageBroker) {
  const fastify = Fastify({
    logger: true,
  });

  // Register raw body content type parser for signature verification
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  /**
   * POST /webhooks — single endpoint, only one provider per instance.
   */
  fastify.post('/webhooks', async (request, reply) => {
    const rawBody = request.body as Buffer;
    const headers = {
      ...(request.headers as Record<string, string>),
      'x-real-ip': request.ip,
    };

    let event: WebhookEvent;
    try {
      event = await provider.verifyAndParseWebhook(rawBody, headers);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook verification failed';
      const status = err instanceof WebhookError ? err.statusCode : 400;
      fastify.log.warn({ err, status }, 'Webhook verification failed');
      return reply.status(status).send({ error: message });
    }

    await broker.publish<PaymentEventJobData>(
      'payment-events',
      'webhook-event',
      {
        ...event,
        provider: provider.name,
      },
      {
        jobId: event.eventId,
      }
    );

    return reply.status(200).send({ received: true });
  });

  /**
   * GET /health
   */
  fastify.get('/health', async () => ({
    status: 'ok',
    provider: provider.name,
  }));

  const port = parseInt(process.env.PAYMENT_SERVICE_PORT ?? '3002', 10);
  await fastify.listen({ port, host: '0.0.0.0' });

  return fastify;
}
