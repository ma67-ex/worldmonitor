// Bring-your-own-key LLM access for the SITREP fork. WorldMonitor's own
// GROQ_API_KEY/OPENROUTER_API_KEY (.env.example) are server-side only and
// never reach the browser — free/non-premium callers get no cloud LLM path
// at all upstream (see ai-flow-settings.ts: cloudLlm routes through a
// premium-gated server RPC that's skipped client-side for non-premium
// principals). This service lets a user supply their OWN Groq/OpenRouter
// key, stored in localStorage, called directly from the browser. Both
// providers expose an OpenAI-compatible /chat/completions endpoint.

export type UserAiProvider = 'groq' | 'openrouter';

const STORAGE_KEY_GROQ = 'sitrep-user-groq-key';
const STORAGE_KEY_OPENROUTER = 'sitrep-user-openrouter-key';

const PROVIDER_CONFIG: Record<UserAiProvider, { url: string; model: string; storageKey: string }> = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    storageKey: STORAGE_KEY_GROQ,
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'google/gemini-2.0-flash-exp:free',
    storageKey: STORAGE_KEY_OPENROUTER,
  },
};

export function getUserAiKey(provider: UserAiProvider): string {
  try {
    return localStorage.getItem(PROVIDER_CONFIG[provider].storageKey) ?? '';
  } catch {
    return '';
  }
}

const listeners = new Set<() => void>();

/**
 * Register a callback for BYOK key changes, mirroring entitlements.ts's
 * onEntitlementChange. panel-layout.ts subscribes so a key saved into
 * Settings re-runs updatePanelGating() immediately instead of leaving a
 * BYOK-eligible panel stuck on its "Sign In to Unlock" CTA until the next
 * unrelated auth/entitlement pass.
 */
export function onUserAiKeyChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setUserAiKey(provider: UserAiProvider, key: string): void {
  try {
    if (key) localStorage.setItem(PROVIDER_CONFIG[provider].storageKey, key);
    else localStorage.removeItem(PROVIDER_CONFIG[provider].storageKey);
  } catch {
    // Quota or private-browsing; silently ignore, same convention as ai-flow-settings.ts
  }
  for (const cb of listeners) cb();
}

/** First provider with a stored key, preferring Groq (faster free tier). */
export function getActiveUserAiProvider(): UserAiProvider | null {
  if (getUserAiKey('groq')) return 'groq';
  if (getUserAiKey('openrouter')) return 'openrouter';
  return null;
}

export function hasUserAiKey(): boolean {
  return getActiveUserAiProvider() !== null;
}

/**
 * Calls the user's own Groq/OpenRouter key directly from the browser,
 * requesting strict JSON output. Throws on any failure — callers should
 * catch and fall back to a locked/unavailable state, same as premiumFetch
 * failures are handled elsewhere.
 */
export async function generateStructuredCompletion(
  systemPrompt: string,
  userPrompt: string,
  timeoutMs = 20_000,
): Promise<unknown> {
  const provider = getActiveUserAiProvider();
  if (!provider) throw new Error('No user-supplied AI key configured');

  const key = getUserAiKey(provider);
  const cfg = PROVIDER_CONFIG[provider];

  const resp = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`${provider} completion failed: ${resp.status} ${body.slice(0, 200)}`);
  }

  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${provider} returned no content`);

  return JSON.parse(content);
}
