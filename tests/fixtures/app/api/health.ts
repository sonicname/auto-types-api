import { api } from 'auto-types-api';

const GET = api.get(() => ({ ok: true as const, uptime: 1 }));

export const loader = api.serve({ GET });
