import { describe, expect, it } from 'vitest';
import { generateTypes } from '../src';

describe('generateTypes', () => {
  it('generates an exported interface for objects', () => {
    expect(generateTypes({ id: 1, tags: ['a'] }, { name: 'Post' })).toBe(
      'export interface Post {\n  id: number;\n  tags: string[];\n}\n',
    );
  });

  it('generates a type alias for non-objects', () => {
    expect(generateTypes([{ id: 1 }], { name: 'Users' })).toBe(
      'export type Users = {\n  id: number;\n}[];\n',
    );
    expect(generateTypes({})).toBe('export type Root = Record<string, unknown>;\n');
  });

  it('can omit the export keyword', () => {
    expect(generateTypes(1, { export: false })).toBe('type Root = number;\n');
  });

  it('rejects invalid names', () => {
    expect(() => generateTypes({}, { name: 'not valid' })).toThrow(TypeError);
  });
});
