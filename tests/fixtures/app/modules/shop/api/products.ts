import { api } from 'auto-types-api';
import { z } from 'zod';
import { Product, db } from '../schemas';

export const loader = api.serve({
  GET: api.get(
    {
      query: z.object({ q: z.string().optional(), limit: z.number().int().positive().optional() }),
    },
    ({ query }) =>
      db.filter((p) => !query.q || p.name.includes(query.q)).slice(0, query.limit ?? db.length),
  ),
  POST: api.post({ body: Product.omit({ id: true }), response: Product }, ({ body }) => {
    const product = { id: db.length + 1, ...body };
    db.push(product);
    return product;
  }),
});
export const action = loader;
