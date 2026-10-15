/** Primitive type names a JSON value can produce. */
export type PrimitiveName = 'string' | 'number' | 'boolean' | 'null' | 'unknown';

/** A property of an inferred object type. */
export interface Field {
  type: TypeNode;
  /** True when the key was missing from at least one sample. */
  optional: boolean;
}

/** Intermediate representation of an inferred type, before it is printed. */
export type TypeNode =
  | { kind: 'primitive'; name: PrimitiveName }
  | { kind: 'array'; element: TypeNode }
  | { kind: 'object'; fields: Record<string, Field> }
  | { kind: 'union'; members: TypeNode[] };

const primitive = (name: PrimitiveName): TypeNode => ({ kind: 'primitive', name });

/**
 * Infers a {@link TypeNode} from a JSON-compatible value.
 *
 * Array items are merged into one element type: keys missing from some items become optional,
 * and differing types become a union.
 */
export function inferType(value: unknown): TypeNode {
  if (value === null) return primitive('null');
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return {
      kind: 'array',
      element: items.length === 0 ? primitive('unknown') : items.map(inferType).reduce(mergeTypes),
    };
  }
  switch (typeof value) {
    case 'string':
      return primitive('string');
    case 'number':
      return primitive('number');
    case 'boolean':
      return primitive('boolean');
    case 'object': {
      const fields: Record<string, Field> = {};
      for (const [key, child] of Object.entries(value)) {
        fields[key] = { type: inferType(child), optional: false };
      }
      return { kind: 'object', fields };
    }
    default:
      return primitive('unknown');
  }
}

/** Merges two inferred types into the narrowest type that accepts both. */
export function mergeTypes(a: TypeNode, b: TypeNode): TypeNode {
  const members: TypeNode[] = [];
  for (const member of [...flatten(a), ...flatten(b)]) addMember(members, member);

  // `unknown` only stands in for "no sample seen", so any real member replaces it.
  const known = members.filter((m) => !(m.kind === 'primitive' && m.name === 'unknown'));
  const result = known.length > 0 ? known : members;
  const [first] = result;
  return result.length === 1 && first ? first : { kind: 'union', members: result };
}

function flatten(node: TypeNode): TypeNode[] {
  return node.kind === 'union' ? node.members : [node];
}

function addMember(members: TypeNode[], node: TypeNode): void {
  const index = members.findIndex(
    (m) => m.kind === node.kind && (m.kind !== 'primitive' || m.name === primitiveName(node)),
  );
  const existing = members[index];
  if (existing === undefined) {
    members.push(node);
    return;
  }
  if (existing.kind === 'object' && node.kind === 'object') {
    members[index] = mergeObjects(existing.fields, node.fields);
  } else if (existing.kind === 'array' && node.kind === 'array') {
    members[index] = { kind: 'array', element: mergeTypes(existing.element, node.element) };
  }
}

function primitiveName(node: TypeNode): PrimitiveName | undefined {
  return node.kind === 'primitive' ? node.name : undefined;
}

function mergeObjects(a: Record<string, Field>, b: Record<string, Field>): TypeNode {
  const fields: Record<string, Field> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = a[key];
    const right = b[key];
    const only = left ?? right;
    if (left && right) {
      fields[key] = {
        type: mergeTypes(left.type, right.type),
        optional: left.optional || right.optional,
      };
    } else if (only) {
      fields[key] = { type: only.type, optional: true };
    }
  }
  return { kind: 'object', fields };
}
