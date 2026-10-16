import { TaggedError } from 'endpoint-kit';

/**
 * A declared error response (`errors: { 404: Schema }` on the endpoint), as received by the
 * generated client. Narrow on `status` to get the typed `data`.
 *
 * @example
 * ```ts
 * const { error } = await client.getShopProductsById({ params: { id: 1 } });
 * if (error?._tag === 'EndpointError' && error.status === 404) error.data.message;
 * ```
 */
export class EndpointError<
  TStatus extends number = number,
  TData = unknown,
> extends TaggedError<'EndpointError'> {
  readonly _tag = 'EndpointError';
  override readonly name = 'EndpointError';

  constructor(
    readonly status: TStatus,
    /** Parsed error body, matching the endpoint's schema for this status. */
    readonly data: TData,
    /** Name of the route that was being called. */
    readonly route: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(`Request to route "${route}" failed with status ${String(status)}`);
  }
}
