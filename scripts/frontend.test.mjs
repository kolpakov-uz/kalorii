import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const copy = (value) => JSON.parse(JSON.stringify(value));
function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing real function ${name}`);
  const tail = source.slice(start);
  const next = tail.slice(1).search(/^(?:async )?function /m);
  return next < 0 ? tail.split('\n')[0] : tail.slice(0, next + 1);
}
function load(names, globals = {}) {
  const context = vm.createContext({ JSON, Math, Date, Number, console, R: Math.round, ...globals });
  for (const name of names) vm.runInContext(functionSource(name), context);
  return context;
}
const nutrient = (kcal = 123, unit = 'g') => ({
  method: 'database', unit, checkedAt: '2026-11-02T12:00:00Z',
  per100: { kcal, protein: 12.3, fat: 4.56, carbs: 7.89 },
  sources: [{ provider: 'Matvaretabellen', id: 'test-food', url: 'https://www.matvaretabellen.no/', license: 'source terms' }]
});
const helpers = ['scaleEntry', 'foodUnit', 'nutritionNote', 'nutritionSnapshot', 'resolvedFood', 'apiEntries'];

test('migration removes answer caches while preserving diary, profile and history', () => {
  const old = { profile: { w: 70 }, log: { '2026-11-01': [{ id: 'old', n: 'Плов', g: 200, k: 400 }] }, hist: { 'day|b': [{ r: 'me', t: 'Плов' }] }, dc: { old: { k: 99 } }, foods: [{ n: 'old' }] };
  const context = vm.createContext({ localStorage: { getItem: () => JSON.stringify(old) }, KEY: 'test' });
  vm.runInContext(source.slice(source.indexOf('let S='), source.indexOf('const save=')), context);
  const actual = copy(vm.runInContext('S', context));
  assert.deepEqual(actual.log, old.log);
  assert.deepEqual(actual.hist, old.hist);
  assert.deepEqual(actual.profile, old.profile);
  assert.equal('dc' in actual, false);
  assert.equal('foods' in actual, false);
});

test('resolved food keeps an independent snapshot and rejects incomplete or missing nutrients', () => {
  const context = load(helpers);
  const nutrition = nutrient();
  const entry = context.resolvedFood({ name: 'Рис', grams: 150, nutrition });
  assert.equal(entry.k, 185);
  nutrition.per100.kcal = 900;
  assert.equal(entry.nutrition.per100.kcal, 123);
  assert.equal(context.resolvedFood({ name: 'Рис', grams: 150, kcal: 185 }), null);
  const incomplete = nutrient(); delete incomplete.per100.protein;
  assert.equal(context.resolvedFood({ name: 'Рис', grams: 150, nutrition: incomplete }), null);
});

test('amount corrections scale the saved basis without rounding drift or changing its source', () => {
  const context = load(helpers, { R: Math.round });
  const entry = context.resolvedFood({ name: 'Рис', grams: 137, nutrition: nutrient(123.456) });
  const snapshot = copy(entry.nutrition);
  context.scaleEntry(entry, 51);
  context.scaleEntry(entry, 137);
  assert.equal(entry.k, Math.round(123.456 * 1.37));
  assert.deepEqual(copy(entry.nutrition), snapshot);
  const historical = { g: 137, k: 169, p: 14, f: 8, c: 15 };
  context.scaleEntry(historical, 51);
  context.scaleEntry(historical, 137);
  assert.equal(historical.k, 169);
});

test('ml values retain their unit and amount parsing never treats ml as grams', () => {
  const context = load([...helpers, 'parseGrams'], { R: Math.round });
  assert.equal(context.foodUnit({ nutrition: nutrient(50, 'ml') }), 'мл');
  assert.equal(context.foodUnit({}), 'г');
  assert.equal(context.parseGrams('200 мл'), null);
  assert.equal(context.parseGrams('0,5 кг'), 500);
  assert.equal(context.parseGrams('200 г'), 200);
});

test('quick repeat sends only a fresh food request instead of copying old calories', async () => {
  const requests = [];
  const context = load(['foodUnit', 'quick'], { FQ: [{ i: { n: 'Кефир 2,5%', g: 250, k: 999, nutrition: nutrient(50, 'ml') } }], sendFood: (text) => requests.push(text) });
  await context.quick(0);
  await context.quick(0);
  assert.deepEqual(requests, ['Кефир 2,5%, 250 мл', 'Кефир 2,5%, 250 мл']);
});

test('same typed food always makes a new backend request and keeps prior diary snapshot', async () => {
  const state = { log: {}, hist: {}, dc: { rice: { k: 999 } }, foods: [{ n: 'Рис', k: 999 }] };
  const elements = { '#ai': { textContent: '', dataset: {}, focus() {} }, '#pv': { innerHTML: '' }, '#am': { scrollTop: 0 } };
  const requests = [];
  const context = load([...helpers, 'addEntry', 'normAct', 'applyDish', 'foodCtx', 'parsePortion', 'sendFood'], {
    S: state, R: Math.round, $: (selector) => elements[selector],
    items: (day) => state.log[day] || [], cur: () => '2026-11-02', meal: 'b',
    MEALS: [['b', 'Завтрак']], AF: null, hk: () => '2026-11-02|b',
    esc: String, val: (element) => element.textContent,
    kbFlush() {}, kbSync() {}, save() {}, render() {}, sbtn() {},
    pushH() {}, am: () => ({ innerHTML: '', textContent: '' }), think: () => () => {},
    sleep: async () => {}, hasAPI: () => true, resHtml: () => 'result',
    callAPI: async (request) => {
      requests.push(copy(request));
      return JSON.stringify({ actions: [{ op: 'add', name: 'Рис варёный', grams: 150, nutrition: nutrient(requests.length === 1 ? 123 : 126) }] });
    }
  });
  await context.sendFood('Рис варёный 150 г');
  await context.sendFood('Рис варёный 150 г');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].mode, 'dish');
  assert.equal(requests[1].entries.length, 1);
  assert.equal(state.log['2026-11-02'][0].nutrition.per100.kcal, 123);
  assert.equal(state.log['2026-11-02'][1].nutrition.per100.kcal, 126);
  assert.equal(requests[0].context.includes('Известные блюда'), false);
});

test('backend failure never falls back to stale macros or adds a zero-nutrient entry', async () => {
  const messages = [];
  const state = { log: {}, hist: {}, dc: { rice: { k: 999 } }, foods: [{ n: 'Рис', k: 999 }] };
  const context = load(['sendFood'], {
    S: state, $: (selector) => selector === '#ai' ? { textContent: '', dataset: {}, focus() {} } : { innerHTML: '' },
    meal: 'b', AF: null, cur: () => '2026-11-02', hk: () => 'day|b', esc: String,
    kbFlush() {}, kbSync() {}, sbtn() {}, pushH: (message) => messages.push(message),
    am: () => ({ innerHTML: '', textContent: '' }), think: () => () => {}, sleep: async () => {},
    hasAPI: () => true, foodCtx: () => '', apiEntries: () => [], parsePortion: () => null,
    callAPI: async () => { throw { code: 'lookup_unavailable', message: 'Источник временно недоступен' }; },
    applyDish: () => assert.fail('Failed lookup must not apply food')
  });
  await context.sendFood('Рис 150 г');
  assert.deepEqual(state.log, {});
  assert.equal(messages.at(-1).t, 'Источник временно недоступен');
  assert.equal(context.sendFood.b, 0);
});

test('coach food actions use resolved snapshots and amount-only edits preserve their basis', () => {
  const state = { log: {} };
  const context = load([...helpers, 'applyActions'], {
    S: state, UNDO: null, items: (day) => state.log[day] || [],
    cur: () => '2026-11-02', today: () => '2026-11-02', save() {}
  });
  const result = context.applyActions([
    { type: 'add_food', meal: 'b', name: 'Кефир', grams: 200, nutrition: nutrient(50, 'ml') },
    { type: 'add_food', meal: 'b', name: 'Неподтверждённый продукт', grams: 100, kcal: 999 }
  ]);
  assert.equal(result.length, 1);
  const entry = state.log['2026-11-02'][0];
  assert.equal(entry.k, 100);
  assert.equal(entry.nutrition.unit, 'ml');
  const saved = copy(entry.nutrition);
  context.applyActions([{ type: 'edit_food', id: entry.id, grams: 150 }]);
  assert.equal(entry.k, 75);
  assert.deepEqual(copy(entry.nutrition), saved);
  context.applyActions([{ type: 'edit_food', id: entry.id, name: 'Другой состав', grams: 150, kcal: 999 }]);
  assert.equal(entry.n, 'Кефир');
  assert.equal(entry.k, 75);
});

test('source notice is accessible from settings and add sheet, with OFF license attribution', () => {
  assert.match(source, /function openSources\(/);
  assert.ok((source.match(/onclick="openSources\(\)"/g) || []).length >= 2);
  assert.match(source, /https:\/\/www\.matvaretabellen\.no\/en\/api\//);
  assert.match(source, /https:\/\/world\.openfoodfacts\.org\//);
  assert.match(source, /https:\/\/opendatacommons\.org\/licenses\/odbl\/1-0\//);
});
