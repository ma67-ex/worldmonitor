// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { summarizeArticle } from "../worldmonitor/news/v1/summarize-article";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

function makeContext(headers: Record<string, string> = {}) {
  return {
    request: new Request("https://www.worldmonitor.app/api/news/v1/summarize-article", { headers }),
    pathParams: {},
    headers,
  };
}

function request(mode = "brief") {
  return {
    provider: "groq",
    headlines: ["Headline one", "Headline two"],
    mode,
    geoContext: "",
    variant: "full",
    lang: "en",
    systemAppend: "",
    bodies: [],
  };
}

beforeEach(() => {
  restoreEnv();
  process.env.GROQ_API_KEY = "test-groq-key";
  globalThis.fetch = vi.fn(async () => {
    throw new Error("non-premium summarize should not call providers");
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});

describe("summarizeArticle handler premium mode gate", () => {
  // resolvePremiumCallerIdentity() (premium-check.ts) now unconditionally
  // resolves every caller as premium — no billing stack behind this deploy
  // (task 08, docs/tasks/abdullah/08-server-entitlement-stripping.md). The
  // "Pro subscription required" denial these two tests pinned is dead code
  // for this fork; rewritten (docs/tasks/abdullah/14) to assert anonymous
  // callers now pass the gate exactly like "premium callers pass" below —
  // same technique (drop GROQ_API_KEY so the handler skips before ever
  // reaching a real provider fetch) so the assertion is real, not aspirational.
  test("anonymous article summaries pass the summary gate (docs/tasks/abdullah/14)", async () => {
    delete process.env.GROQ_API_KEY;

    const result = await summarizeArticle(makeContext(), request("brief"));

    expect(result).toMatchObject({
      fallback: true,
      status: "SUMMARIZE_STATUS_SKIPPED",
      statusDetail: "GROQ_API_KEY not configured",
    });
    expect(result.error).not.toBe("Pro subscription required");
  });

  test("anonymous analysis mode passes the summary gate (docs/tasks/abdullah/14)", async () => {
    delete process.env.GROQ_API_KEY;

    const result = await summarizeArticle(makeContext({ "X-WorldMonitor-Key": "wms_basic_session" }), request("analysis"));

    expect(result.error).not.toBe("Pro subscription required");
    expect(result.statusDetail).toBe("GROQ_API_KEY not configured");
  });

  test("translation mode remains outside the premium summary gate", async () => {
    delete process.env.GROQ_API_KEY;

    const result = await summarizeArticle(makeContext(), request("translate"));

    expect(result).toMatchObject({
      fallback: true,
      status: "SUMMARIZE_STATUS_SKIPPED",
      statusDetail: "GROQ_API_KEY not configured",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("premium callers pass the summary gate", async () => {
    delete process.env.GROQ_API_KEY;
    process.env.WORLDMONITOR_VALID_KEYS = "enterprise-test-key";

    const result = await summarizeArticle(
      makeContext({ "X-WorldMonitor-Key": "enterprise-test-key" }),
      request("brief"),
    );

    expect(result).toMatchObject({
      fallback: true,
      status: "SUMMARIZE_STATUS_SKIPPED",
      statusDetail: "GROQ_API_KEY not configured",
    });
    expect(result.error).not.toBe("Pro subscription required");
  });
});
