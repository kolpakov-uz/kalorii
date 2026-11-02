import test from 'node:test';
import assert from 'node:assert/strict';
import { generateJSON, AIError, candidateSelector, processFoodActions } from './food-pipeline.js';
import { NutritionError } from './nutrition.js';
import worker from './index.js';

const per100 = { kcal: 110, protein: 3, fat: 2, carbs: 20 };
const snapshot = { method: 'database', unit: 'g', per100, sources: [{ provider: 'Matvaretabellen', id: 'mat:test' }] };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const modelReply = value => json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
const context = resolve => () => ({ resolve });

test('food additions strip model macros and stale client metadata before lookup', async () => {
  let seen;
  const result = await processFoodActions({ actions: [{ type: 'add_food', name: 'Рис', query: 'rice cooked', grams: 200, kcal: 9999, kcal100: 9999, nutrition: { per100: { kcal: 9999 } } }], reply: '9999 ккал' }, {}, {
    mode: 'chat', createContext: context(async input => { seen = input; return { ...input, kcal: 220, protein: 6, fat: 4, carbs: 40, nutrition: snapshot }; })
  });
  assert.equal(seen.kcal, undefined);
  assert.equal(seen.kcal100, undefined);
  assert.equal(seen.nutrition, undefined);
  assert.equal(result.actions[0].kcal, 220);
  assert.match(result.reply, /220 ккал/);
  assert.doesNotMatch(result.reply, /9999/);
});

test('amount-only correction changes history quantity without researching or adding a food', async () => {
  const result = await processFoodActions({ actions: [{ type: 'edit_food', id: 'old', grams: 50 }] }, {}, {
    mode: 'chat', entries: [{ id: 'old', name: 'Рис', grams: 100, nutrition: snapshot }],
    createContext: context(() => { throw new Error('must not search historical amount correction'); })
  });
  assert.deepEqual(result.actions, [{ type: 'edit_food', id: 'old', grams: 50 }]);
});

test('composition correction looks up new food and retains original record id', async () => {
  let seen;
  const result = await processFoodActions({ actions: [{ op: 'edit', id: 'old', name: 'Рис сухой', query: 'rice raw', state: 'raw' }] }, {}, {
    entries: [{ id: 'old', name: 'Рис', grams: 120 }],
    createContext: context(async input => { seen = input; return { ...input, kcal: 420, nutrition: snapshot }; })
  });
  assert.equal(seen.grams, 120);
  assert.equal(result.actions[0].id, 'old');
});

test('missing original correction reference asks for clarification', async () => {
  await assert.rejects(processFoodActions({ actions: [{ op: 'edit', id: 'absent', grams: 100 }] }, {}, { createContext: context(() => {}) }), e => e instanceof NutritionError && e.code === 'needs_details');
});

test('the whole request has one 12-ingredient budget, not one budget per dish', async () => {
  const actions = [1, 2].map(() => ({ op: 'add', grams: 100, ingredients: Array.from({ length: 7 }, () => ({ grams: 1 })) }));
  await assert.rejects(processFoodActions({ actions }, {}, { createContext: context(() => { throw new Error('over budget'); }) }), e => e.code === 'needs_details');
});

test('provider failure prevents a partially computed set of changes', async () => {
  let calls = 0;
  await assert.rejects(processFoodActions({ actions: [{ op: 'add', query: 'rice cooked', grams: 100 }, { op: 'add', query: 'rice cooked', grams: 100 }] }, {}, {
    createContext: context(async input => { if (++calls === 2) throw new NutritionError('lookup_unavailable', 'source unavailable'); return { ...input, kcal: 110, nutrition: snapshot }; })
  }), e => e.code === 'lookup_unavailable');
  assert.equal(calls, 2);
});

test('non-food coach actions do not fetch any food source', async () => {
  const input = { actions: [{ type: 'add_water', ml: 250 }], reply: 'Добавлена вода' };
  const result = await processFoodActions(input, {}, { mode: 'chat', createContext: context(() => { throw new Error('must not fetch'); }) });
  assert.deepEqual(result, input);
});

