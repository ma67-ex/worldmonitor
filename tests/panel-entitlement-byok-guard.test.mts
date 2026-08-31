import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isPanelEntitled } from '../src/config/panels.ts';
import type { PanelConfig } from '../src/types';

// Regression guard for a bug found 2026-08-31 (docs/tasks/abdullah/26-byok-entitlement-bypass-fix.md):
//
// isPanelEntitled()'s apiKeyPanels branch (stock-analysis, market-implications,
// regional-intelligence, deduction, chat-analyst) was unreachable whenever the
// panel's config carried no `premium` field — which is the case for all 5 of
// them since the BYOK commit (2026-08-16, docs/tasks/abdullah/01-byok-panels.md)
// removed `premium: 'locked'` from their panels.ts entries in favor of the
// separate WEB_PREMIUM_PANELS/BYOK_GATED_PANELS mechanism in panel-layout.ts.
// That silently made isPanelEntitled return `true` unconditionally for these
// 5 keys at every OTHER call site (CMD+K search availability, settings-toggle
// visibility, WebMCP's isPanelAllowed) even with no API key present — the
// same "PRO badge + visible internal loader" bug class the
// apiKeyPanels/WEB_PREMIUM_PANELS static guardrail in
// panel-config-guardrails.test.mjs already documents for regional-intelligence
// (PR #3578), just reached through a different call site than the render path.

const APIKEY_PANELS = ['stock-analysis', 'market-implications', 'regional-intelligence', 'deduction', 'chat-analyst'];
const freeConfig: PanelConfig = { name: 'x', enabled: true } as PanelConfig;

describe('isPanelEntitled — BYOK apiKeyPanels gate', () => {
  it('requires an API key (or Pro) for every apiKeyPanels key, even with no premium field set', () => {
    for (const key of APIKEY_PANELS) {
      assert.equal(
        isPanelEntitled(key, freeConfig, false),
        false,
        `${key} must not be entitled without an API key or Pro — this dev process has no ` +
        `WORLDMONITOR_API_KEY configured and no active entitlement`,
      );
    }
  });

  it('isPro bypasses the API-key requirement for apiKeyPanels keys', () => {
    for (const key of APIKEY_PANELS) {
      assert.equal(isPanelEntitled(key, freeConfig, true), true, `${key} must be entitled for a Pro user`);
    }
  });

  it('does not change behavior for ordinary free panels (no premium field, not in apiKeyPanels)', () => {
    assert.equal(isPanelEntitled('conflicts', freeConfig, false), true);
    assert.equal(isPanelEntitled('live-news', freeConfig, false), true);
  });

  it('still gates a genuinely locked non-apiKeyPanels key on config.premium', () => {
    const locked: PanelConfig = { name: 'x', enabled: true, premium: 'locked' as const } as PanelConfig;
    // isDesktopRuntime() is false under plain node:test — matches the web-surface contract.
    assert.equal(isPanelEntitled('latest-brief', locked, false), false);
  });
});
