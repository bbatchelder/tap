import { describe, it, expect } from 'vitest';
import {
  TapError,
  NoRunnerError,
  RunnerAlreadyExistsError,
  RequestTimeoutError,
  RunnerError,
  formatError,
} from './errors.js';

describe('TapError', () => {
  it('sets code and message properties', () => {
    const error = new TapError('test_code', 'Test message');
    expect(error.code).toBe('test_code');
    expect(error.message).toBe('Test message');
    expect(error.name).toBe('TapError');
  });

  it('extends Error', () => {
    const error = new TapError('test_code', 'Test message');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TapError);
  });

  it('serializes to JSON correctly', () => {
    const error = new TapError('test_code', 'Test message');
    const json = error.toJSON();
    expect(json).toEqual({
      error: 'test_code',
      message: 'Test message',
    });
  });
});

describe('NoRunnerError', () => {
  it('formats message with service name and socket path', () => {
    const error = new NoRunnerError('my-service', '/path/to/my-service.sock');
    expect(error.code).toBe('no_runner');
    expect(error.message).toContain("No runner for 'my-service'");
    expect(error.message).toContain('/path/to/my-service.sock');
    expect(error.message).toContain('tap run --name my-service');
  });

  it('extends TapError', () => {
    const error = new NoRunnerError('api', '/tmp/api.sock');
    expect(error).toBeInstanceOf(TapError);
  });
});

describe('RunnerAlreadyExistsError', () => {
  it('formats message with service name', () => {
    const error = new RunnerAlreadyExistsError('my-service');
    expect(error.code).toBe('runner_exists');
    expect(error.message).toContain("Service 'my-service' already running");
    expect(error.message).toContain('tap status --name my-service');
    expect(error.message).toContain('tap stop --name my-service');
  });

  it('extends TapError', () => {
    const error = new RunnerAlreadyExistsError('api');
    expect(error).toBeInstanceOf(TapError);
  });
});

describe('RequestTimeoutError', () => {
  it('formats message with service name and timeout value', () => {
    const error = new RequestTimeoutError('my-service', 5000);
    expect(error.code).toBe('request_timeout');
    expect(error.message).toContain("Request to 'my-service'");
    expect(error.message).toContain('timed out');
    expect(error.message).toContain('5000ms');
  });

  it('extends TapError', () => {
    const error = new RequestTimeoutError('api', 1000);
    expect(error).toBeInstanceOf(TapError);
  });
});

describe('RunnerError', () => {
  it('accepts custom code and message', () => {
    const error = new RunnerError('custom_error', 'Custom error message');
    expect(error.code).toBe('custom_error');
    expect(error.message).toBe('Custom error message');
  });

  it('extends TapError', () => {
    const error = new RunnerError('code', 'message');
    expect(error).toBeInstanceOf(TapError);
  });

  it('serializes to JSON correctly', () => {
    const error = new RunnerError('validation_error', 'Invalid input');
    const json = error.toJSON();
    expect(json).toEqual({
      error: 'validation_error',
      message: 'Invalid input',
    });
  });
});

describe('formatError', () => {
  it('formats TapError instances', () => {
    const error = new TapError('tap_error', 'Tap error message');
    const result = formatError(error);
    expect(result).toEqual({
      error: 'tap_error',
      message: 'Tap error message',
    });
  });

  it('formats generic Error instances', () => {
    const error = new Error('Generic error');
    const result = formatError(error);
    expect(result).toEqual({
      error: 'unknown_error',
      message: 'Generic error',
    });
  });

  it('formats string values', () => {
    const result = formatError('A string error');
    expect(result).toEqual({
      error: 'unknown_error',
      message: 'A string error',
    });
  });

  it('formats null values', () => {
    const result = formatError(null);
    expect(result).toEqual({
      error: 'unknown_error',
      message: 'null',
    });
  });

  it('formats undefined values', () => {
    const result = formatError(undefined);
    expect(result).toEqual({
      error: 'unknown_error',
      message: 'undefined',
    });
  });

  it('formats number values', () => {
    const result = formatError(42);
    expect(result).toEqual({
      error: 'unknown_error',
      message: '42',
    });
  });

  it('formats object values', () => {
    const result = formatError({ foo: 'bar' });
    expect(result).toEqual({
      error: 'unknown_error',
      message: '[object Object]',
    });
  });
});
