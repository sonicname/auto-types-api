import { inferType } from './infer';
import { isIdentifier, printType } from './print';

/** Options for {@link generateTypes}. */
export interface GenerateOptions {
  /** Name of the generated type. Defaults to `Root`. */
  name?: string;
  /** Prefix the declaration with `export`. Defaults to `true`. */
  export?: boolean;
  /** Indentation unit for nested objects. Defaults to two spaces. */
  indent?: string;
}

/**
 * Generates a TypeScript declaration from a sample value, such as a parsed API response.
 *
 * Objects become an `interface`; anything else becomes a `type` alias.
 *
 * @example
 * ```ts
 * generateTypes({ id: 1, tags: ['a'] }, { name: 'Post' });
 * // export interface Post {
 * //   id: number;
 * //   tags: string[];
 * // }
 * ```
 */
export function generateTypes(sample: unknown, options: GenerateOptions = {}): string {
  const name = options.name ?? 'Root';
  if (!isIdentifier(name)) {
    throw new TypeError(`Invalid type name "${name}": must be a valid TypeScript identifier`);
  }

  const node = inferType(sample);
  const body = printType(node, options.indent === undefined ? {} : { indent: options.indent });
  const prefix = options.export === false ? '' : 'export ';

  return node.kind === 'object' && Object.keys(node.fields).length > 0
    ? `${prefix}interface ${name} ${body}\n`
    : `${prefix}type ${name} = ${body};\n`;
}
