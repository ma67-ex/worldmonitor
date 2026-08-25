import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fetchNumbeoCountryPrices } from '../scripts/seed-grocery-basket.mjs';

// Mirrors Numbeo's real row structure (confirmed against a live fetch): the
// price is prefixed with an HTML numeric entity for the currency symbol
// (&#36; for $, &#165; for ¥) — those entities contain literal digits, which
// is exactly the trap the parsing regex has to avoid.
function numbeoRow(label, entity, price) {
  return `<tr><td>${label} </td> <td style="text-align: right" class="priceValue "> <span class="first_currency">${entity}${price}</span></td>\n<td class="priceBarTd "></td></tr>`;
}

const USD_FIXTURE = [
  numbeoRow('Milk (Regular, 1 Liter)', '&#36;', '1.06'),
  numbeoRow('White Rice (1 lb)', '&#36;', '2.08'),
  numbeoRow('Potatoes (1 lb)', '&#36;', '1.32'),
  numbeoRow('Eggs (12, Large Size)', '&#36;', '4.33'),
  numbeoRow('Fresh White Bread (1 lb Loaf)', '&#36;', '3.30'),
].join('\n');

const JPY_FIXTURE = [
  numbeoRow('Milk (Regular, 1 Liter)', '&#165;', '230.42'),
].join('\n');

describe('fetchNumbeoCountryPrices', () => {
  it('parses the real price, not the digits inside the currency HTML entity', async () => {
    const fetchFn = async () => new Response(USD_FIXTURE, { status: 200 });
    const prices = await fetchNumbeoCountryPrices('United States', { fetchFn });
    assert.equal(prices.get('milk'), 1.06, 'must not mistake &#36;\'s "36" for the price');
  });

  it('applies the lb->kg unit conversion for rice and potatoes', async () => {
    const fetchFn = async () => new Response(USD_FIXTURE, { status: 200 });
    const prices = await fetchNumbeoCountryPrices('United States', { fetchFn });
    const LB_TO_KG = 2.2046226218;
    assert.equal(prices.get('rice'), +(2.08 * LB_TO_KG).toFixed(4));
    assert.equal(prices.get('potatoes'), +(1.32 * LB_TO_KG).toFixed(4));
  });

  it('leaves eggs and bread unscaled (already matching our item units)', async () => {
    const fetchFn = async () => new Response(USD_FIXTURE, { status: 200 });
    const prices = await fetchNumbeoCountryPrices('United States', { fetchFn });
    assert.equal(prices.get('eggs'), 4.33);
    assert.equal(prices.get('bread'), 3.3);
  });

  it('works with a non-$ currency entity (yen)', async () => {
    const fetchFn = async () => new Response(JPY_FIXTURE, { status: 200 });
    const prices = await fetchNumbeoCountryPrices('Japan', { fetchFn });
    assert.equal(prices.get('milk'), 230.42);
  });

  it('returns an empty map for items the page does not list (sugar/salt/pasta/oil/flour)', async () => {
    const fetchFn = async () => new Response(USD_FIXTURE, { status: 200 });
    const prices = await fetchNumbeoCountryPrices('United States', { fetchFn });
    assert.equal(prices.has('sugar'), false);
    assert.equal(prices.has('salt'), false);
    assert.equal(prices.size, 5, 'only the 5 Numbeo-tracked items should be present');
  });

  it('fails open to an empty map on a non-OK response, never throws', async () => {
    const fetchFn = async () => new Response('not found', { status: 404 });
    const prices = await fetchNumbeoCountryPrices('Nowhere', { fetchFn });
    assert.equal(prices.size, 0);
  });

  it('fails open to an empty map when the fetch itself throws', async () => {
    const fetchFn = async () => { throw new Error('network down'); };
    const prices = await fetchNumbeoCountryPrices('Nowhere', { fetchFn });
    assert.equal(prices.size, 0);
  });
});
