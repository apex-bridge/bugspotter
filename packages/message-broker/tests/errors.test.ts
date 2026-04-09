import { describe, it, expect } from 'vitest';
import { MessageBrokerTimeoutError, QueueNotRegisteredError } from '../src/errors.js';

describe('MessageBrokerTimeoutError', () => {
  it('should extend Error', () => {
    const err = new MessageBrokerTimeoutError('payments', 30000);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MessageBrokerTimeoutError);
  });

  it('should set name to MessageBrokerTimeoutError', () => {
    const err = new MessageBrokerTimeoutError('payments', 30000);
    expect(err.name).toBe('MessageBrokerTimeoutError');
  });

  it('should include queue and timeout in message', () => {
    const err = new MessageBrokerTimeoutError('payments', 30000);
    expect(err.message).toContain('payments');
    expect(err.message).toContain('30000');
    expect(err.message).toContain('timed out');
  });

  it('should expose queue and timeoutMs properties', () => {
    const err = new MessageBrokerTimeoutError('checkout', 5000);
    expect(err.queue).toBe('checkout');
    expect(err.timeoutMs).toBe(5000);
  });

  it('should have a stack trace', () => {
    const err = new MessageBrokerTimeoutError('q', 1000);
    expect(err.stack).toBeDefined();
  });
});

describe('QueueNotRegisteredError', () => {
  it('should extend Error', () => {
    const err = new QueueNotRegisteredError('my-queue');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(QueueNotRegisteredError);
  });

  it('should set name to QueueNotRegisteredError', () => {
    const err = new QueueNotRegisteredError('my-queue');
    expect(err.name).toBe('QueueNotRegisteredError');
  });

  it('should include queue name in message', () => {
    const err = new QueueNotRegisteredError('my-queue');
    expect(err.message).toContain('my-queue');
    expect(err.message).toContain('not registered');
  });

  it('should expose queue property', () => {
    const err = new QueueNotRegisteredError('screenshots');
    expect(err.queue).toBe('screenshots');
  });
});
