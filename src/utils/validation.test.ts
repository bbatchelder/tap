import { describe, it, expect } from 'vitest';
import { validateServiceName, validateRegexPattern, createSafeRegex, parsePositiveInt } from './validation.js';

describe('validateServiceName', () => {
  describe('valid names', () => {
    it('accepts simple alphanumeric names', () => {
      expect(() => validateServiceName('api')).not.toThrow();
      expect(() => validateServiceName('myService123')).not.toThrow();
      expect(() => validateServiceName('API')).not.toThrow();
    });

    it('accepts names with hyphens and underscores', () => {
      expect(() => validateServiceName('my-service')).not.toThrow();
      expect(() => validateServiceName('my_service')).not.toThrow();
      expect(() => validateServiceName('my-service_123')).not.toThrow();
    });

    it('accepts prefixed names', () => {
      expect(() => validateServiceName('frontend:api')).not.toThrow();
      expect(() => validateServiceName('services:worker')).not.toThrow();
    });

    it('accepts nested path prefixes', () => {
      expect(() => validateServiceName('apps/frontend:api')).not.toThrow();
      expect(() => validateServiceName('packages/core/services:worker')).not.toThrow();
    });
  });

  describe('invalid names', () => {
    it('rejects empty names', () => {
      expect(() => validateServiceName('')).toThrow('Service name is required');
    });

    it('rejects null/undefined', () => {
      expect(() => validateServiceName(null as unknown as string)).toThrow('Service name is required');
      expect(() => validateServiceName(undefined as unknown as string)).toThrow('Service name is required');
    });

    it('rejects names that are too long', () => {
      const longName = 'a'.repeat(129);
      expect(() => validateServiceName(longName)).toThrow('128 characters or less');
    });

    it('rejects names with invalid characters', () => {
      expect(() => validateServiceName('my service')).toThrow('alphanumeric characters');
      expect(() => validateServiceName('my.service')).toThrow('alphanumeric characters');
      expect(() => validateServiceName('my@service')).toThrow('alphanumeric characters');
      expect(() => validateServiceName('my$ervice')).toThrow('alphanumeric characters');
    });

    it('rejects path traversal attempts', () => {
      expect(() => validateServiceName('../etc/passwd')).toThrow();
      expect(() => validateServiceName('..%2F..%2Fetc')).toThrow();
    });

    it('rejects empty segments', () => {
      expect(() => validateServiceName(':api')).toThrow('cannot be empty');
      expect(() => validateServiceName('frontend:')).toThrow('cannot be empty');
    });

    it('rejects colons in prefix path', () => {
      // Only one colon allowed - prefix can't contain colons
      expect(() => validateServiceName('frontend::api')).toThrow();
    });

    it('rejects empty path segments', () => {
      expect(() => validateServiceName('apps//frontend:api')).toThrow('cannot be empty');
    });

    it('rejects segments that are too long', () => {
      const longSegment = 'a'.repeat(65);
      expect(() => validateServiceName(longSegment)).toThrow('64 characters or less');
      expect(() => validateServiceName(`prefix:${longSegment}`)).toThrow('64 characters or less');
    });
  });
});

