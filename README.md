# auto-types-api

[![npm](https://img.shields.io/npm/v/auto-types-api.svg)](https://www.npmjs.com/package/auto-types-api)
[![CI](https://github.com/sonicname/auto-types-api/actions/workflows/ci.yml/badge.svg)](https://github.com/sonicname/auto-types-api/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/auto-types-api.svg)](./LICENSE)

Generate TypeScript types from API responses or JSON samples, from code or the command line.

- Zero runtime dependencies
- ESM and CommonJS builds with bundled type declarations
- Merges array items: keys missing from some items become optional, mixed values become unions

## Install

```bash
npm install auto-types-api
# or
pnpm add auto-types-api
```

## Usage

### CLI

```bash
# From an API endpoint
npx auto-types-api https://jsonplaceholder.typicode.com/users/1 --name User

# From a file, written to disk
npx auto-types-api ./response.json -n Response -o src/types/response.ts
```

| Option              | Description                                 |
| ------------------- | ------------------------------------------- |
| `-n, --name <name>` | Name of the generated type (default `Root`) |
| `-o, --out <file>`  | Write to a file instead of stdout           |
| `-h, --help`        | Show help                                   |

### API

```ts
import { generateTypes } from 'auto-types-api';

const response = await fetch('https://api.example.com/posts').then((r) => r.json());

console.log(generateTypes(response, { name: 'Posts' }));
// export type Posts = {
//   id: number;
//   title: string;
//   tags?: string[];
// }[];
```

#### `generateTypes(sample, options?)`

Returns a TypeScript declaration as a string. Objects become an `interface`, everything else a
`type` alias.

| Option   | Type      | Default  | Description                          |
| -------- | --------- | -------- | ------------------------------------ |
| `name`   | `string`  | `'Root'` | Name of the generated type           |
| `export` | `boolean` | `true`   | Prefix the declaration with `export` |
| `indent` | `string`  | `'  '`   | Indentation for nested objects       |

#### Lower-level helpers

- `inferType(value)` returns the intermediate `TypeNode` for a value.
- `mergeTypes(a, b)` merges two `TypeNode`s into one.
- `printType(node, options?)` prints a `TypeNode` as a type expression.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
