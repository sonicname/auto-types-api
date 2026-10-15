import { api, reply } from 'auto-types-api';
import { z } from 'zod';
import { Product, db } from '../schemas';

const params = z.object({ id: z.coerce.number<string | number>() });

const getProduct = api.get({ params, response: Product }, ({ params }) => {
  return db.find((p) => p.id === params.id) ?? reply(404, { error: 'NotFound' });
});

export const DELETE = api.delete(
  { params, headers: z.object({ 'x-admin': z.literal('1') }) },
  ({ params }) => {
    const index = db.findIndex((p) => p.id === params.id);
    if (index === -1) return reply(404);
    db.splice(index, 1);
    return reply(204);
  },
);

export { getProduct as GET };

export const { loader, action } = api.serve({ GET: getProduct, DELETE });
