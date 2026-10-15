import { describe, expect, it } from 'vitest';
import { inferType, mergeTypes, printType } from '../src';

const print = (value: unknown): string => printType(inferType(value));

describe('inferType', () => {
  it('infers primitives', () => {
    expect(print('a')).toBe('string');
    expect(print(1)).toBe('number');
    expect(print(true)).toBe('boolean');
    expect(print(null)).toBe('null');
    expect(print(undefined)).toBe('unknown');
  });

  it('infers arrays and merges their items', () => {
    expect(print([])).toBe('unknown[]');
    expect(print([1, 2])).toBe('number[]');
    expect(print([1, 'a', null])).toBe('(number | string | null)[]');
    expect(print([[1], ['a']])).toBe('(number | string)[][]');
    expect(print([[], [1]])).toBe('number[][]');
  });

  it('marks keys missing from some items as optional', () => {
    expect(print([{ id: 1, name: 'a' }, { id: 2 }])).toBe(
      '{\n  id: number;\n  name?: string;\n}[]',
    );
  });

  it('keeps fields optional once any sample omits them', () => {
    expect(print([{ a: 1 }, {}, { a: 2 }])).toBe('{\n  a?: number;\n}[]');
  });

  it('quotes keys that are not identifiers and prints empty objects', () => {
    expect(print({ 'content-type': 'x', nested: {} })).toBe(
      '{\n  "content-type": string;\n  nested: Record<string, unknown>;\n}',
    );
  });
});

describe('mergeTypes', () => {
  it('flattens unions and drops duplicate members', () => {
    expect(printType(mergeTypes(inferType('a'), inferType('b')))).toBe('string');
    expect(printType(mergeTypes(mergeTypes(inferType(1), inferType('a')), inferType(2)))).toBe(
      'number | string',
    );
  });

  it('respects a custom indent', () => {
    expect(printType(inferType({ a: { b: 1 } }), { indent: '\t' })).toBe(
      '{\n\ta: {\n\t\tb: number;\n\t};\n}',
    );
  });
});
