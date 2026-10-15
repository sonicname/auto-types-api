export function loader(): Response {
  return Response.json({ legacy: true });
}
