# auto-types-api

## 0.0.1

Initial release.

- `api.get/post/put/patch/delete`, `createApi<Route.LoaderArgs>()` and `api.use()` middlewares to declare typed endpoints in modules-page-routing API files, served as one React Router `loader`/`action` with `api.serve()`.
- Declared `errors` (`ctx.error`) typed on the client as `EndpointError`, `text` and `sse` responses, multipart and form bodies.
- `auto-types-api generate` CLI, `auto-types-api/vite` plugin and `auto-types-api/codegen`: typed endpoint-kit routes (`api.gen.ts`, JSON-accurate types) and `localFetch` for in-process calls from loaders (`api.gen.server.ts`).
- `auto-types-api/openapi`: an OpenAPI 3.1 document built from the served endpoints.
