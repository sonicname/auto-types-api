# auto-types-api

## 0.1.0

### Minor Changes

- 08bf9bd: - `api.serve` now runs on endpoint-kit's `handleRoute` instead of its own copy of the validation,
    body parsing, response and error handling. Behaviour is unchanged except for `onError`, which
    takes endpoint-kit's signature `(error, { route, request })` (`route` is the HTTP method), and
    `errorStatus`, which is now accepted too.
  - Requires `endpoint-kit` ^0.3.0 and `modules-page-routing` ^0.2.0 (the previous peer range did
    not match modules-page-routing 0.2.0).

## 0.0.2

### Patch Changes

- fbadfee: - Vite plugin: regenerate in the `hotUpdate` hook (Vite 6+), before Vite reloads, so deleting an API file in dev no longer logs "Failed to load url" from the generated files. Generations are serialized.
  - Support `index.ts` API routes from modules-page-routing: `api/index.ts` maps to `/api` (no trailing slash) and is named `getRoot`, `modules/<module>/api/index.ts` to `/api/<module>`.

## 0.0.1

Initial release.

- `api.get/post/put/patch/delete`, `createApi<Route.LoaderArgs>()` and `api.use()` middlewares to declare typed endpoints in modules-page-routing API files, served as one React Router `loader`/`action` with `api.serve()`.
- Declared `errors` (`ctx.error`) typed on the client as `EndpointError`, `text` and `sse` responses, multipart and form bodies.
- `auto-types-api generate` CLI, `auto-types-api/vite` plugin and `auto-types-api/codegen`: typed endpoint-kit routes (`api.gen.ts`, JSON-accurate types) and `localFetch` for in-process calls from loaders (`api.gen.server.ts`).
- `auto-types-api/openapi`: an OpenAPI 3.1 document built from the served endpoints.
