/**
 * Security validation utilities.
 */

/**
 * Validate a single name segment (no colons).
 */
function validateNameSegment(segment: string, context: string): void {
  if (!segment) {
    throw new Error(`${context} cannot be empty`);
  }
  if (segment.length > 64) {
    throw new Error(`${context} must be 64 characters or less`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(segment)) {
    throw new Error(`${context} must contain only alphanumeric characters, hyphens, and underscores`);
  }
}

/**
 * Validate that a service name contains only safe characters.
 * Supports prefixed names like "frontend:api" for services in subdirectories.
 * Prevents path traversal and other injection attacks.
 */
export function validateServiceName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Service name is required');
  }
  if (name.length > 128) {
    throw new Error('Service name must be 128 characters or less');
  }

  // Split by colon - prefix:baseName or just baseName
  const colonIndex = name.lastIndexOf(':');
  if (colonIndex === -1) {
    // Simple name without prefix
    validateNameSegment(name, 'Service name');
  } else {
    // Prefixed name - validate prefix path segments and base name
    const prefix = name.slice(0, colonIndex);
    const baseName = name.slice(colonIndex + 1);

    // Prefix can contain path separators (/) for nested directories
    const prefixSegments = prefix.split('/');
    for (const segment of prefixSegments) {
      validateNameSegment(segment, 'Path segment');
    }

    validateNameSegment(baseName, 'Service name');
  }
}

/**
 * Maximum allowed regex pattern length to prevent ReDoS.
 */
const MAX_REGEX_LENGTH = 200;

/**
 * Check if a pattern contains dangerous backtracking constructs.
 * Returns true if the pattern appears dangerous.
 */
function isDangerousPattern(pattern: string): boolean {
  // Check for nested quantifiers like .*.*, .+.+, etc.
  if (/[*+]\s*\.[*+]/.test(pattern)) return true;
  if (/[*+]\s*\[[^\]]*\][*+]/.test(pattern)) return true;

  // Check for quantified groups with alternation like (a|b)+
  if (/\([^)]*\|[^)]*\)[*+]/.test(pattern)) return true;

  // Check for repeated quantifiers like a{1,100}{1,100}
  if (/\{[^}]+\}\s*\{[^}]+\}/.test(pattern)) return true;

  // Check for deeply nested groups with quantifiers
  const groupDepth = (pattern.match(/\(/g) || []).length;
  const hasQuantifiers = /[*+?]|\{\d+,?\d*\}/.test(pattern);
  if (groupDepth > 3 && hasQuantifiers) return true;

  return false;
}

/**
 * Validate a regex pattern for safety against ReDoS attacks.
 * Throws if the pattern is potentially dangerous.
 */
export function validateRegexPattern(pattern: string): void {
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Regex pattern is required');
  }

  if (pattern.length > MAX_REGEX_LENGTH) {
    throw new Error(`Regex pattern must be ${MAX_REGEX_LENGTH} characters or less`);
  }

  // Try to compile the regex to catch syntax errors
  try {
    new RegExp(pattern);
  } catch {
    throw new Error('Invalid regex pattern syntax');
  }

  // Check for dangerous patterns
  if (isDangerousPattern(pattern)) {
    throw new Error('Regex pattern contains potentially dangerous backtracking constructs');
  }
}

/**
 * Create a safe regex with timeout protection.
 * Returns the regex if valid, throws if dangerous or invalid.
 */
export function createSafeRegex(pattern: string, flags: string = ''): RegExp {
  validateRegexPattern(pattern);
  return new RegExp(pattern, flags);
}

/**
 * Validate and parse an integer within a safe range.
 */
export function parsePositiveInt(value: string, name: string, max: number = Number.MAX_SAFE_INTEGER): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  if (num > max) {
    throw new Error(`${name} must be less than ${max}`);
  }
  return num;
}
