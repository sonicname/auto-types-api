/**
 * Client side of the bridge: turns the endpoint types an API file serves into endpoint-kit
 * route options. Used by the generated routes file.
 *
 * Request and response types are type-level only: at runtime the options hold no schemas, so
 * endpoint-kit sends input as-is and returns the server's JSON untouched (the server validates
 * both). Only what changes the wire format exists at runtime: `bodyType`, `responseType` and the
 * factories for declared `errors`.
 *
 * @packageDocumentation
 */
import type { AnySchema, ErrorContext, StandardSchemaV1 } from 'endpoint-kit';
import { EndpointError } from './errors';
import type { Jsonify } from './json';
import type {
  ApiBodyType,
  ApiResponseType,
  EndpointTypes,
  ErrorStatus,
  ServedHandler,
  ServedMethods,
} from './server/types';

export { EndpointError } from './errors';
export type { Jsonify } from './json';

/** A schema that only carries a type. */
export type TypeOnly<T> = StandardSchemaV1<T, T>;

type Slot<K extends string, S> = S extends AnySchema
  ? Partial<Record<K, TypeOnly<StandardSchemaV1.InferInput<S>>>>
  : unknown;

type ErrorData<S> = S extends AnySchema ? Jsonify<StandardSchemaV1.InferOutput<S>> : unknown;

/** The declared error a status produces on the client. */
export type DeclaredError<E, S extends ErrorStatus<E>> = EndpointError<S, ErrorData<E[S]>>;

type Exact<K extends string, V, Default> = [V] extends [Default]
  ? Partial<Record<K, undefined>>
  : Record<K, V>;

/** Endpoint types of the endpoint a served handler answers `M` with. */
export type ServedTypes<H extends ServedHandler, M extends ServedMethods<H>> =
  NonNullable<H['~endpoints'][M]> extends { readonly '~types'?: infer T extends EndpointTypes }
    ? T
    : never;

/**
 * Options that exist at runtime because they change the wire format. The generated file passes
 * them; they must match the endpoint, or the generated file does not compile.
 */
export type StaticOptions<T extends EndpointTypes> = Exact<'bodyType', T['bodyType'], 'json'> &
  Exact<'responseType', T['responseType'], 'json'> &
  Exact<'errors', readonly ErrorStatus<T['errors']>[], readonly never[]>;

type StaticArgs<T extends EndpointTypes> =
  Record<never, never> extends StaticOptions<T>
    ? [options?: StaticOptions<T>]
    : [options: StaticOptions<T>];

/** endpoint-kit route options for an endpoint. */
export type ClientOptions<T extends EndpointTypes> = Slot<'params', T['params']> &
  Slot<'query', T['query']> &
  Slot<'body', T['body']> &
  Slot<'headers', T['headers']> & { response?: TypeOnly<Jsonify<T['response']>> } & ([
    ErrorStatus<T['errors']>,
  ] extends [never]
    ? unknown
    : {
        errors: {
          [S in ErrorStatus<T['errors']>]?: (
            context: ErrorContext,
          ) => DeclaredError<T['errors'], S>;
        };
      }) &
  (T['bodyType'] extends 'json' ? unknown : { bodyType: T['bodyType'] }) &
  (T['responseType'] extends 'json' ? unknown : { responseType: T['responseType'] });

/** Passes values through; lets endpoint-kit JSON-parse server-sent events. */
const passthrough: AnySchema = {
  '~standard': { version: 1, vendor: 'auto-types-api', validate: (value) => ({ value }) },
};

const declaredError = (context: ErrorContext): EndpointError =>
  new EndpointError(context.status, context.data, context.route, context.headers);

/**
 * Route options for `createRoute.<method>(path, options)` typed from the endpoint an API file
 * serves for `M`. Fails to compile when the file does not serve `M`, or when `options` does not
 * match the endpoint's `bodyType`, `responseType` or declared `errors`.
 *
 * @example
 * ```ts
 * import type * as products from './modules/shop/api/products.$id';
 * createRoute.get(
 *   '/api/shop/products/:id',
 *   clientOptions<typeof products.loader, 'GET'>({ errors: [404] }),
 * );
 * ```
 */
export function clientOptions<H extends ServedHandler, M extends ServedMethods<H>>(
  ...[options]: StaticArgs<ServedTypes<H, M>>
): ClientOptions<ServedTypes<H, M>> {
  const { bodyType, responseType, errors } = (options ?? {}) as {
    bodyType?: ApiBodyType;
    responseType?: ApiResponseType;
    errors?: readonly number[];
  };
  const result: Record<string, unknown> = {};
  if (bodyType) result['bodyType'] = bodyType;
  if (responseType) result['responseType'] = responseType;
  if (responseType === 'sse') result['response'] = passthrough;
  if (errors?.length) result['errors'] = Object.fromEntries(errors.map((s) => [s, declaredError]));
  return result as ClientOptions<ServedTypes<H, M>>;
}
