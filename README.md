# auto-types-api

[![npm](https://img.shields.io/npm/v/auto-types-api.svg)](https://www.npmjs.com/package/auto-types-api)
[![CI](https://github.com/sonicname/auto-types-api/actions/workflows/ci.yml/badge.svg)](https://github.com/sonicname/auto-types-api/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/auto-types-api.svg)](./LICENSE)

The bridge between [modules-page-routing](https://www.npmjs.com/package/modules-page-routing) API
files and [endpoint-kit](https://www.npmjs.com/package/endpoint-kit) clients.

Declare an endpoint once, in the API file that serves it. auto-types-api validates requests in
React Router's `loader` / `action`, and generates a typed endpoint-kit routes file from the same
declarations, so the client knows every URL, path param, query, body, header and response type.

```text
app/modules/shop/api/products.$id.ts       app/api.gen.ts (generated)               anywhere
──────────────────────────────────────     ─────────────────────────────────────    ───────────────────────────────
export const GET = api.get(          ───▶  getShopProductsById: createRoute.get(  ───▶ await client.getShopProductsById(
  { params, response: Product },             '/api/shop/products/:id', ...)              { params: { id: 1 } })
  handler)                                                                             // data: Product
```

- **One source of truth**: Zod, Valibot, ArkType or any [Standard Schema](https://standardschema.dev).
- **URLs from modules-page-routing itself**: paths are resolved with its own route builders, so they
  always match what React Router serves.
- **No server code in the client**: the generated file only has `import type` from API files.
- **Typed without schemas too**: with no `response` schema the type is inferred from the handler.

## Install

```bash
pnpm add auto-types-api endpoint-kit modules-page-routing
pnpm add zod # or any Standard Schema library
```

## 1. Declare endpoints in API files

API files follow modules-page-routing's conventions (`app/api/**` and `app/modules/<module>/api/**`,
`.ts`, `$param` for params). Export each endpoint under its HTTP method name, then serve them:

```ts
// app/modules/shop/api/products.$id.ts  →  /api/shop/products/:id
import { api, reply } from 'auto-types-api';
import { z } from 'zod';
import { Product } from '../schemas';

const params = z.object({ id: z.coerce.number<string | number>() });

export const GET = api.get({ params, response: Product }, async ({ params }) => {
  return (await db.products.find(params.id)) ?? reply(404, { error: 'NotFound' });
});

export const PATCH = api.patch(
  { params, body: Product.pick({ name: true, price: true }).partial(), response: Product },
  ({ params, body }) => db.products.update(params.id, body),
);

export const DELETE = api.delete({ params }, async ({ params }) => {
  await db.products.remove(params.id);
  return reply(204);
});

// React Router resource route exports
export const { loader, action } = api.serve({ GET, PATCH, DELETE });
```

```ts
// app/api/health.ts  →  /api/health
import { api } from 'auto-types-api';

export const GET = api.get(() => ({ ok: true, time: Date.now() })); // response type inferred
export const { loader, action } = api.serve({ GET });
```

Wire the routes as usual with modules-page-routing:

```ts
// app/routes.ts
const apiTree = import.meta.glob('./api/**/*.ts');
const apiModuleTree = import.meta.glob('./modules/**/api/**/*.ts');

export default [
  // ...pages
  ...prefix('api', [...buildApiRouteConfig(apiTree), ...buildApiModuleRouteConfig(apiModuleTree)]),
] satisfies RouteConfig;
```

> Every `.ts` file under an `api/` folder is a route for modules-page-routing. Keep shared schemas
> and helpers outside `api/` (e.g. `app/modules/shop/schemas.ts`).

### Endpoint options

`api.get | post | put | patch | delete(config?, handler)`

| Option     | Validates                         | Handler receives `ctx.<name>` as                          |
| ---------- | --------------------------------- | --------------------------------------------------------- |
| `params`   | path params (whole-object schema) | schema output, else `Record<string, string \| undefined>` |
| `query`    | parsed query string               | schema output, else parsed object                         |
| `body`     | JSON, form or text body           | schema output, else `unknown`                             |
| `headers`  | request headers (lower-case keys) | schema output, else `Headers`                             |
| `response` | the handler's return value        | (handler must return the schema input)                    |

The handler also gets `ctx.request` and `ctx.context` (React Router's context). It may return
data (sent as JSON), `reply(status, body?, headers?)`, or a raw `Response`. Throwing a `reply()` or
an endpoint-kit `TaggedError` with a `status` works too.

String inputs are coerced when the first validation fails (`"12"` → `12`, `"true"` → `true`), so
`z.number()` works for params and query. Invalid input answers `400`, an invalid response `500`,
an unknown method `405` with `Allow`.

`api.serve(endpoints, { validateResponse?, coerce?, onError? })` returns `{ loader, action }`.

## 2. Generate the client routes

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
npx auto-types-api generate            # app/ → app/api.gen.ts
npx auto-types-api generate --watch
```

| Option                | Default            | Description                             |
| --------------------- | ------------------ | --------------------------------------- |
| `-a, --app <dir>`     | `./app`            | Directory with `api/` and `modules/`    |
| `-o, --out <file>`    | `<app>/api.gen.ts` | Generated file                          |
| `-p, --prefix <path>` | `/api`             | Prefix the API routes are mounted under |
| `-n, --name <name>`   | `routes`           | Name of the exported routes object      |
| `-w, --watch`         |                    | Regenerate on changes                   |

The same options are available to the Vite plugin and to `generateRoutes()` from
`auto-types-api/codegen`. Add `*.gen.ts` to `.prettierignore` and commit the file, or ignore it
and generate it in CI before type checking.

The generated file looks like this:

```ts
// Generated by auto-types-api. Do not edit by hand.
import { createRoute } from 'endpoint-kit';
import { clientOptions } from 'auto-types-api/client';
import type * as api0 from './api/health';
import type * as api1 from './modules/shop/api/products.$id';

export const routes = {
  /** GET /api/health (api/health.ts) */
  getHealth: createRoute.get('/api/health', clientOptions<typeof api0.GET>()),
  /** GET /api/shop/products/:id (modules/shop/api/products.$id.ts) */
  getShopProductsById: createRoute.get('/api/shop/products/:id', clientOptions<typeof api1.GET>()),
  // ...
};
```

Route names are the method plus the path after the prefix: `GET /api/shop/products/:id` →
`getShopProductsById`, `POST /api/v1/user-profile` → `postV1UserProfile`.

## 3. Call the API with endpoint-kit

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

The client is typed only: the generated options carry types but no runtime schemas, so client
bundles never include server code or schema libraries. The server validates every request.

## Limitations

- Endpoints must be exported as `GET`, `POST`, `PUT`, `PATCH` or `DELETE` (directly or with
  `export { x as GET }`). Plain `loader` / `action` exports are skipped with a warning.
- Splat routes (`$.ts`) are generated but endpoint-kit cannot fill the `*` segment.
- Typed error bodies are not carried over to the client yet; errors arrive as endpoint-kit's
  `ApiError` with the response body in `data`.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
