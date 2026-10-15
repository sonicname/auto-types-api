import type { TypeNode } from './infer';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Options for {@link printType}. */
export interface PrintOptions {
  /** Indentation unit used for nested objects. Defaults to two spaces. */
  indent?: string;
}

/** Prints a {@link TypeNode} as a TypeScript type expression. */
export function printType(node: TypeNode, options: PrintOptions = {}): string {
  return print(node, options.indent ?? '  ', 0);
}

/** Returns whether `name` can be used as a TypeScript identifier. */
export function isIdentifier(name: string): boolean {
  return IDENTIFIER.test(name);
}

function print(node: TypeNode, unit: string, depth: number): string {
  switch (node.kind) {
    case 'primitive':
      return node.name;
    case 'array': {
      const element = print(node.element, unit, depth);
      return node.element.kind === 'union' ? `(${element})[]` : `${element}[]`;
    }
    case 'union':
      return node.members.map((m) => print(m, unit, depth)).join(' | ');
    case 'object': {
      const entries = Object.entries(node.fields);
      if (entries.length === 0) return 'Record<string, unknown>';
      const inner = unit.repeat(depth + 1);
      const lines = entries.map(([key, field]) => {
        const name = isIdentifier(key) ? key : JSON.stringify(key);
        return `${inner}${name}${field.optional ? '?' : ''}: ${print(field.type, unit, depth + 1)};`;
      });
      return `{\n${lines.join('\n')}\n${unit.repeat(depth)}}`;
    }
  }
}
