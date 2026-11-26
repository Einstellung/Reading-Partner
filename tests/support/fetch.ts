// Responses for tests that inject a fake fetch. Both of these had been written
// out by hand in two files apiece, three identical lines each time.
//
// Body and status, and deliberately nothing else. A test whose subject is a
// header keeps its own builder: tests/workshop/extract/http.test.ts varies
// Retry-After because the wait is computed from it. There the header is the
// thing under test, so it belongs where the test can see it.

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}
