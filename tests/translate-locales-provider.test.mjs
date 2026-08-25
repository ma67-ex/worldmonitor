import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTranslationProvider, translateBatch } from '../scripts/translate-locales.mjs';

describe('resolveTranslationProvider', () => {
  it('prefers Anthropic when ANTHROPIC_API_KEY is set, ignoring free-tier keys', () => {
    const provider = resolveTranslationProvider({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      OPENROUTER_API_KEY: 'or-test',
      GROQ_API_KEY: 'groq-test',
    });
    assert.deepEqual(provider, { kind: 'anthropic', apiKey: 'sk-ant-test' });
  });

  it('falls back to OpenRouter before Groq when Anthropic is unset', () => {
    const provider = resolveTranslationProvider({
      OPENROUTER_API_KEY: 'or-test',
      GROQ_API_KEY: 'groq-test',
    });
    assert.equal(provider.kind, 'openai-compat');
    assert.equal(provider.name, 'openrouter');
    assert.equal(provider.apiKey, 'or-test');
  });

  it('falls back to Groq when only Groq is set', () => {
    const provider = resolveTranslationProvider({ GROQ_API_KEY: 'groq-test' });
    assert.equal(provider.kind, 'openai-compat');
    assert.equal(provider.name, 'groq');
    assert.equal(provider.apiUrl, 'https://api.groq.com/openai/v1/chat/completions');
  });

  it('returns null when no provider key is set at all', () => {
    assert.equal(resolveTranslationProvider({}), null);
  });
});

describe('translateBatch (openai-compat path)', () => {
  const provider = {
    kind: 'openai-compat',
    name: 'groq',
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: 'groq-test',
    model: 'llama-3.3-70b-versatile',
  };

  it('parses a tab-separated completion into a key->translation map', async () => {
    const fetchFn = async (url, init) => {
      assert.equal(url, provider.apiUrl);
      const body = JSON.parse(init.body);
      assert.equal(body.model, provider.model);
      assert.equal(init.headers.Authorization, 'Bearer groq-test');
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'greeting\tBonjour\nfarewell\tAu revoir' }, finish_reason: 'stop' }],
      }), { status: 200 });
    };

    const out = await translateBatch(provider, 'French', [['greeting', 'Hello'], ['farewell', 'Goodbye']], { fetchFn });
    assert.deepEqual(out, { greeting: 'Bonjour', farewell: 'Au revoir' });
  });

  it('warns but still returns partial content when finish_reason is length', async () => {
    const fetchFn = async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'greeting\tBonjour' }, finish_reason: 'length' }],
    }), { status: 200 });

    const out = await translateBatch(provider, 'French', [['greeting', 'Hello']], { fetchFn });
    assert.deepEqual(out, { greeting: 'Bonjour' });
  });

  it('throws with a bounded error body on a non-OK response', async () => {
    const fetchFn = async () => new Response('rate limited', { status: 429 });

    await assert.rejects(
      translateBatch(provider, 'French', [['greeting', 'Hello']], { fetchFn }),
      /groq translate failed: HTTP 429 — rate limited/,
    );
  });
});
