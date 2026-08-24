// @vitest-environment node

/**
 * #4771 originally covered structured billing-verification denials
 * (403/503 + `code` + X-Billing-Verification + Retry-After) ahead of the
 * legacy generic 403. That whole mechanism is gone: task 08
 * (docs/tasks/abdullah/08-server-entitlement-stripping.md) made a valid
 * bearer session unconditionally Pro (api/_widget-agent.ts:132-134,
 * "no billing stack behind this deploy") — getEntitlements is never even
 * called on that path anymore. Rewritten (docs/tasks/abdullah/14) to assert
 * the new contract instead of the old denial responses: a valid session is
 * always treated as Pro, and the two auth checks that are still real
 * (invalid session, no credentials at all) still behave as documented.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const validateBearerToken = vi.fn();
vi.mock("../auth-session", () => ({
  validateBearerToken: (...a: unknown[]) => validateBearerToken(...a),
}));

// api/widget-agent.ts reads these at module load. Also imported at
// server/__tests__/widget-agent-billing-denial.test.ts's original path,
// renamed to api/_widget-agent.ts in commit b5839d9b5 (Vercel Hobby's
// 12-function consolidation) — this import was never updated until now.
process.env.WIDGET_AGENT_KEY = "server-widget-key";
process.env.PRO_WIDGET_KEY = "server-pro-key";

const { default: handler } = await import("../../api/_widget-agent");

function bearerRequest(body: Record<string, unknown> = { prompt: "Build a widget", mode: "create", tier: "basic" }): Request {
  return new Request("https://www.worldmonitor.app/api/widget-agent", {
    method: "POST",
    headers: {
      Origin: "https://www.worldmonitor.app",
      "Content-Type": "application/json",
      Authorization: "Bearer test-session-token",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  validateBearerToken.mockReset();
  validateBearerToken.mockResolvedValue({ valid: true, userId: "user_wa", role: "free" });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })),
  );
});

describe("widget-agent auth (post docs/tasks/abdullah/08 unconditional-Pro rewrite)", () => {
  test("valid bearer session is treated as Pro unconditionally, no billing check", async () => {
    await handler(bearerRequest());

    const relayCall = vi.mocked(fetch).mock.calls[0];
    expect(relayCall).toBeDefined();
    const [, init] = relayCall!;
    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Pro-Key"]).toBe("server-pro-key");
    const sentBody = JSON.parse(init!.body as string);
    expect(sentBody.tier).toBe("pro");
  });

  test("invalid or expired session is still rejected with 401", async () => {
    validateBearerToken.mockResolvedValue({ valid: false });

    const res = await handler(bearerRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid or expired session");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("no Authorization header and no legacy widget/pro key is rejected with 403", async () => {
    const req = new Request("https://www.worldmonitor.app/api/widget-agent", {
      method: "POST",
      headers: { Origin: "https://www.worldmonitor.app", "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Build a widget", mode: "create", tier: "basic" }),
    });

    const res = await handler(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
    expect(fetch).not.toHaveBeenCalled();
  });
});