test('a missing English ingredient query is repaired without changing recipe quantities', async () => {
  let received;
  const result = await processFoodActions({ actions: [{ op: 'add', name: 'Салат', grams: 150, yieldGrams: 300, ingredients: [{ name: 'Помидоры сырые', grams: 200, state: 'raw' }] }] }, { GEMINI_KEY: 'test' }, {
    fetchImpl: async () => modelReply({ items: [{ index: 0, query: 'tomato raw' }] }),
    createContext: context(async a => { received = a; return { ...a, kcal: 12, nutrition: snapshot }; })
  });
  assert.equal(received.ingredients[0].query, 'tomato raw');
  assert.equal(received.ingredients[0].grams, 200);
  assert.equal(received.yieldGrams, 300);
  assert.equal(result.actions[0].grams, 150);
});

test('candidate selector sends only food metadata, with no profile/diary to external sources', async () => {
  let sent;
  const choose = candidateSelector({ GEMINI_KEY: 'test' }, async (_, options) => { sent = JSON.parse(options.body); return modelReply({ id: 'mat:rice' }); });
  assert.equal(await choose([{ id: 'mat:rice', label: 'Rice cooked' }], { name: 'Рис', query: 'rice cooked', privateDiary: 'secret' }), 'mat:rice');
  assert.doesNotMatch(JSON.stringify(sent), /privateDiary|secret/);
  assert.equal(sent.tools, undefined); // No paid Google Search or hidden grounding terms.
});

test('model token truncation and malformed JSON never become food mutations', async () => {
  await assert.rejects(generateJSON({ GEMINI_KEY: 'test' }, {}, async () => json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] })), e => e instanceof AIError && e.code === 'ai_response');
  await assert.rejects(generateJSON({ GEMINI_KEY: 'test' }, {}, async () => json({ candidates: [{ content: { parts: [{ text: 'not JSON' }] } }] })), e => e.code === 'ai_response');
});

test('provider diagnostics and secret values never leak through model errors', async () => {
  await assert.rejects(generateJSON({ GEMINI_KEY: 'private-secret' }, {}, async () => new Response('private-secret upstream', { status: 403 })), e => e.code === 'ai_unavailable' && !e.message.includes('private-secret'));
});

test('conflicting action discriminators cannot bypass source lookup with forged nutrition', async () => {
  for (const raw of [{ type: 'add_food', op: 'noop' }, { type: 'edit_food', op: 'delete' }, { type: 'set_goal', op: 'add' }]) {
    await assert.rejects(processFoodActions({ actions: [{ ...raw, grams: 100, nutrition: snapshot }] }, {}, { mode: 'chat', createContext: context(() => { throw new Error('invalid actions rejected first'); }) }), e => e.code === 'needs_details');
  }
});

test('diary and coach action types are canonical regardless of model spelling', async () => {
  const factory = context(async a => ({ ...a, kcal: 110, nutrition: snapshot }));
  const coach = await processFoodActions({ actions: [{ op: 'add', name: 'Рис', query: 'rice cooked', grams: 100 }] }, {}, { mode: 'chat', createContext: factory });
  assert.equal(coach.actions[0].type, 'add_food');
  assert.equal(coach.actions[0].op, undefined);
  const diary = await processFoodActions({ actions: [{ type: 'add_food', name: 'Рис', query: 'rice cooked', grams: 100 }] }, {}, { createContext: factory });
  assert.equal(diary.actions[0].op, 'add');
  assert.equal(diary.actions[0].type, undefined);
});

test('worker preflight and invalid modes preserve API contract without Gemini', async () => {
  const origin = 'https://kolpakov-uz.github.io';
  const preflight = await worker.fetch(new Request('https://worker.test', { method: 'OPTIONS', headers: { Origin: origin } }), {});
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  const invalid = await worker.fetch(new Request('https://worker.test', { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': 'test-invalid-mode' }, body: JSON.stringify({ mode: 'release-check' }) }), {});
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('Cache-Control'), 'no-store');
  const nullBody = await worker.fetch(new Request('https://worker.test', { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': 'test-null' }, body: 'null' }), {});
  assert.equal(nullBody.status, 400);
});
