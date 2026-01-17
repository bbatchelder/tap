/**
 * Base error class for tap errors.
 */
export class TapError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'TapError';
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
    };
  }
}

/**
 * Error when no runner is found for a service.
 */
export class NoRunnerError extends TapError {
  constructor(name: string, socketPath: string) {
    super('no_runner', `No runner for '${name}' found at ${socketPath}. Start with: tap run --name ${name} -- <command>`);
  }
}

/**
 * Error when a runner already exists for a service.
 */
export class RunnerAlreadyExistsError extends TapError {
  constructor(name: string) {
    super('runner_exists', `Service '${name}' already running. Use 'tap status --name ${name}' or 'tap stop --name ${name}'`);
  }
}

/**
 * Error when a request to the runner times out.
 */
export class RequestTimeoutError extends TapError {
  constructor(name: string, timeoutMs: number) {
    super('request_timeout', `Request to '${name}' timed out after ${timeoutMs}ms`);
  }
}

/**
 * Error when the runner returns an error response.
 */
export class RunnerError extends TapError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

/**
 * Format an error for JSON output.
 */
export function formatError(err: unknown): { error: string; message: string } {
  if (err instanceof TapError) {
    return err.toJSON();
  }
  if (err instanceof Error) {
    return {
      error: 'unknown_error',
      message: err.message,
    };
  }
  return {
    error: 'unknown_error',
    message: String(err),
  };
}