describe('validateRegexPattern', () => {
  describe('valid patterns', () => {
    it('accepts simple patterns', () => {
      expect(() => validateRegexPattern('error')).not.toThrow();
      expect(() => validateRegexPattern('ERROR|WARN')).not.toThrow();
      expect(() => validateRegexPattern('[0-9]+')).not.toThrow();
    });

    it('accepts patterns with basic quantifiers', () => {
      expect(() => validateRegexPattern('a*')).not.toThrow();
      expect(() => validateRegexPattern('a+')).not.toThrow();
      expect(() => validateRegexPattern('a?')).not.toThrow();
      expect(() => validateRegexPattern('a{3}')).not.toThrow();
      expect(() => validateRegexPattern('a{1,5}')).not.toThrow();
    });

    it('accepts patterns with groups', () => {
      expect(() => validateRegexPattern('(foo|bar)')).not.toThrow();
      expect(() => validateRegexPattern('(?:foo|bar)')).not.toThrow();
      expect(() => validateRegexPattern('(\\d+)')).not.toThrow();
    });
  });

  describe('invalid patterns', () => {
    it('rejects empty patterns', () => {
      expect(() => validateRegexPattern('')).toThrow('required');
    });

    it('rejects null/undefined', () => {
      expect(() => validateRegexPattern(null as unknown as string)).toThrow('required');
      expect(() => validateRegexPattern(undefined as unknown as string)).toThrow('required');
    });

    it('rejects patterns that are too long', () => {
      const longPattern = 'a'.repeat(201);
      expect(() => validateRegexPattern(longPattern)).toThrow('200 characters or less');
    });

    it('rejects invalid regex syntax', () => {
      expect(() => validateRegexPattern('[')).toThrow('Invalid regex pattern syntax');
      expect(() => validateRegexPattern('(unclosed')).toThrow('Invalid regex pattern syntax');
      expect(() => validateRegexPattern('*invalid')).toThrow('Invalid regex pattern syntax');
    });

    it('rejects dangerous nested quantifier patterns', () => {
      expect(() => validateRegexPattern('.*.*')).toThrow('dangerous');
      expect(() => validateRegexPattern('.+.+')).toThrow('dangerous');
    });

    it('rejects quantified groups with alternation', () => {
      expect(() => validateRegexPattern('(a|b)+')).toThrow('dangerous');
      expect(() => validateRegexPattern('(foo|bar)*')).toThrow('dangerous');
    });

    it('rejects repeated quantifiers', () => {
      // Note: a{1,10}{1,10} is invalid regex syntax in JS, caught before dangerous check
      expect(() => validateRegexPattern('a{1,10}{1,10}')).toThrow('Invalid regex pattern syntax');
    });
  });
});

describe('createSafeRegex', () => {
  it('creates a regex for valid patterns', () => {
    const regex = createSafeRegex('error');
    expect(regex).toBeInstanceOf(RegExp);
    expect(regex.test('some error here')).toBe(true);
    expect(regex.test('no problems')).toBe(false);
  });

  it('supports flags', () => {
    const regex = createSafeRegex('error', 'i');
    expect(regex.flags).toBe('i');
    expect(regex.test('ERROR')).toBe(true);
  });

  it('supports multiple flags', () => {
    const regex = createSafeRegex('^error', 'gim');
    expect(regex.flags).toContain('g');
    expect(regex.flags).toContain('i');
    expect(regex.flags).toContain('m');
  });

  it('rejects dangerous patterns', () => {
    expect(() => createSafeRegex('.*.*')).toThrow('dangerous');
  });

  it('rejects invalid patterns', () => {
    expect(() => createSafeRegex('[')).toThrow('Invalid regex pattern syntax');
  });
});

describe('parsePositiveInt', () => {
  describe('valid inputs', () => {
    it('parses positive integers', () => {
      expect(parsePositiveInt('0', 'count')).toBe(0);
      expect(parsePositiveInt('1', 'count')).toBe(1);
      expect(parsePositiveInt('42', 'count')).toBe(42);
      expect(parsePositiveInt('1000', 'count')).toBe(1000);
    });

    it('parses integers up to the max limit', () => {
      expect(parsePositiveInt('100', 'count', 100)).toBe(100);
      expect(parsePositiveInt('99', 'count', 100)).toBe(99);
    });
  });

  describe('invalid inputs', () => {
    it('rejects negative numbers', () => {
      expect(() => parsePositiveInt('-1', 'count')).toThrow('non-negative integer');
      expect(() => parsePositiveInt('-100', 'count')).toThrow('non-negative integer');
    });

    it('rejects non-numeric strings', () => {
      expect(() => parsePositiveInt('abc', 'count')).toThrow('non-negative integer');
      expect(() => parsePositiveInt('', 'count')).toThrow('non-negative integer');
      expect(() => parsePositiveInt('12abc', 'count')).not.toThrow(); // parseInt behavior
    });

    it('rejects NaN values', () => {
      expect(() => parsePositiveInt('NaN', 'count')).toThrow('non-negative integer');
    });

    it('rejects values exceeding max', () => {
      expect(() => parsePositiveInt('101', 'count', 100)).toThrow('less than 100');
    });

    it('includes parameter name in error message', () => {
      expect(() => parsePositiveInt('-1', 'myParam')).toThrow('myParam must be');
    });
  });
});
