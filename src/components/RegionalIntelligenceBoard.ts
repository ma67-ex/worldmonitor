import { Panel } from './Panel';
import { createLazyClient, getRpcBaseUrl } from '@/services/rpc-client';
import { premiumFetch } from '@/services/premium-fetch';
import { IS_EMBEDDED_PREVIEW } from '@/utils/embedded-preview';
import { hasPremiumAccess } from '@/services/panel-gating';
import { hasUserAiKey, generateStructuredCompletion } from '@/services/user-ai-keys';
import { subscribeAuthState } from '@/services/auth-state';
import { onEntitlementChange } from '@/services/entitlements';
import { getSignalAggregator } from '@/services/lazy-signal-aggregator';

import type { RegionalSnapshot, RegimeTransition, RegionalBrief } from '@/generated/client/worldmonitor/intelligence/v1/service_client';
import { h, replaceChildren, setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';
import { BOARD_REGIONS, DEFAULT_REGION_ID, buildBoardHtml, buildRegimeHistoryBlock, buildWeeklyBriefBlock, isLatestSequence } from './regional-intelligence-board-utils';
import { IntelligenceServiceClient } from '@/services/generated-rpc-clients';

// get-regional-snapshot + get-regime-history + get-regional-brief are
// premium-gated. Plain globalThis.fetch skips Clerk/tester/api-key injection
// and returns 401 for pro users — premiumFetch is the correct fetcher here.
const getIntelligenceClient = createLazyClient(() => new IntelligenceServiceClient(getRpcBaseUrl(), { fetch: premiumFetch }));

// ISO country codes per BOARD_REGIONS id, for the BYOK narrative path only.
// Deliberately separate from signal-aggregator.ts's own REGION_DEFINITIONS —
// that map uses finer-grained sub-region ids for its convergence-detection
// logic, not the 7 board regions this panel exposes.
const BOARD_REGION_COUNTRIES: Record<string, string[]> = {
  mena: ['IR', 'IL', 'SA', 'AE', 'IQ', 'SY', 'YE', 'JO', 'LB', 'KW', 'QA', 'OM', 'BH', 'EG', 'DZ', 'MA', 'TN', 'LY'],
  'east-asia': ['CN', 'TW', 'JP', 'KR', 'KP', 'HK', 'MN', 'PH', 'VN', 'ID', 'MY', 'TH', 'SG'],
  europe: ['UA', 'RU', 'BY', 'PL', 'RO', 'MD', 'HU', 'CZ', 'SK', 'BG', 'DE', 'FR', 'GB', 'IT', 'ES', 'TR'],
  'north-america': ['US', 'CA', 'MX'],
  'south-asia': ['IN', 'PK', 'BD', 'AF', 'NP', 'LK', 'MM'],
  latam: ['BR', 'AR', 'CO', 'VE', 'CL', 'PE', 'EC', 'BO'],
  'sub-saharan-africa': ['NG', 'ZA', 'ET', 'KE', 'SD', 'SO', 'CD', 'SN', 'ML', 'NE'],
};

/**
 * RegionalIntelligenceBoard — premium panel rendering a canonical
 * RegionalSnapshot as 6 structured blocks plus narrative sections.
 *
 * Blocks:
 *   1. Regime   — current label, previous label, transition driver
 *   2. Balance  — 7 axes + net_balance bar chart
 *   3. Actors   — top 5 actors by leverage score with deltas
 *   4. Scenarios — 3 horizons × 4 lanes (probability bars)
 *   5. Transmission — top 5 transmission paths
 *   6. Watchlist — active triggers + narrative watch_items
 *
 * Narrative sections (situation, balance_assessment, outlook 24h/7d/30d)
 * render inline above the blocks when populated by the seed's LLM layer.
 * Empty narrative fields are hidden rather than showing empty placeholders.
 *
 * Data source: /api/intelligence/v1/get-regional-snapshot (premium-gated).
 * One call per region change; no polling. Results are cached by the gateway.
 *
 * All HTML builders live in regional-intelligence-board-utils.ts so they can
 * be imported by node:test runners without pulling in Vite-only services.
 */
export class RegionalIntelligenceBoard extends Panel {
  private selector: HTMLSelectElement;
  private body: HTMLElement;
  private currentRegion: string = DEFAULT_REGION_ID;
  /**
   * Monotonically-increasing request sequence. Each `loadCurrent()` call
   * claims a new sequence before it awaits the RPC; when the response comes
   * back, it renders ONLY if its sequence still matches `latestSequence`.
   * Earlier in-flight fetches whose user has already moved on are discarded.
   * Replaces a naive `loading` boolean that used to drop rapid region
   * switches — see PR #2963 review.
   */
  private latestSequence = 0;

  /**
   * Tracks the last-seen entitlement so the auth subscription re-fires the
   * RPC only on a false→true transition, not on every unrelated auth state
   * update (session refresh, unrelated user prefs).
   */
  private lastHadPremium = false;
  /**
   * Handle for the `subscribeAuthState` listener, so `destroy()` can
   * unsubscribe. Without this, recreating the panel (e.g. on framework
   * swap or layout teardown → re-init) would leak listeners that still
   * hold a reference to the destroyed instance's `this` — every old
   * subscriber would call `loadCurrent()` / `renderEmpty()` on a stale
   * DOM tree on every future auth event. Panel.destroy IS called from
   * panel-layout teardown (panel-layout.ts:293, App.ts:1156); the
   * previous "Panel has no destroy hook" comment was wrong.
   */
  private authUnsubscribe: (() => void) | null = null;
  private entitlementUnsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'regional-intelligence',
      title: 'Regional Intelligence',
      infoTooltip:
        'Canonical regional intelligence brief: regime label, 7-axis balance vector, top actors, scenario lanes, transmission paths, and watchlist. One snapshot per region, refreshed every 6 hours.',
      premium: 'locked',
    });

    this.selector = h('select', {
      className: 'rib-region-selector',
      'aria-label': 'Region',
    }) as HTMLSelectElement;
    for (const r of BOARD_REGIONS) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.label;
      if (r.id === DEFAULT_REGION_ID) opt.selected = true;
      this.selector.appendChild(opt);
    }
    this.selector.addEventListener('change', () => {
      this.currentRegion = this.selector.value;
      void this.loadCurrent();
    });

    const controls = h('div', { className: 'rib-controls' }, this.selector);
    this.body = h('div', { className: 'rib-body' });

    replaceChildren(this.content, h('div', { className: 'rib-shell' }, controls, this.body));

    this.renderLoading();
    this.lastHadPremium = hasPremiumAccess();
    void this.loadCurrent();

    // Re-fire loadCurrent on false→true entitlement transitions (user signs
    // in / purchases PRO mid-session). Without this, a user whose Clerk
    // session hasn't resolved at panel-construction time would see
    // renderEmpty() and then stay empty forever even after sign-in, because
    // nothing else triggers loadCurrent for the current region.
    this.authUnsubscribe = subscribeAuthState(() => this.handlePremiumAccessChange());
    this.entitlementUnsubscribe = onEntitlementChange(() => this.handlePremiumAccessChange());
  }

  /** Public API for tests and agent tools: force-load a region directly. */
  public async loadRegion(regionId: string): Promise<void> {
    this.currentRegion = regionId;
    this.selector.value = regionId;
    await this.loadCurrent();
  }

  override destroy(): void {
    this.authUnsubscribe?.();
    this.authUnsubscribe = null;
    this.entitlementUnsubscribe?.();
    this.entitlementUnsubscribe = null;
    // Invalidate any in-flight loadCurrent: the existing sequence guard
    // (see `isLatestSequence` checks) drops responses whose sequence no
    // longer matches `latestSequence`. Bumping it here ensures a pending
    // getRegionalSnapshot that resolves after destroy doesn't try to
    // render into a detached DOM tree.
    this.latestSequence += 1;
    super.destroy();
  }

  private handlePremiumAccessChange(): void {
    const hasPremium = hasPremiumAccess();
    if (hasPremium && !this.lastHadPremium) {
      this.lastHadPremium = true;
      void this.loadCurrent();
    } else if (!hasPremium && this.lastHadPremium) {
      // Entitlement was revoked (sign-out, subscription ended) — blank
      // the panel so stale data doesn't linger for a user who can no
      // longer see it. Panel locking separately re-applies via
      // panel-layout's auth subscription.
      this.lastHadPremium = false;
      this.latestSequence += 1;
      this.renderEmpty();
    }
  }

  /**
   * Client-side fallback for non-premium users: generates ONLY the
   * narrative sections of a RegionalSnapshot from the user's own
   * Groq/OpenRouter key (see services/user-ai-keys.ts), grounded in real
   * client-visible signal-aggregator data for the region's countries.
   * regime/balance/actors/scenarioSets/transmissionPaths/triggers/mobility
   * stay empty — those require the same quantitative scoring pipeline
   * WorldMonitor runs server-side, which a bare completion call cannot
   * reproduce without inventing numbers. The board's block builders already
   * render an honest empty state for each when absent.
   */
  private async generateRegionalSnapshotFromUserKey(regionId: string): Promise<RegionalSnapshot | undefined> {
    if (!hasUserAiKey()) return undefined;
    const countries = BOARD_REGION_COUNTRIES[regionId] ?? [];
    if (countries.length === 0) return undefined;

    const aggregator = await getSignalAggregator();
    const clusters = aggregator.getCountryClusters()
      .filter(c => countries.includes(c.country))
      .sort((a, b) => b.totalCount - a.totalCount)
      .slice(0, 8);
    const convergences = aggregator.getRegionalConvergence()
      .filter(c => c.countries.some(cc => countries.includes(cc)));

    if (clusters.length === 0 && convergences.length === 0) return undefined;

    const lines: string[] = [`Region: ${regionId}`];
    if (convergences.length > 0) {
      lines.push('Regional convergence signals:');
      for (const c of convergences) lines.push(`- ${c.description}`);
    }
    if (clusters.length > 0) {
      lines.push('Country signal activity:');
      for (const c of clusters) {
        lines.push(`- ${c.countryName}: ${c.totalCount} signals (${[...c.signalTypes].join(', ')}), convergence score ${c.convergenceScore}`);
      }
    }
    const contextSnapshot = lines.join('\n');

    const systemPrompt = `You are a geopolitical intelligence analyst writing a regional situation brief for an intelligence dashboard.
Given real signal data for a region (country-level event counts and convergence patterns), write brief text for each section below.
Respond ONLY with a JSON object: { "situation": string, "balanceAssessment": string, "outlook24h": string, "outlook7d": string, "outlook30d": string, "watchItems": string[] }.
Each text field is 1-2 sentences. watchItems is 0-4 short bullet strings naming specific things to watch. Be specific and grounded strictly in the given data — never invent events, actors, or figures not implied by it. If the data is too sparse for a section, say so plainly instead of padding.`;

    try {
      const parsed = await generateStructuredCompletion(systemPrompt, contextSnapshot) as {
        situation?: string; balanceAssessment?: string; outlook24h?: string; outlook7d?: string; outlook30d?: string; watchItems?: string[];
      };
      const toSection = (text: string | undefined) => text?.trim() ? { text: text.trim(), evidenceIds: [] } : undefined;
      return {
        regionId,
        generatedAt: Date.now(),
        actors: [],
        leverageEdges: [],
        scenarioSets: [],
        transmissionPaths: [],
        evidence: [],
        narrative: {
          situation: toSection(parsed.situation),
          balanceAssessment: toSection(parsed.balanceAssessment),
          outlook24h: toSection(parsed.outlook24h),
          outlook7d: toSection(parsed.outlook7d),
          outlook30d: toSection(parsed.outlook30d),
          watchItems: (parsed.watchItems ?? []).filter(w => w?.trim()).slice(0, 4).map(w => ({ text: w.trim(), evidenceIds: [] })),
        },
      };
    } catch (err) {
      console.warn('[RegionalIntelligenceBoard] User-key generation failed:', err);
      return undefined;
    }
  }

  private async loadCurrent(): Promise<void> {
    if (!this.element.isConnected) {
      this.runWhenConnected(() => { void this.loadCurrent(); });
      return;
    }

    // Skip premium RPCs when this app instance is running inside the /pro
    // marketing page's live-preview iframe — no Clerk session carries across
    // that boundary, so every call would 401. The breaker + renderEmpty path
    // already handles "no data" cases visually; short-circuiting here keeps
    // the /pro console and Sentry quiet from these expected failures.
    if (IS_EMBEDDED_PREVIEW) {
      this.renderEmpty();
      return;
    }

    // Skip premium RPCs for anonymous/free users with no BYOK key. Without
    // this the panel fires get-regional-snapshot on every page load for
    // every visitor and gets a 401 in the browser console. The panel's
    // `premium: 'locked'` config + apiKeyPanels entry already keeps it
    // visually hidden until the user is PRO or has a BYOK key — this just
    // stops the RPC from firing during the constructor's
    // `void this.loadCurrent()` before Clerk auth resolves.
    if (!hasPremiumAccess() && !hasUserAiKey()) {
      this.renderEmpty();
      return;
    }

    // Claim a sequence number BEFORE we await anything. The latest claim
    // wins — any response from an earlier sequence is dropped so fast
    // dropdown switches can't leave the panel rendering a stale region.
    this.latestSequence += 1;
    const mySequence = this.latestSequence;
    const myRegion = this.currentRegion;
    this.renderLoading();

    // Phase 1: render the snapshot immediately — never blocked by Phase 3
    // enrichments. History + brief fire in parallel but don't gate the
    // board's core render path. PR #2995 review: the old Promise.allSettled
    // approach blocked the entire panel on slow enrichment RPCs.
    let snapshot: RegionalSnapshot | undefined;
    let actualRegion = myRegion;
    let fallbackFrom: string | null = null;

    if (hasPremiumAccess()) {
      try {
        const resp = await getIntelligenceClient().getRegionalSnapshot({ regionId: myRegion });
        if (!isLatestSequence(mySequence, this.latestSequence)) return;
        snapshot = resp.snapshot;
      } catch (err) {
        if (!isLatestSequence(mySequence, this.latestSequence)) return;
        this.renderError(err instanceof Error ? err.message : String(err));
        return;
      }

      // If the requested region has no snapshot yet, race the other regions
      // and render the FIRST one that returns data. Better UX than telling
      // the user to wait — and we never block on a slow/hung region because
      // (a) we resolve on the first non-empty success rather than waiting for
      // all to settle, and (b) a hard timeout caps the total wait. The
      // generated client has no default per-request timeout, so without both
      // guards a single hung region could leave the panel on the loader.
      if (!snapshot?.regionId) {
        const fallbackIds = BOARD_REGIONS.map(r => r.id).filter(id => id !== myRegion);
        const FALLBACK_TIMEOUT_MS = 4000;
        const winner = await new Promise<{ snapshot: RegionalSnapshot; id: string } | null>(resolve => {
          if (fallbackIds.length === 0) {
            resolve(null);
            return;
          }
          let resolved = false;
          let pending = fallbackIds.length;
          const settle = (value: { snapshot: RegionalSnapshot; id: string } | null) => {
            if (resolved) return;
            resolved = true;
            resolve(value);
          };
          const timer = setTimeout(() => settle(null), FALLBACK_TIMEOUT_MS);
          for (const id of fallbackIds) {
            getIntelligenceClient().getRegionalSnapshot({ regionId: id })
              .then(resp => {
                if (resp.snapshot?.regionId) {
                  clearTimeout(timer);
                  settle({ snapshot: resp.snapshot, id });
                  return;
                }
                if (--pending === 0) {
                  clearTimeout(timer);
                  settle(null);
                }
              })
              .catch(() => {
                if (--pending === 0) {
                  clearTimeout(timer);
                  settle(null);
                }
              });
          }
        });
        if (!isLatestSequence(mySequence, this.latestSequence)) return;
        if (winner) {
          snapshot = winner.snapshot;
          actualRegion = winner.id;
          fallbackFrom = myRegion;
        }
      }
    } else {
      // BYOK path: no server-side quantitative modeling (regime/balance/
      // actors/scenarios/transmission need the same signal-scoring pipeline
      // WorldMonitor runs server-side — a bare LLM call can't fabricate
      // those without inventing numbers). Only the narrative sections are
      // generated, from real client-visible signal data. Every other field
      // stays empty; the board's block builders already render an honest
      // "Unavailable"/"No data" state for each, same as the real feature
      // gap Akul's plan doc flagged for regional snapshots.
      snapshot = await this.generateRegionalSnapshotFromUserKey(myRegion);
      if (!isLatestSequence(mySequence, this.latestSequence)) return;
    }

    if (!snapshot?.regionId) {
      this.renderEmpty();
      return;
    }

    // Render the snapshot blocks immediately — the user sees content now.
    // Pass null for both Phase 3 blocks so they're omitted entirely during
    // the initial paint. They'll be appended (or shown as empty-state) once
    // the background enrichment RPCs resolve. Without null here, the default
    // undefined would render a false "No weekly brief available yet" while
    // the fetch is still in flight. PR #2995 review.
    this.renderBoard(snapshot, null, null, fallbackFrom);

    // Phase 2 (regime history + weekly brief) is premium-only — both RPCs
    // are separately entitlement-gated with no BYOK equivalent data source.
    if (!hasPremiumAccess()) return;

    // Fire history + brief RPCs in background. Use actualRegion so the
    // enrichments match the rendered snapshot when we fell back.
    const historyPromise = getIntelligenceClient().getRegimeHistory({ regionId: actualRegion, limit: 20 }).catch(() => null);
    const briefPromise = getIntelligenceClient().getRegionalBrief({ regionId: actualRegion }).catch(() => null);

    Promise.allSettled([historyPromise, briefPromise]).then(([hResult, bResult]) => {
      if (!isLatestSequence(mySequence, this.latestSequence)) return;

      // Distinguish: RPC failed or upstreamUnavailable (null → omit block)
      // vs RPC succeeded with real data (render block, even if empty).
      // The server returns upstreamUnavailable:true in the body on Redis
      // failure, which still resolves as a fulfilled promise. Check for it.
      const hValue = hResult.status === 'fulfilled' ? hResult.value : null;
      const transitions: RegimeTransition[] | null =
        hValue && !(hValue as unknown as { upstreamUnavailable?: boolean }).upstreamUnavailable
          ? (hValue.transitions ?? [])
          : null;

      const bValue = bResult.status === 'fulfilled' ? bResult.value : null;
      const brief: RegionalBrief | undefined | null =
        bValue && !(bValue as unknown as { upstreamUnavailable?: boolean }).upstreamUnavailable
          ? bValue.brief   // undefined = no brief yet, RegionalBrief = render
          : null;          // null = RPC or upstream failed → omit block

      this.renderBoard(snapshot!, transitions, brief, fallbackFrom);
    });
  }

  private renderLoading(): void {
    setTrustedHtml(this.body, trustedHtml('<div class="rib-status" style="padding:16px;color:var(--text-dim);font-size:calc(12px * var(--wm-panel-effective-scale, 1))">Loading regional intelligence…</div>', "legacy direct innerHTML migration"));
  }

  private renderEmpty(): void {
    setTrustedHtml(this.body, trustedHtml('<div class="rib-status" style="padding:16px;color:var(--text-dim);font-size:calc(12px * var(--wm-panel-effective-scale, 1))">Regional intelligence is being refreshed. Try selecting another region above.</div>', "legacy direct innerHTML migration"));
  }

  private renderError(message: string): void {
    setTrustedHtml(this.body, trustedHtml(`<div class="rib-status rib-status-error" style="padding:16px;color:var(--danger);font-size:calc(12px * var(--wm-panel-effective-scale, 1))">We couldn't load this region right now: ${escapeHtml(message)}</div>`, "legacy direct innerHTML migration"));
  }

  /** Render the full board HTML from a hydrated snapshot + optional Phase 3 data.
   *  null = RPC failed (omit block entirely), array/object = RPC succeeded (render, even if empty).
   *  fallbackFrom: when set, renders a small notice explaining we're showing a
   *  different region than the one the user selected. */
  public renderBoard(
    snapshot: RegionalSnapshot,
    transitions?: RegimeTransition[] | null,
    brief?: RegionalBrief | null,
    fallbackFrom?: string | null,
  ): void {
    let html = '';
    if (fallbackFrom) {
      const requestedLabel = BOARD_REGIONS.find(r => r.id === fallbackFrom)?.label ?? fallbackFrom;
      const actualLabel = BOARD_REGIONS.find(r => r.id === snapshot.regionId)?.label ?? snapshot.regionId;
      html += `<div class="rib-fallback-notice" style="padding:10px 16px;margin:0 0 8px;background:var(--bg-elevated,rgba(255,255,255,0.04));border-left:3px solid var(--warning,#d4a015);font-size:calc(12px * var(--wm-panel-effective-scale, 1));color:var(--text-dim);line-height:1.5">${escapeHtml(requestedLabel)} is being refreshed — showing ${escapeHtml(actualLabel)} in the meantime.</div>`;
    }
    html += buildBoardHtml(snapshot);
    // Phase 3 blocks: only render when the RPC succeeded (non-null).
    // null means the RPC failed — omit the block so we don't show a
    // misleading "no data yet" message for a transient outage.
    // An empty array/undefined-brief from a successful RPC correctly
    // shows the "no transitions" / "no brief" empty state.
    if (transitions !== null && transitions !== undefined) {
      html += buildRegimeHistoryBlock(transitions);
    }
    // brief: null = RPC failed (omit), undefined = no brief yet (show empty state),
    // RegionalBrief = render content. Only null omits the block.
    if (brief !== null) {
      html += buildWeeklyBriefBlock(brief);
    }
    setTrustedHtml(this.body, trustedHtml(html, "legacy direct innerHTML migration"));
  }
}
