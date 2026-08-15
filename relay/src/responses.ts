/* begin[relay_json_responses] */
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export function jsonResponse(
  body: unknown,
  status: number,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("Content-Type", JSON_CONTENT_TYPE);

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}
/* end[relay_json_responses] */
