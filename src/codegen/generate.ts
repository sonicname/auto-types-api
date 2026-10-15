import type { ApiMethod } from '../server/types';

/** An API file with its URL and the endpoints it serves. */
export interface ApiFile extends ServedEndpoints {
  /** Path relative to the app directory, e.g. `modules/shop/api/products.$id.ts`. */
  file: string;
  /** Full URL pattern in endpoint-kit syntax, e.g. `/api/shop/products/:id`. */
  path: string;
}

/** What an API file serves, found by {@link detectServed}. */
export interface ServedEndpoints {
  /** The export holding `api.serve(...)`, read for its types. */
  handler: 'loader' | 'action';
  methods: ApiMethod[];
}

/** One route of the generated file. */
export interface GeneratedRoute {
  name: string;
  method: ApiMethod;
  path: string;
  file: string;
}

/** Options for {@link generateRoutesCode}. */
export interface CodeOptions {
  /** Import path of each API file, relative to the generated file and without extension. */
  importPath: (file: string) => string;
  /** Name of the exported routes object. Defaults to `routes`. */
  routesName?: string;
}

/** Result of {@link generateRoutesCode}. */
export interface CodeResult {
  code: string;
  routes: GeneratedRoute[];
  warnings: string[];
}

const METHODS: readonly ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Finds what an API file serves: the top-level keys of the object passed to `serve({ ... })`
 * (`{ GET, POST }` or `{ GET: api.get(...) }`) and the export holding it (`loader` unless
 * only `export const action = api.serve(...)` exists).
 */
export function detectServed(source: string): ServedEndpoints {
  const found = new Set<string>();
  for (const match of source.matchAll(/\bserve\s*\(\s*\{/g)) {
    for (const key of topLevelKeys(source, match.index + match[0].length)) found.add(key);
  }
  const holder = /export\s+const\s+(loader|action)\s*=\s*[\w$.]*\bserve\s*\(/.exec(source);
  return {
    handler: holder?.[1] === 'action' ? 'action' : 'loader',
    methods: METHODS.filter((method) => found.has(method)),
  };
}

/** Property names at the top level of the object literal starting at `from` (after its `{`). */
function topLevelKeys(source: string, from: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let expectKey = true;
  for (let i = from; i < source.length; i++) {
    const char = source.charAt(i);
    if (char === '"' || char === "'" || char === '`') {
      i = skipString(source, i);
      expectKey = false;
    } else if ('{(['.includes(char)) {
      depth++;
    } else if ('})]'.includes(char)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && char === ',') {
      expectKey = true;
    } else if (depth === 0 && expectKey && /[A-Za-z_$]/.test(char)) {
      const key = /^[\w$]+/.exec(source.slice(i))?.[0] ?? '';
      keys.push(key);
      i += key.length - 1;
      expectKey = false;
    }
  }
  return keys;
}

function skipString(source: string, start: number): number {
  const quote = source.charAt(start);
  for (let i = start + 1; i < source.length; i++) {
    if (source.charAt(i) === '\\') i++;
    else if (source.charAt(i) === quote) return i;
  }
  return source.length;
}

/** `get` + `/api/shop/products/:id` → `getShopProductsById`. */
export function routeName(method: ApiMethod, path: string, prefix = ''): string {
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const words = rest
    .split('/')
    .filter(Boolean)
    .flatMap((segment) => {
      if (segment === '*') return ['all'];
      if (segment.startsWith(':')) return ['by', ...segment.slice(1).split(/[^A-Za-z0-9]+/)];
      return segment.split(/[^A-Za-z0-9]+/);
    })
    .filter(Boolean);
  return [method.toLowerCase(), ...words.map(capitalize)].join('');
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Generates the source of the routes file for endpoint-kit. */
export function generateRoutesCode(
  files: readonly ApiFile[],
  options: CodeOptions & { prefix?: string },
): CodeResult {
  const routesName = options.routesName ?? 'routes';
  const warnings: string[] = [];
  const imports: string[] = [];
  const entries: string[] = [];
  const routes: GeneratedRoute[] = [];
  const names = new Set<string>();

  for (const api of files) {
    if (api.methods.length === 0) {
      warnings.push(
        `${api.file}: no api.serve({ GET, POST, ... }) found, skipped (see auto-types-api README)`,
      );
      continue;
    }
    if (api.path.includes('*')) {
      warnings.push(
        `${api.file}: splat route "${api.path}" cannot be filled by endpoint-kit clients; call it with a full path instead`,
      );
    }
    const alias = `api${String(imports.length)}`;
    imports.push(`import type * as ${alias} from ${quote(options.importPath(api.file))};`);

    for (const method of api.methods) {
      const base = routeName(method, api.path, options.prefix);
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base}${String(n)}`;
      if (name !== base) warnings.push(`${api.file}: route name "${base}" taken, using "${name}"`);
      names.add(name);

      routes.push({ name, method, path: api.path, file: api.file });
      entries.push(
        `  /** ${method} ${api.path} (${api.file}) */\n` +
          `  ${name}: createRoute.${method.toLowerCase()}(${quote(api.path)}, clientOptions<typeof ${alias}.${api.handler}, '${method}'>()),`,
      );
    }
  }

  const code = [
    '// Generated by auto-types-api. Do not edit by hand.',
    "import { createRoute } from 'endpoint-kit';",
    "import { clientOptions } from 'auto-types-api/client';",
    ...imports,
    '',
    `export const ${routesName} = {`,
    ...entries,
    '};',
    '',
    `export type ${capitalize(routesName)} = typeof ${routesName};`,
    '',
  ].join('\n');

  return { code, routes, warnings };
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
