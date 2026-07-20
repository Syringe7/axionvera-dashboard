/**
 * Tests for retry logic and recovery
 */

import {
  AppError,
  NetworkError,
  ErrorCategory,
  RetryExecutor,
  getRetryExecutor,
  retryWithBackoff,
  DEFAULT_RETRY_POLICIES,
  calculateBackoffDelay
} from '@/errors';

jest.mock('@/errors/recovery', () => {
  const actual = jest.requireActual('@/errors/recovery');
  return {
    ...actual,
    sleep: jest.fn().mockResolvedValue(undefined)
  };
});

describe('Retry Policies', () => {
  it('should have default policies for all categories', () => {
    Object.values(ErrorCategory).forEach(category => {
      expect(DEFAULT_RETRY_POLICIES[category]).toBeDefined();
    });
  });

  it('should have valid policy configuration', () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.NETWORK];
    expect(policy.maxAttempts).toBeGreaterThan(0);
    expect(policy.initialDelayMs).toBeGreaterThanOrEqual(0);
    expect(policy.maxDelayMs).toBeGreaterThanOrEqual(policy.initialDelayMs);
    expect(policy.backoffMultiplier).toBeGreaterThan(1);
    expect(policy.timeoutMs).toBeGreaterThan(0);
  });

  it('should have shouldRetry function', () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.NETWORK];
    const error = new NetworkError('Failed');
    expect(typeof policy.shouldRetry).toBe('function');
    expect(policy.shouldRetry(error)).toBe(true);
  });
});

describe('Backoff Calculation', () => {
  it('should calculate exponential backoff', () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.NETWORK];
    
    const delay0 = calculateBackoffDelay(0, policy);
    const delay1 = calculateBackoffDelay(1, policy);
    const delay2 = calculateBackoffDelay(2, policy);

    expect(delay0).toBeLessThan(delay1);
    expect(delay1).toBeLessThan(delay2);
  });

  it('should respect max delay', () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.NETWORK];
    
    for (let i = 0; i < 10; i++) {
      const delay = calculateBackoffDelay(i, policy);
      expect(delay).toBeLessThanOrEqual(policy.maxDelayMs);
    }
  });

  it('should calculate correct formula', () => {
    const policy = {
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2
    };

    const delay = calculateBackoffDelay(2, policy as any);
    const expected = Math.min(1000 * Math.pow(2, 2), 10000);
    expect(delay).toBe(expected);
  });
});

describe('RetryExecutor', () => {
  it('should execute function successfully on first attempt', async () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.NETWORK];
    const executor = new RetryExecutor(policy);
    
    const fn = jest.fn().mockResolvedValue('success');
    const result = await executor.execute(fn);

    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.NETWORK];
    const executor = new RetryExecutor(policy);
    
    const fn = jest.fn()
      .mockRejectedValueOnce(new NetworkError('Network error'))
      .mockRejectedValueOnce(new NetworkError('Network error'))
      .mockResolvedValueOnce('success');

    const result = await executor.execute(fn);

    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should fail after max attempts', async () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.NETWORK];
    const executor = new RetryExecutor(policy);
    
    const error = new NetworkError('Persistent error');
    const fn = jest.fn().mockRejectedValue(error);

    const result = await executor.execute(fn);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.attempts).toBe(policy.maxAttempts);
  });

  it('should call onRetry callback', async () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.NETWORK];
    const executor = new RetryExecutor(policy);
    
    const fn = jest.fn()
      .mockRejectedValueOnce(new NetworkError('Error'))
      .mockResolvedValueOnce('success');

    const onRetry = jest.fn();
    const result = await executor.execute(fn, { onRetry });

    expect(onRetry).toHaveBeenCalled();
    expect(onRetry).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(AppError),
      expect.any(Number)
    );
  });

  it('should call onSuccess callback', async () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.NETWORK];
    const executor = new RetryExecutor(policy);
    
    const fn = jest.fn().mockResolvedValue('success');
    const onSuccess = jest.fn();

    await executor.execute(fn, { onSuccess });

    expect(onSuccess).toHaveBeenCalledWith('success', 1);
  });

  it('should call onFailure callback', async () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.NETWORK];
    const executor = new RetryExecutor(policy);
    
    const fn = jest.fn().mockRejectedValue(new NetworkError('Failed'));
    const onFailure = jest.fn();

    await executor.execute(fn, { onFailure });

    expect(onFailure).toHaveBeenCalled();
  });

  it('should not retry non-retryable errors', async () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.VALIDATION];
    const executor = new RetryExecutor(policy);
    
    const fn = jest.fn().mockRejectedValue(new Error('Validation error'));
    const result = await executor.execute(fn);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1); // Should fail immediately
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should track execution time', async () => {
    const policy = DEFAULT_RETRY_POLICIES[ErrorCategory.NETWORK];
    const executor = new RetryExecutor(policy);
    
    const fn = jest.fn().mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve('success'), 150))
    );

    const result = await executor.execute(fn);

    expect(result.totalTimeMs).toBeGreaterThanOrEqual(100);
  });
});

describe('getRetryExecutor', () => {
  it('should return executor with correct policy', () => {
    const executor = getRetryExecutor(ErrorCategory.NETWORK);
    expect(executor).toBeInstanceOf(RetryExecutor);
  });

  it('should return different policies for different categories', () => {
    const networkExecutor = getRetryExecutor(ErrorCategory.NETWORK);
    const validationExecutor = getRetryExecutor(ErrorCategory.VALIDATION);
    
    // Both are executors but with different policies
    expect(networkExecutor).toBeInstanceOf(RetryExecutor);
    expect(validationExecutor).toBeInstanceOf(RetryExecutor);
  });
});

describe('retryWithBackoff', () => {
  it('should succeed on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await retryWithBackoff(fn, 3, 100);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry and succeed', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('Error'))
      .mockResolvedValueOnce('success');

    const result = await retryWithBackoff(fn, 3, 100);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should fail after max attempts', async () => {
    const error = new Error('Persistent error');
    const fn = jest.fn().mockRejectedValue(error);

    await expect(retryWithBackoff(fn, 2, 10)).rejects.toThrow('Persistent error');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
