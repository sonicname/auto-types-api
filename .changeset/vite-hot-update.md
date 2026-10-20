---
'auto-types-api': patch
---

- Vite plugin: regenerate in the `hotUpdate` hook (Vite 6+), before Vite reloads, so deleting an API file in dev no longer logs "Failed to load url" from the generated files. Generations are serialized.
- Support `index.ts` API routes from modules-page-routing: `api/index.ts` maps to `/api` (no trailing slash) and is named `getRoot`, `modules/<module>/api/index.ts` to `/api/<module>`.
