---
'auto-types-api': minor
---

- `api.serve` now runs on endpoint-kit's `handleRoute` instead of its own copy of the validation,
  body parsing, response and error handling. Behaviour is unchanged except for `onError`, which
  takes endpoint-kit's signature `(error, { route, request })` (`route` is the HTTP method), and
  `errorStatus`, which is now accepted too.
- Requires `endpoint-kit` ^0.3.0 and `modules-page-routing` ^0.2.0 (the previous peer range did
  not match modules-page-routing 0.2.0).
