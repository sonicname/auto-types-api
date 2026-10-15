/**
 * Client side of the bridge: turns an API file's endpoint types into endpoint-kit route options.
 *
 * Used by the generated routes file. Everything here is type-level; at runtime the options are
 * empty, so endpoint-kit sends input as-is and returns the server's JSON untouched (the server
 * already validates both).
 *
 * @packageDocumentation
 */
import type { AnySchema, StandardSchemaV1 } from 'endpoint-kit';
import type { ApiEndpoint, EndpointTypes, ServedHandler, ServedMethods } from './server/types';

/** A schema that only carries a type. */
export type TypeOnly<T> = StandardSchemaV1<T, T>;

type Slot<K extends string, S> = S extends AnySchema
  ? Partial<Record<K, TypeOnly<StandardSchemaV1.InferInput<S>>>>
  : unknown;

type TypesOf<E> = E extends ApiEndpoint<infer T> ? T : never;

/** endpoint-kit route options (`params`, `query`, `body`, `headers`, `response`) for an endpoint. */
export type ClientOptions<E extends ApiEndpoint, T extends EndpointTypes = TypesOf<E>> = Slot<
  'params',
  T['params']
> &
  Slot<'query', T['query']> &
  Slot<'body', T['body']> &
  Slot<'headers', T['headers']> & { response?: TypeOnly<T['response']> };

/** The endpoint a served handler answers `M` with. */
export type ServedEndpoint<H extends ServedHandler, M extends ServedMethods<H>> = NonNullable<
  NonNullable<H['~endpoints']>[M]
>;

/**
 * Route options for `createRoute.<method>(path, options)` typed from the endpoint an API file's
 * `loader` serves for `M`. Fails to compile when the file does not serve `M`.
 *
 * @example
 * ```ts
 * import type * as products from './modules/shop/api/products.$id';
 * createRoute.get('/api/shop/products/:id', clientOptions<typeof products.loader, 'GET'>());
 * ```
 */
export function clientOptions<H extends ServedHandler, M extends ServedMethods<H>>(): ClientOptions<
  ServedEndpoint<H, M>
> {
  return {} as ClientOptions<ServedEndpoint<H, M>>;
}
