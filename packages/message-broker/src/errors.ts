/**
 * Custom error classes for @bugspotter/message-broker.
 */

/**
 * Thrown when a publish-and-wait operation exceeds its timeout.
 */
export class MessageBrokerTimeoutError extends Error {
  constructor(
    public readonly queue: string,
    public readonly timeoutMs: number
  ) {
    super(`Message broker: publish-and-wait timed out after ${timeoutMs}ms on queue "${queue}"`);
    this.name = 'MessageBrokerTimeoutError';
  }
}

/**
 * Thrown when an operation targets a queue that has not been registered.
 */
export class QueueNotRegisteredError extends Error {
  constructor(public readonly queue: string) {
    super(`Queue "${queue}" not registered. Call registerQueue() first.`);
    this.name = 'QueueNotRegisteredError';
  }
}
