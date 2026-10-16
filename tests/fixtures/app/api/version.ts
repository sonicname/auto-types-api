import { api } from 'auto-types-api';

export const loader = api.serve({
  GET: api.get({ responseType: 'text', summary: 'API version' }, () => '1.0.0'),
});
