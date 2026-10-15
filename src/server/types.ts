import type { AnySchema, StandardSchemaV1 } from 'endpoint-kit';
import type { HttpReply } from 'endpoint-kit/server';

/** HTTP methods an API file can export as named endpoints. */
export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A schema slot: any Standard Schema (Zod, Valibot, ArkType, ...) or nothing. */
export type SchemaSlot = AnySchema | undefined;

/** Path params as React Router passes them to loaders and actions. */
export type RouterParams = Record<string, string | undefined>;

/** The part of React Router's `LoaderFunctionArgs` / `ActionFunctionArgs` used here. */
export interface RouterArgs {
  request: Request;
  params: RouterParams;
  context?: unknown;
}

/** A React Router `loader` / `action` produced by {@link serve}. */
export type RouterHandler = (args: RouterArgs) => Promise<Response>;

type MaybePromise<T> = T | Promise<T>;

type Output<S, Fallback> = S extends AnySchema ? StandardSchemaV1.InferOutput<S> : Fallback;

/** Schemas and options of one endpoint. Every slot is optional. */
export interface EndpointConfig<
  TParams extends SchemaSlot = SchemaSlot,
  TQuery extends SchemaSlot = SchemaSlot,
  TBody extends SchemaSlot = SchemaSlot,
  THeaders extends SchemaSlot = SchemaSlot,
  TResponse extends SchemaSlot = SchemaSlot,
> {
  /** Whole-object schema for path params. Keys must match the `$param` segments of the file. */
  params?: TParams;
  query?: TQuery;
  body?: TBody;
  headers?: THeaders;
  /** Validates what the handler returns. Without it the response type is inferred from the handler. */
  response?: TResponse;
}

/** What a handler receives: validated input, the raw request and React Router's context. */
export interface ApiContext<
  TParams extends SchemaSlot = SchemaSlot,
  TQuery extends SchemaSlot = SchemaSlot,
  TBody extends SchemaSlot = SchemaSlot,
  THeaders extends SchemaSlot = SchemaSlot,
> {
  params: Output<TParams, RouterParams>;
  /** Parsed query string, validated when a `query` schema is set. */
  query: Output<TQuery, Record<string, unknown>>;
  /** Parsed request body (JSON, form or text), validated when a `body` schema is set. */
  body: Output<TBody, unknown>;
  /** Validated headers when a `headers` schema is set, else the raw `Headers`. */
  headers: Output<THeaders, Headers>;
  request: Request;
  /** React Router's `context` (`AppLoadContext` or `RouterContextProvider`). */
  context: unknown;
}

/** Anything a handler may return besides data. */
export type RawReturn = HttpReply | Response;

/** What a handler with a `response` schema must return. */
export type SchemaReturn<TResponse extends AnySchema> =
  StandardSchemaV1.InferInput<TResponse> | RawReturn;

/** Data type of a handler's return value, without `reply()` / `Response` branches. */
export type ResponseData<TReturn> = [Exclude<Awaited<TReturn>, RawReturn>] extends [never]
  ? unknown
  : Exclude<Awaited<TReturn>, RawReturn>;

/** Type-level description of an endpoint, read by `auto-types-api/client`. */
export interface EndpointTypes {
  method: ApiMethod;
  params: SchemaSlot;
  query: SchemaSlot;
  body: SchemaSlot;
  headers: SchemaSlot;
  /** The JSON body clients receive. */
  response: unknown;
}

/** One endpoint of an API file, created by `api.get(...)`, `api.post(...)` and so on. */
export interface ApiEndpoint<TTypes extends EndpointTypes = EndpointTypes> {
  readonly method: TTypes['method'];
  readonly config: EndpointConfig;
  readonly handler: (context: ApiContext) => MaybePromise<unknown>;
  /** Phantom field carrying the endpoint's types. Never set at runtime. */
  readonly '~types'?: TTypes;
}

/** Builds an endpoint for one HTTP method. */
export interface EndpointFactory<M extends ApiMethod> {
  /** With a `response` schema: the handler must return its input type. */
  <
    TResponse extends AnySchema,
    TParams extends SchemaSlot = undefined,
    TQuery extends SchemaSlot = undefined,
    TBody extends SchemaSlot = undefined,
    THeaders extends SchemaSlot = undefined,
  >(
    config: EndpointConfig<TParams, TQuery, TBody, THeaders, TResponse> & { response: TResponse },
    handler: (
      context: ApiContext<TParams, TQuery, TBody, THeaders>,
    ) => MaybePromise<SchemaReturn<TResponse>>,
  ): ApiEndpoint<{
    method: M;
    params: TParams;
    query: TQuery;
    body: TBody;
    headers: THeaders;
    response: StandardSchemaV1.InferOutput<TResponse>;
  }>;

  /** Without a `response` schema: the response type is inferred from the handler. */
  <
    TReturn,
    TParams extends SchemaSlot = undefined,
    TQuery extends SchemaSlot = undefined,
    TBody extends SchemaSlot = undefined,
    THeaders extends SchemaSlot = undefined,
  >(
    config: EndpointConfig<TParams, TQuery, TBody, THeaders, undefined>,
    handler: (context: ApiContext<TParams, TQuery, TBody, THeaders>) => MaybePromise<TReturn>,
  ): ApiEndpoint<{
    method: M;
    params: TParams;
    query: TQuery;
    body: TBody;
    headers: THeaders;
    response: ResponseData<TReturn>;
  }>;

  /** Handler only: no validation, response type inferred from the handler. */
  <TReturn>(handler: (context: ApiContext) => MaybePromise<TReturn>): ApiEndpoint<{
    method: M;
    params: undefined;
    query: undefined;
    body: undefined;
    headers: undefined;
    response: ResponseData<TReturn>;
  }>;
}

/** Endpoints of one API file, keyed by method. */
export type ApiEndpoints = Partial<Record<ApiMethod, ApiEndpoint>>;

/** Options for {@link serve}. */
export interface ServeOptions {
  /** Validate handler return values against the `response` schema. Defaults to `true`. */
  validateResponse?: boolean;
  /**
   * Retry validation with `"12"` → `12` and `"true"` → `true` when the first pass fails, so
   * schemas shared with clients (`z.number()`) accept string params and query values.
   * Defaults to `true`.
   */
  coerce?: boolean;
  /** Turn an unexpected error into a response. Defaults to a 500 `{ error: 'InternalServerError' }`. */
  onError?: (error: unknown, request: Request) => Response | Promise<Response>;
}
