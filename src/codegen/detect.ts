import type { ApiMethod } from '../server/types';

/** Wire-format options of one served endpoint, read from the source. */
export interface DetectedEndpoint {
  method: ApiMethod;
  bodyType?: 'multipart' | 'form';
  responseType?: 'text' | 'sse';
  /** Declared `errors` status codes. */
  errors?: number[];
}

/** What an API file serves, found by {@link detectServed}. */
export interface ServedEndpoints {
  /** The export holding `api.serve(...)`, read for its types. */
  handler: 'loader' | 'action';
  endpoints: DetectedEndpoint[];
  warnings: string[];
}

const METHODS: readonly ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Finds what an API file serves, without running it:
 *
 * - the methods: top-level keys of the object passed to `serve(...)`, inline or declared in the
 *   same file (`serve(endpoints)`), shorthand (`{ GET }`) or not (`{ GET: api.get(...) }`);
 * - per endpoint, `bodyType`, `responseType` and the `errors` status codes from its config;
 * - the export holding it: `loader`, unless only `export const action = ...serve(...)` exists.
 */
export function detectServed(source: string): ServedEndpoints {
  const code = stripComments(source);
  const warnings: string[] = [];
  const endpoints = new Map<ApiMethod, DetectedEndpoint>();

  for (const call of code.matchAll(/\bserve\s*\(\s*/g)) {
    const start = call.index + call[0].length;
    const object =
      code.charAt(start) === '{' ? start : declaredObject(code, identifierAt(code, start));
    if (object === undefined) {
      warnings.push(
        `could not read the endpoints passed to serve(); declare them as an object literal`,
      );
      continue;
    }
    for (const entry of objectEntries(code, object + 1)) {
      if (entry.key === undefined) {
        warnings.push(`spread in serve({ ... }) is not supported, list the methods explicitly`);
        continue;
      }
      const method = METHODS.find((m) => m === entry.key);
      if (!method) continue;
      const text = endpointText(code, entry.value ?? entry.key);
      endpoints.set(method, { method, ...readOptions(code, text, warnings, method) });
    }
  }

  const holder = /export\s+const\s+(loader|action)\s*=\s*[\w$.]*\bserve\s*\(/.exec(code);
  return {
    handler: holder?.[1] === 'action' ? 'action' : 'loader',
    endpoints: METHODS.flatMap((m) => endpoints.get(m) ?? []),
    warnings,
  };
}

/** The call text of an endpoint: inline `api.get(...)`, or the declaration of an identifier. */
function endpointText(code: string, value: string): string {
  if (!/^[\w$]+$/.test(value)) return value;
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${value}\\s*(?::[^=]+)?=`).exec(code);
  if (!declaration) return '';
  const open = code.indexOf('(', declaration.index + declaration[0].length);
  return open === -1 ? '' : code.slice(open, closing(code, open) + 1);
}

function readOptions(
  code: string,
  text: string,
  warnings: string[],
  method: ApiMethod,
): Omit<DetectedEndpoint, 'method'> {
  const options: Omit<DetectedEndpoint, 'method'> = {};
  const bodyType = /\bbodyType\s*:\s*['"`](\w+)['"`]/.exec(text)?.[1];
  if (bodyType === 'multipart' || bodyType === 'form') options.bodyType = bodyType;
  const responseType = /\bresponseType\s*:\s*['"`](\w+)['"`]/.exec(text)?.[1];
  if (responseType === 'text' || responseType === 'sse') options.responseType = responseType;

  // `errors: { ... }`, `errors: name` or shorthand `{ errors }`.
  const errors = /\berrors\s*:\s*/.exec(text) ?? /(?<=[{,]\s*)errors(?=\s*[,}])/.exec(text);
  if (errors) {
    const start = errors.index + errors[0].length;
    const name = errors[0] === 'errors' ? 'errors' : identifierAt(text, start);
    const object =
      text.charAt(start) === '{' && name !== 'errors'
        ? { source: text, index: start }
        : { source: code, index: declaredObject(code, name) };
    if (object.index === undefined) {
      warnings.push(`${method}: could not read its errors; declare them as an object literal`);
    } else {
      const statuses = objectEntries(object.source, object.index + 1)
        .map((entry) => Number(entry.key))
        .filter((status) => Number.isInteger(status));
      if (statuses.length > 0) options.errors = statuses;
    }
  }
  return options;
}

function identifierAt(code: string, index: number): string {
  return /^[\w$]+/.exec(code.slice(index))?.[0] ?? '';
}

/** Index of the `{` of `const <name> = { ... }`. */
function declaredObject(code: string, name: string): number | undefined {
  if (!name) return undefined;
  const match = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=\\s*\\{`).exec(code);
  return match ? match.index + match[0].length - 1 : undefined;
}

interface Entry {
  /** Property name; `undefined` for a spread. */
  key: string | undefined;
  /** Value text; `undefined` for shorthand properties. */
  value: string | undefined;
}

/** Top-level entries of the object literal whose body starts at `from` (after its `{`). */
function objectEntries(code: string, from: number): Entry[] {
  const parts: string[] = [];
  let start = from;
  let depth = 0;
  let end = code.length;
  for (let i = from; i < code.length; i++) {
    const char = code.charAt(i);
    if (char === '"' || char === "'" || char === '`') {
      i = closingQuote(code, i);
    } else if ('{(['.includes(char)) {
      depth++;
    } else if ('})]'.includes(char)) {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    } else if (char === ',' && depth === 0) {
      parts.push(code.slice(start, i));
      start = i + 1;
    }
  }
  // Unterminated objects (a file mid-edit) keep what was read.
  parts.push(code.slice(start, end));
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): Entry => {
      if (part.startsWith('...')) return { key: undefined, value: undefined };
      const match = /^(['"]?)([\w$]+)\1\s*(?::([\s\S]*))?$/.exec(part);
      return { key: match?.[2] ?? '', value: match?.[3]?.trim() };
    });
}

/** Index of the bracket closing the one at `open`. */
function closing(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const char = code.charAt(i);
    if (char === '"' || char === "'" || char === '`') i = closingQuote(code, i);
    else if ('{(['.includes(char)) depth++;
    else if ('})]'.includes(char) && --depth === 0) return i;
  }
  return code.length - 1;
}

function closingQuote(code: string, start: number): number {
  const quote = code.charAt(start);
  for (let i = start + 1; i < code.length; i++) {
    if (code.charAt(i) === '\\') i++;
    else if (code.charAt(i) === quote) return i;
  }
  return code.length;
}

/** Blanks out comments, keeping string contents and offsets intact. */
function stripComments(source: string): string {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const char = source.charAt(i);
    const next = source.charAt(i + 1);
    if (char === '"' || char === "'" || char === '`') {
      const end = closingQuote(source, i);
      out += source.slice(i, end + 1);
      i = end;
    } else if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += ' '.repeat(stop - i);
      i = stop - 1;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else {
      out += char;
    }
  }
  return out;
}
