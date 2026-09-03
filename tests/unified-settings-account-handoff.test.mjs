import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seatsSource = readFileSync(
  resolve(root, 'src/components/BusinessSeatsSection.ts'),
  'utf8',
);

function extractMethod(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `expected method ${signature}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced method ${signature}`);
}

function transpileHarness(methods, dependencies = []) {
  const js = ts.transpileModule(
    `class Harness { ${methods.join('\n')} }`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText;
  // eslint-disable-next-line no-new-func
  return new Function(...dependencies, `${js}\nreturn Harness;`);
}

describe('BusinessSeatsSection account handoff', () => {
  it('drops an A seat list that settles after the section resets for B', async () => {
    let resolveList = () => {};
    const listResult = new Promise((resolve) => {
      resolveList = resolve;
    });
    const Harness = transpileHarness(
      [
        extractMethod(seatsSource, 'resetForAccountChange('),
        extractMethod(seatsSource, 'async load('),
      ],
      ['listBusinessSeats'],
    )(() => listResult);
    const instance = new Harness();
    let renders = 0;
    instance.accountGeneration = 0;
    instance.seats = [];
    instance.loading = false;
    instance.error = '';
    instance.ownerDomain = null;
    instance.ownerIsCorporateDomain = true;
    instance.removingGrantIds = new Set();
    instance.renderInPlace = () => {
      renders += 1;
    };

    const loadA = instance.load();
    instance.resetForAccountChange();
    resolveList({
      businessSubscriptionId: 'sub-a',
      ownerDomain: 'a.example',
      ownerIsCorporateDomain: true,
      seats: [{ grantId: 'grant-a', inviteeEmail: 'secret@a.example' }],
    });
    await loadA;

    assert.deepEqual(instance.seats, []);
    assert.equal(instance.ownerDomain, null);
    assert.equal(instance.loading, false);
    assert.equal(renders, 1, 'only the B reset may render; A settlement stays inert');
  });
});
