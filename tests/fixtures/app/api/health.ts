import { api } from 'auto-types-api';

// Handler-only endpoint; the Date arrives as a string on the client (Jsonify).
const GET = api.get(() => ({ ok: true as const, startedAt: new Date(0) }));

export const loader = api.serve({ GET });
