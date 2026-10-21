# auto-types-api

[![npm](https://img.shields.io/npm/v/auto-types-api.svg)](https://www.npmjs.com/package/auto-types-api)
[![CI](https://github.com/sonicname/auto-types-api/actions/workflows/ci.yml/badge.svg)](https://github.com/sonicname/auto-types-api/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/auto-types-api.svg)](./LICENSE)

The bridge between [modules-page-routing](https://www.npmjs.com/package/modules-page-routing) API
files and [endpoint-kit](https://www.npmjs.com/package/endpoint-kit) clients.

Declare an endpoint once, in the API file that serves it. auto-types-api validates requests in
React Router's `loader` / `action`, and generates a typed endpoint-kit client from the same
declarations: URLs, path params, query, body, headers, responses and declared errors.

```text
app/modules/shop/api/products.$id.ts       app/api.gen.ts (generated)               anywhere
──────────────────────────────────────     ─────────────────────────────────────    ───────────────────────────────
const GET = api.get(                 ───▶  getShopProductsById: createRoute.get(  ───▶ await client.getShopProductsById(
  { response: Product,                       '/api/shop/products/:id', ...)              { params: { id: 1 } })
    errors: { 404: Problem } },                                                        // data: Product
  handler)                                                                             // error: EndpointError<404, Problem>
```

- **One source of truth**: Zod, Valibot, ArkType or any [Standard Schema](https://standardschema.dev).
- **URLs from modules-page-routing itself**: paths come from its own route builders.
- **No server code in the browser**: endpoints live inside `loader` / `action`, which React Router
  strips from client bundles; the generated client only has `import type` from API files.
- **Types as they arrive over the wire**: `Date` becomes `string`, typed errors per status,
  text and server-sent event responses, multipart uploads.
- **Also on the server**: call the same API in-process from page loaders, and serve an OpenAPI
  document built from the same schemas.

## Contents

- [Install](#install)
- [1. Declare endpoints](#1-declare-endpoints)
- [2. Generate the client](#2-generate-the-client)
- [3. Call the API](#3-call-the-api)
- [OpenAPI](#openapi)
- [Limitations](#limitations)

## Install

```bash
pnpm add auto-types-api endpoint-kit modules-page-routing
pnpm add zod # or any Standard Schema library
```

## 1. Declare endpoints

API files follow modules-page-routing's conventions (`app/api/**` and `app/modules/<module>/api/**`,
`.ts`, `$param` for params). Declare one endpoint per HTTP method and serve them as the route's
`loader` and `action`:

```ts
// app/modules/shop/api/products.$id.ts  →  /api/shop/products/:id
import { api, reply } from 'auto-types-api';
import { z } from 'zod';
import { Problem, Product } from '../schemas';

const params = z.object({ id: z.coerce.number<string | number>() });

const GET = api.get(
  { params, response: Product, errors: { 404: Problem } },
  async ({ params, error }) =>
    (await db.products.find(params.id)) ?? error(404, { message: 'Not found' }),
);

const PATCH = api.patch(
  { params, body: Product.pick({ name: true, price: true }).partial(), response: Product },
  ({ params, body }) => db.products.update(params.id, body),
);

const DELETE = api.delete({ params }, async ({ params }) => {
  await db.products.remove(params.id);
  return reply(204);
});

// One handler for every method; React Router calls loader for GET and action for the rest.
export const loader = api.serve({ GET, PATCH, DELETE });
export const action = loader;
```

```ts
// app/api/health.ts  →  /api/health
import { api } from 'auto-types-api';

export const loader = api.serve({
  GET: api.get(() => ({ ok: true, time: new Date() })), // response type inferred
});
```

> **Keep endpoints unexported and export `loader` / `action` as plain `const`s.** React Router
> builds a client module for every route, API routes included, and strips only `loader`,
> `action` and friends; whatever only they reference (handlers, schemas, `.server` imports) is
> removed with them. An extra `export const GET` would ship your handler code to the browser,
> and `export const { loader, action } = ...` fails the build ("Cannot remove destructured export").

Every `.ts` file under an `api/` folder is a route for modules-page-routing, so keep shared schemas
and helpers outside `api/` (e.g. `app/modules/shop/schemas.ts`).

### Endpoint options

`api.get | post | put | patch | delete(config?, handler)`

| Option                                         | Effect                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `params`                                       | Validates path params (whole-object schema) → `ctx.params`                 |
| `query`                                        | Validates the parsed query string → `ctx.query`                            |
| `body`                                         | Validates the JSON, form or multipart body → `ctx.body`                    |
| `headers`                                      | Validates request headers (lower-case keys) → `ctx.headers`                |
| `response`                                     | Validates what the handler returns; without it the type is inferred        |
| `errors`                                       | `{ 404: Schema, ... }`: error bodies sent with `ctx.error(status, body)`   |
| `bodyType`                                     | `'json'` (default), `'multipart'` or `'form'`: how clients encode the body |
| `responseType`                                 | `'json'` (default), `'text'` or `'sse'`                                    |
| `summary`, `description`, `tags`, `deprecated` | OpenAPI metadata                                                           |

The handler also gets `ctx.request`, `ctx.context` (React Router's context) and `ctx.error`. It may
return data, `reply(status, body?, headers?)` or a raw `Response`. Throwing a `reply()` or an
endpoint-kit `TaggedError` with a `status` works too.

String inputs are coerced when the first validation fails (`"12"` → `12`, `"true"` → `true`), so
`z.number()` works for params and query. Invalid input answers `400`, an invalid response `500`,
an unknown method `405` with `Allow`.

`api.serve(endpoints, options?)` returns one handler for both `loader` and `action`, dispatching on
the request method (`HEAD` uses `GET`). Validation, body parsing and error mapping are
endpoint-kit's own (`handleRoute` from `endpoint-kit/server`), and `options` are its server
options: `validateResponse`, `coerce`, `errorStatus` and `onError(error, { route, request })`.

### Typed params and context

Without a `params` schema, `ctx.params` is `Record<string, string | undefined>`. Create the `api`
with React Router's generated args to type params and context from the file's route:

```ts
import { createApi } from 'auto-types-api';
import type { Route } from './+types/products.$id';

const api = createApi<Route.LoaderArgs>();

const GET = api.get(({ params, context }) => db.products.find(params.id)); // params.id: string
```

### Middlewares

`api.use(fn)` returns an `api` whose endpoints run `fn` first, before input validation. Return an
object to add typed fields to `ctx`, or a `reply()` / `Response` to answer right away:

```ts
const authed = api.use(async ({ request }) => {
  const user = await sessions.user(request);
  if (!user) return reply(401, { message: 'Sign in first' });
  return { user };
});

const POST = authed.post({ body: NewPost }, ({ user, body }) => db.posts.create(user.id, body));
```

Middlewares chain (`api.use(a).use(b)`) and each sees what the previous ones added.

### Declared errors

Statuses listed in `errors` are sent with `ctx.error(status, body)` (typed per status, validated
against its schema) and arrive on the client as `EndpointError<status, body>`:

```ts
const { data, error } = await client.getShopProductsById({ params: { id: 1 } });
if (error?._tag === 'EndpointError' && error.status === 404) {
  error.data.message; // typed from Problem
}
```

Any other failure is endpoint-kit's usual `ApiError`, `ValidationError`, `NetworkError`, ...

### Text and server-sent events

```ts
const VERSION = api.get({ responseType: 'text' }, () => 'v1.4.0');

const Tick = z.object({ n: z.number() });
const TICKS = api.get({ response: Tick, responseType: 'sse' }, async function* ({ request }) {
  for (let n = 0; !request.signal.aborted; n++) {
    yield { n };
    await sleep(1000);
  }
});
```

On the client, `text` resolves to a `string` and `sse` to an `AsyncIterable` of the event type:

```ts
for await (const tick of await client.getShopTicks.orThrow()) console.log(tick.n);
```

### File uploads

```ts
const POST = api.post(
  { body: z.object({ file: z.instanceof(File), note: z.string() }), bodyType: 'multipart' },
  async ({ body }) => storage.put(body.file),
);
// client: await client.postShopUpload({ body: { file, note: 'invoice' } })
```

## 2. Generate the client

### Vite plugin (recommended)

Regenerates on startup and whenever an API file changes:

```ts
// vite.config.ts
import { reactRouter } from '@react-router/dev/vite';
import { autoTypesApi } from 'auto-types-api/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [autoTypesApi(), reactRouter()],
});
```

### CLI

```bash
npx auto-types-api generate            # app/ → app/api.gen.ts + app/api.gen.server.ts
npx auto-types-api generate --watch
```

| Option                           | Default                   | Description                             |
| -------------------------------- | ------------------------- | --------------------------------------- |
| `-a, --app <dir>`                | `./app`                   | Directory with `api/` and `modules/`    |
| `-o, --out <file>`               | `<app>/api.gen.ts`        | Generated client routes                 |
| `-s, --server-out <file\|false>` | `<app>/api.gen.server.ts` | Generated server file (`localFetch`)    |
| `-p, --prefix <path>`            | `/api`                    | Prefix the API routes are mounted under |
| `-n, --name <name>`              | `routes`                  | Name of the exported routes object      |
| `-w, --watch`                    |                           | Regenerate on changes                   |

The same options are available to the Vite plugin and to `generateRoutes()` from
`auto-types-api/codegen`. Ignore the generated files in git (and add `*.gen.ts` and
`*.gen.server.ts` to `.prettierignore`), and run `auto-types-api generate` before `tsc` in CI.

`app/api.gen.ts` looks like this:

```ts
// Generated by auto-types-api. Do not edit by hand.
import { createRoute } from 'endpoint-kit';
import { clientOptions } from 'auto-types-api/client';
import type * as api0 from './api/health';
import type * as api1 from './modules/shop/api/products.$id';

export const routes = {
  /** GET /api/health (api/health.ts) */
  getHealth: createRoute.get('/api/health', clientOptions<typeof api0.loader, 'GET'>()),
  /** GET /api/shop/products/:id (modules/shop/api/products.$id.ts) */
  getShopProductsById: createRoute.get(
    '/api/shop/products/:id',
    clientOptions<typeof api1.loader, 'GET'>({ errors: [404] }),
  ),
  // ...
};
```

Route names are the method plus the path after the prefix: `GET /api/shop/products/:id` →
`getShopProductsById`, `POST /api/v1/user-profile` → `postV1UserProfile`.

## 3. Call the API

### From the browser

```ts
import { createRepository } from 'endpoint-kit';
import { routes } from '~/api.gen';

export const client = createRepository({ baseUrl: '' }) // same origin
  .mergeAll(routes)
  .build();

const { data, error } = await client.getShopProductsById({ params: { id: 1 } });
//      ^? Product
await client.patchShopProductsById.orThrow({ params: { id: 1 }, body: { price: 5 } });
```

Everything endpoint-kit offers works on these routes: TanStack Query helpers, middlewares, retries,
caching, `RouteInput<typeof routes.x>` / `RouteOutput<typeof routes.x>` and so on.

Request and response types exist only at type level: client bundles never include server code or
schema libraries, and the server validates every request. Only what changes the wire format is
kept at runtime (`bodyType`, `responseType`, factories for declared errors).

### From page loaders (in-process)

`app/api.gen.server.ts` exports `localFetch`, which calls the API handlers directly instead of
going over HTTP. Use it with the same routes in loaders and actions; cookies and the
authorization header of the incoming request are forwarded:

```ts
// app/modules/shop/pages/index.tsx
import { createRepository, fetchAdapter } from 'endpoint-kit';
import { routes } from '~/api.gen';
import { localFetch } from '~/api.gen.server';
import type { Route } from './+types/index';

export async function loader({ request, context }: Route.LoaderArgs) {
  const api = createRepository({
    baseUrl: '',
    adapter: fetchAdapter({ fetch: localFetch({ request, context }) }),
  })
    .mergeAll(routes)
    .build();
  return api.getShopProducts.orThrow({ query: { limit: 10 } });
}
```

The file name ends in `.server.ts`, so React Router refuses to bundle it for the browser.
`localFetch({ forwardHeaders: [...] })` changes which headers are forwarded.

## OpenAPI

`auto-types-api/openapi` builds an OpenAPI 3.1 document from the served endpoints at runtime, so an
API route can serve its own spec:

```ts
// app/api/openapi.ts  →  GET /api/openapi
import { api } from 'auto-types-api';
import { createOpenApiDocument } from 'auto-types-api/openapi';

const modules = import.meta.glob(['./**/*.ts', '../modules/*/api/**/*.ts', '!./openapi.ts'], {
  eager: true,
});

export const loader = api.serve({
  GET: api.get(() =>
    createOpenApiDocument({ modules, from: 'api', info: { title: 'Shop', version: '1.0.0' } }),
  ),
});
```

Schemas are converted with Standard JSON Schema (`schema['~standard'].jsonSchema`, built into Zod
4.2+). Types that JSON Schema cannot express (e.g. `z.date()`) are left out and reported through
`onWarning`; endpoints without a `response` schema are listed without one.

## Limitations

- The generator reads the methods from the object passed to `api.serve(...)` (inline, or an object
  literal declared in the same file), and each endpoint's `bodyType`, `responseType` and `errors`
  keys from its config. Files without `api.serve` are skipped with a warning. When something cannot
  be read statically, the generated file fails to compile instead of being silently wrong.
- Splat routes (`$.ts`) are generated but endpoint-kit cannot fill the `*` segment.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
