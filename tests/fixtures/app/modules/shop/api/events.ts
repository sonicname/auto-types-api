import { api } from 'auto-types-api';
import { z } from 'zod';

const Tick = z.object({ n: z.number() });

const GET = api.get(
  { query: z.object({ count: z.number().int().positive() }), response: Tick, responseType: 'sse' },
  async function* ({ query }) {
    for (let n = 1; n <= query.count; n++) yield { n };
  },
);

export const loader = api.serve({ GET });
