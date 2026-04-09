/**
 * ThrottleChecker Tests
 * Tests for integration rule throttle checking service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThrottleChecker } from '../../src/services/integrations/throttle-checker.js';
import type { TicketRepository } from '../../src/db/repositories/ticket.repository.js';

describe('ThrottleChecker', () => {
  let throttleChecker: ThrottleChecker;
  let mockTicketRepository: TicketRepository;

  beforeEach(() => {
    // Create mock ticket repository with vi.fn()
    mockTicketRepository = {
      countByRuleSince: vi.fn(),
    } as any;

    throttleChecker = new ThrottleChecker(mockTicketRepository);
  });

  // Test case 1
  it('should allow when throttle is null', async () => {
    const result = await throttleChecker.check('rule-123', null);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.currentHourly).toBe(0);
    expect(result.currentDaily).toBe(0);
    expect(result.limits.hourly).toBeNull();
    expect(result.limits.daily).toBeNull();
    expect(mockTicketRepository.countByRuleSince).not.toHaveBeenCalled();
  });

  // Test case 2
  it('should allow when throttle is empty object', async () => {
    const result = await throttleChecker.check('rule-123', {});

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.currentHourly).toBe(0);
    expect(result.currentDaily).toBe(0);
    expect(result.limits.hourly).toBeNull();
    expect(result.limits.daily).toBeNull();
    expect(mockTicketRepository.countByRuleSince).not.toHaveBeenCalled();
  });

  // Test case 3
  it('should allow when under hourly limit', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(5); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(15); // daily

    const result = await throttleChecker.check('rule-123', { max_per_hour: 10 });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.currentHourly).toBe(5);
    expect(result.currentDaily).toBe(15);
  });

  // Test case 4
  it('should allow when under daily limit', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(20); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(45); // daily

    const result = await throttleChecker.check('rule-123', { max_per_day: 50 });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.currentHourly).toBe(20);
    expect(result.currentDaily).toBe(45);
  });

  // Test case 5
  it('should allow when under both limits', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(5); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(30); // daily

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 10,
      max_per_day: 50,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.currentHourly).toBe(5);
    expect(result.currentDaily).toBe(30);
  });

  // Test case 6
  it('should block when at hourly limit', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(10); // hourly (exactly at limit)
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(25); // daily

    const result = await throttleChecker.check('rule-123', { max_per_hour: 10 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_limit');
    expect(result.currentHourly).toBe(10);
    expect(result.currentDaily).toBe(25);
  });

  // Test case 7
  it('should block when over hourly limit', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(11); // hourly (one over limit)
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(30); // daily

    const result = await throttleChecker.check('rule-123', { max_per_hour: 10 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_limit');
    expect(result.currentHourly).toBe(11);
  });

  // Test case 8
  it('should block when at daily limit', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(8); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(50); // daily (exactly at limit)

    const result = await throttleChecker.check('rule-123', { max_per_day: 50 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit');
    expect(result.currentHourly).toBe(8);
    expect(result.currentDaily).toBe(50);
  });

  // Test case 9
  it('should block when over daily limit', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(12); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(51); // daily (one over limit)

    const result = await throttleChecker.check('rule-123', { max_per_day: 50 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit');
    expect(result.currentDaily).toBe(51);
  });

  // Test case 10
  it('should return hourly_limit reason when hourly exceeded', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(15); // hourly (exceeded)
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(30); // daily

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 10,
      max_per_day: 100,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_limit');
  });

  // Test case 11
  it('should return daily_limit reason when daily exceeded', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(5); // hourly (OK)
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(75); // daily (exceeded)

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 10,
      max_per_day: 50,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit');
  });

  // Test case 12
  it('should check hourly before daily', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(15); // hourly (exceeded)
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(60); // daily (also exceeded)

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 10,
      max_per_day: 50,
    });

    // Should return hourly_limit first since it's checked first
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_limit');
    expect(result.currentHourly).toBe(15);
    expect(result.currentDaily).toBe(60);
  });

  // Test case 13
  it('should return correct current counts', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(7); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(42); // daily

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 10,
      max_per_day: 50,
    });

    expect(result.allowed).toBe(true);
    expect(result.currentHourly).toBe(7);
    expect(result.currentDaily).toBe(42);
  });

  // Test case 14
  it('should return correct limits in result', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(3); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(25); // daily

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 10,
      max_per_day: 50,
    });

    expect(result.limits.hourly).toBe(10);
    expect(result.limits.daily).toBe(50);
  });

  // Test case 15
  it('should block all tickets when hourly limit is 0', async () => {
    // Zero limits should block ALL ticket creation (not unlimited)
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(0); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(0); // daily

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 0,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_limit');
    expect(result.currentHourly).toBe(0);
    expect(result.limits.hourly).toBe(0);
  });

  // Test case 15b
  it('should block all tickets when daily limit is 0', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(0); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(0); // daily

    const result = await throttleChecker.check('rule-123', {
      max_per_day: 0,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_limit');
    expect(result.currentDaily).toBe(0);
    expect(result.limits.daily).toBe(0);
  });

  // Test case 15c
  it('should block all tickets when both limits are 0', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValue(0);

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 0,
      max_per_day: 0,
    });

    // Hourly limit is checked first
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_limit');
    expect(result.limits.hourly).toBe(0);
    expect(result.limits.daily).toBe(0);
  });

  // Test case 15d
  it('should treat null and undefined as unlimited', async () => {
    const result = await throttleChecker.check('rule-123', {
      max_per_hour: null as any,
      max_per_day: undefined,
    });

    expect(result.allowed).toBe(true);
    expect(result.limits.hourly).toBeNull();
    expect(result.limits.daily).toBeNull();
    expect(mockTicketRepository.countByRuleSince).not.toHaveBeenCalled();
  });

  // Test case 15e
  it('should allow when hourly limit is 1 and no tickets exist', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValue(0);

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 1,
    });

    expect(result.allowed).toBe(true);
    expect(result.currentHourly).toBe(0);
    expect(result.limits.hourly).toBe(1);
  });

  // Test case 15f
  it('should block when hourly limit is 1 and 1 ticket exists', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValue(1);

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 1,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_limit');
    expect(result.currentHourly).toBe(1);
  });

  // Test case 16
  it('should handle only hourly limit set', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(5); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(100); // daily (no limit)

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 10,
    });

    expect(result.allowed).toBe(true);
    expect(result.currentHourly).toBe(5);
    expect(result.currentDaily).toBe(100);
    expect(result.limits.hourly).toBe(10);
    expect(result.limits.daily).toBeNull();
  });

  // Test case 17
  it('should handle only daily limit set', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(50); // hourly (no limit)
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(30); // daily

    const result = await throttleChecker.check('rule-123', {
      max_per_day: 50,
    });

    expect(result.allowed).toBe(true);
    expect(result.currentHourly).toBe(50);
    expect(result.currentDaily).toBe(30);
    expect(result.limits.hourly).toBeNull();
    expect(result.limits.daily).toBe(50);
  });

  // Test case 18
  it('should query correct time ranges', async () => {
    const now = new Date('2025-12-07T15:30:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(3); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(15); // daily

    await throttleChecker.check('rule-123', {
      max_per_hour: 10,
      max_per_day: 50,
    });

    // Verify calls were made with correct time ranges
    expect(mockTicketRepository.countByRuleSince).toHaveBeenCalledTimes(2);

    // First call: hourly window (1 hour ago from now)
    const hourlyCall = vi.mocked(mockTicketRepository.countByRuleSince).mock.calls[0];
    expect(hourlyCall[0]).toBe('rule-123');
    expect(hourlyCall[1]).toEqual(new Date('2025-12-07T14:30:00Z')); // 1 hour before

    // Second call: daily window (24 hours ago from now)
    const dailyCall = vi.mocked(mockTicketRepository.countByRuleSince).mock.calls[1];
    expect(dailyCall[0]).toBe('rule-123');
    expect(dailyCall[1]).toEqual(new Date('2025-12-06T15:30:00Z')); // 24 hours before

    vi.useRealTimers();
  });

  // Test case 19: Error handling - fail open
  it('should fail open when repository throws error', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockRejectedValue(
      new Error('Database connection failed')
    );

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 10,
      max_per_day: 50,
    });

    // Should allow ticket creation despite error (fail open for availability)
    expect(result.allowed).toBe(true);
    expect(result.currentHourly).toBe(0);
    expect(result.currentDaily).toBe(0);
    expect(result.limits.hourly).toBe(10);
    expect(result.limits.daily).toBe(50);
  });

  // Test case 20: Mixed null/undefined limits
  it('should check hourly limit when daily is null', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(5); // hourly
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(1000); // daily (ignored)

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 10,
      max_per_day: null as any,
    });

    expect(result.allowed).toBe(true);
    expect(result.currentHourly).toBe(5);
    expect(result.limits.hourly).toBe(10);
    expect(result.limits.daily).toBeNull();
  });

  // Test case 21: Mixed null/undefined limits
  it('should check daily limit when hourly is undefined', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(1000); // hourly (ignored)
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValueOnce(30); // daily

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: undefined,
      max_per_day: 50,
    });

    expect(result.allowed).toBe(true);
    expect(result.currentDaily).toBe(30);
    expect(result.limits.hourly).toBeNull();
    expect(result.limits.daily).toBe(50);
  });

  // Test case 22: Zero with null combination
  it('should check hourly limit of 0 even when daily is null', async () => {
    vi.mocked(mockTicketRepository.countByRuleSince).mockResolvedValue(0);

    const result = await throttleChecker.check('rule-123', {
      max_per_hour: 0,
      max_per_day: null as any,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly_limit');
    expect(result.limits.hourly).toBe(0);
    expect(result.limits.daily).toBeNull();
  });
});
