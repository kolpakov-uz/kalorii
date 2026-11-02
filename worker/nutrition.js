// The bundled index contains names/URLs only. Nutrient data is fetched fresh per food request.
import FOOD_INDEX from './food-index.js';
const OFF_ORIGIN = 'https://world.openfoodfacts.org';
const USER_AGENT = 'Kalorii/2.0 (https://kolpakov-uz.github.io/kalorii/)';
const KEYS = ['kcal', 'protein', 'fat', 'carbs'];
const MAX_INGREDIENTS = 12;

export class NutritionError extends Error {
  constructor(code, message) { super(message); this.name = 'NutritionError'; this.code = code; }
}
const problem = (code, message) => new NutritionError(code, message);
const missing = (reason = 'not_found') => Object.assign(problem('no_match', 'Не нашёл подходящий продукт с полными КБЖУ. Уточните название, способ приготовления или марку; можно прислать фото этикетки.'), { reason });
const finite = (value) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;
const clean = (value, length = 160) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, length);
const norm = (value) => clean(value).normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}%.,]+/gu, ' ').trim();
const singular = (word) => /^(tomatoes|potatoes|mangoes|avocadoes)$/.test(word) ? word.slice(0, -2) : word.length > 3 ? word.replace(/s$/, '') : word;
const words = (value) => norm(value).replace(/\d+(?:[.,]\d+)?\s*%/g, ' ').split(/[\s,.;]+/).map(singular).filter(x => x.length > 1);
const OMIT = new Set(['raw', 'cooked', 'ready', 'boiled', 'fresh', 'food', 'plain', 'unsalted', 'salted', 'with', 'without', 'and', 'the', 'per', 'gram', 'fat', 'percent']);
const meaningful = (value) => words(value).filter(x => !OMIT.has(x));
const stateOf = (label) => /\b(cooked|boiled|fried|baked|roasted|grilled|steamed|stewed)\b/i.test(label) ? 'cooked' : /\b(raw|uncooked|dry|dried)\b/i.test(label) ? 'raw' : 'unspecified';
const explicitFat = (label) => { const m = String(label).match(/(\d+(?:[.,]\d+)?)\s*(?:%|percent(?:\s+(?:milk)?fat)?)/i); return m ? Number(m[1].replace(',', '.')) : null; };
const round = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

function checkedNutrients(values) {
  if (!values || KEYS.some(k => finite(values[k]) === null || Number(values[k]) < 0)) return null;
  const n = Object.fromEntries(KEYS.map(k => [k, Number(values[k])]));
  if (n.kcal > 1000 || n.protein > 100 || n.fat > 100 || n.carbs > 100) return null;
  return n;
}

async function readContent(url, fetchImpl, options = {}, asHTML = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(url, { ...options, cache: 'no-store', signal: controller.signal, headers: { Accept: asHTML ? 'text/html' : 'application/json', 'Cache-Control': 'no-cache', 'User-Agent': USER_AGENT, ...options.headers } });
    if (response.status === 404) return null;
    if (response.status === 429) throw problem('lookup_unavailable', 'Справочник временно ограничил запросы. Подождите немного и попробуйте снова.');
    if (!response.ok) throw problem('lookup_unavailable', 'Не удалось получить свежие данные справочника. Попробуйте ещё раз позже.');
    if (Number(response.headers?.get('content-length')) > 25000000) throw problem('lookup_unavailable', 'Ответ справочника слишком большой. Попробуйте позже.');
    return await (asHTML ? response.text() : response.json());
  } catch (error) {
    if (error instanceof NutritionError) throw error;
    throw problem('lookup_unavailable', 'Справочник сейчас недоступен. Старые значения не подставлены; попробуйте ещё раз позже.');
  } finally { clearTimeout(timer); }
}
const readJSON = (url, fetchImpl, options) => readContent(url, fetchImpl, options, false);

function matRecord([foodId, foodName, uri, keywords = '']) {
  if (!foodId || !foodName) return null;
  const label = clean(foodName);
  let sourceUrl;
  try { const url = new URL(uri, 'https://www.matvaretabellen.no'); if (url.protocol === 'https:' && url.hostname === 'www.matvaretabellen.no' && url.pathname.startsWith('/en/')) sourceUrl = url.href; } catch {}
  if (!sourceUrl) return null;
  return { id: `mat:${clean(foodId, 60)}`, provider: 'Matvaretabellen', label, brand: '', unit: 'g', state: stateOf(label), fatPercent: explicitFat(label), countryTags: [], keywords: clean(keywords, 500), terms: new Set(words(label + ' ' + keywords)), foodId: String(foodId), sourceUrl };
}
const MAT_RECORDS = FOOD_INDEX.map(matRecord).filter(Boolean);

function matNutrients(html, record) {
  if (typeof html !== 'string' || !html.includes(`data-food-id="${record.foodId}"`) || !/class="[^"]*js-portion-label[^"]*"[^>]*>\s*100\s*g\s*</i.test(html)) throw missing('source_page_schema');
  const calorieTag = html.match(/<span\b(?=[^>]*class="[^"]*\bmvt-kcal\b)[^>]*>/i)?.[0];
  const kcal = finite(calorieTag?.match(/\bdata-value="([^"]+)"/)?.[1]);
  const values = { kcal, protein: null, fat: null, carbs: null };
  const names = { protein: 'protein', fat: 'fat', carbohydrate: 'carbs' };
  for (const [row] of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const slug = row.match(/<a\b[^>]*href="\/en\/(protein|fat|carbohydrate)\/"/i)?.[1];
    if (!slug || values[names[slug.toLowerCase()]] !== null) continue;
    const amount = row.match(/<span\b[^>]*\bdata-value="([^"]+)"[^>]*>/i)?.[1];
    // Source rows explicitly give grams, not the adjacent energy percentages.
    if (amount !== undefined && /class="[^"]*mvt-sym[^"]*"[^>]*>\s*g\s*</i.test(row)) values[names[slug.toLowerCase()]] = finite(amount);
  }
  const per100 = checkedNutrients(values);
  if (!per100) throw missing('incomplete_nutrients');
  return per100;
}

function matching(action) {
  return { unit: action.unit || 'g', state: action.state || stateOf(action.query || action.name), fatPercent: finite(action.fatPercent), brand: action.brand ? meaningful(action.brand) : null, query: meaningful((action.query || '') + ' ' + (action.name || '')), rankQuery: meaningful(action.query || action.name) };
}
const termsOf = candidate => candidate.terms || new Set(words(candidate.label + ' ' + (candidate.keywords || '')));

function compatible(candidate, action, { exactBarcode = false, match = matching(action) } = {}) {
  if (candidate.unit && candidate.unit !== match.unit) return false;
  const state = match.state;
  if ((state === 'raw' && candidate.state === 'cooked') || (state === 'cooked' && candidate.state === 'raw')) return false;
  const requestedFat = match.fatPercent;
  if (requestedFat !== null && candidate.fatPercent !== null && candidate.fatPercent !== undefined && Math.abs(requestedFat - candidate.fatPercent) > 0.15) return false;
  if (match.brand) {
    const actual = candidate.brandTerms || new Set(words(candidate.brand));
    if (!match.brand.length || !match.brand.every(w => actual.has(w))) return false;
  }
  if (!exactBarcode) {
    const label = termsOf(candidate);
    if (!match.query.length || !match.query.some(w => label.has(w))) return false;
  }
  return true;
}

function rank(candidate, match) {
  const query = match.rankQuery, label = termsOf(candidate);
  const overlap = query.filter(x => label.has(x)).length / Math.max(1, query.length);
  const state = match.state;
  return overlap * 10 + (state !== 'unspecified' && candidate.state === state ? 2 : 0) + (candidate.countryTags || []).includes('en:uzbekistan') * 0.2;
}

function publicCandidate(candidate) {
  return Object.fromEntries(['id', 'provider', 'label', 'brand', 'state', 'unit', 'fatPercent', 'countryTags'].map(k => [k, candidate[k]]));
}

async function choose(candidates, action, selectCandidate) {
  const match = matching(action);
  candidates = candidates.filter(c => compatible(c, action, { match })).map(candidate => ({ candidate, score: rank(candidate, match) })).sort((a, b) => b.score - a.score).slice(0, 12).map(item => item.candidate);
  if (!candidates.length) throw missing('no_candidates');
  if (selectCandidate) {
    const id = await selectCandidate(candidates.map(publicCandidate), action);
    let selected = candidates.find(c => c.id === id);
    if (id === null && !action.brand && !action.barcode) {
      // An ordinary raw ingredient may have only a regional qualifier in the table.
      // Accept a unique exact identity; never turn a different dish/variety into a match.
      const query = meaningful(action.query || action.name);
      const state = action.state || stateOf(action.query || action.name);
      const harmless = new Set(['norwegian', 'imported', 'unspecified', 'plain', 'raw', 'uncooked', 'cooked', 'boiled', 'fresh']);
      const exact = candidates.filter(candidate => {
        if (!query.length || !['raw', 'cooked'].includes(state) || candidate.state !== state) return false;
        const label = words(candidate.label);
        return query.every(word => label.includes(word)) && label.every(word => query.includes(word) || harmless.has(word));
      });
      if (exact.length === 1) selected = exact[0];
    }
    if (!selected) throw missing('selection_unresolved');
    return selected;
  }
  // Without the model's semantic check, accept only an unambiguous full lexical match.
  const query = match.rankQuery;
  const full = candidates.filter(c => query.every(w => termsOf(c).has(w)));
  if (full.length !== 1) throw problem('needs_details', 'Есть несколько вариантов продукта. Уточните состав, жирность и способ приготовления.');
  return full[0];
}

function offRecord(product) {
  if (!product || !/^\d{8,14}$/.test(String(product.code || product._id || ''))) return null;
  const label = clean(product.product_name_ru || product.product_name_en || product.product_name || product.generic_name);
  if (!label) return null;
  return { id: `off:${product.code || product._id}`, provider: 'OpenFoodFacts', label, brand: clean(product.brands), terms: new Set(words(label)), brandTerms: new Set(words(product.brands)), state: stateOf(label), unit: null, fatPercent: explicitFat(label), countryTags: Array.isArray(product.countries_tags) ? product.countries_tags.slice(0, 30) : [], code: String(product.code || product._id), product };
}

function offNutrients(product, action) {
  const wantedUnit = action.unit || 'g';
  const sets = product.nutrition?.input_sets;
  if (!Array.isArray(sets)) throw missing();
  const asPrepared = action.state === 'cooked';
  const usable = sets.filter(s => ['manufacturer', 'packaging'].includes(s.source) && (s.preparation || 'as_sold') === (asPrepared ? 'prepared' : 'as_sold'));
  usable.sort((a, b) => (a.source === 'manufacturer' ? 0 : 1) - (b.source === 'manufacturer' ? 0 : 1));
  for (const set of usable) {
    const unit = set.per === '100g' ? 'g' : set.per === '100ml' ? 'ml' : set.per === 'serving' ? set.per_unit : null;
    const quantity = set.per === 'serving' ? finite(set.per_quantity) : 100;
    if (unit !== wantedUnit || !quantity || quantity <= 0) continue;
    const nutrients = set.nutrients || {};
    const value = (id, targetUnit) => {
      const n = nutrients[id];
      if (!n || n.modifier) return null;
      const v = finite(n.value);
      if (v === null) return null;
      const sourceUnit = String(n.unit || targetUnit).toLowerCase();
      if (sourceUnit === targetUnit.toLowerCase()) return v * 100 / quantity;
      if (targetUnit === 'g' && sourceUnit === 'mg') return v / 1000 * 100 / quantity;
      return null;
    };
    const kcal = value('energy-kcal', 'kcal');
    const kj = value('energy-kj', 'kJ') ?? value('energy', 'kJ');
    const per100 = checkedNutrients({ kcal: kcal ?? (kj === null ? null : kj / 4.184), protein: value('proteins', 'g'), fat: value('fat', 'g'), carbs: value('carbohydrates', 'g') ?? value('carbohydrates-total', 'g') });
    if (per100) return { per100, unit };
  }
  throw missing();
}

function sourceFor(record) {
  return record.provider === 'Matvaretabellen'
    ? { provider: record.provider, id: record.id, label: record.label, url: record.sourceUrl || 'https://www.matvaretabellen.no/en/', license: 'Matvaretabellen attribution' }
    : { provider: record.provider, id: record.id, label: record.label, url: `${OFF_ORIGIN}/product/${record.code}`, license: 'ODbL-1.0' };
}

function quantity(action) {
  const amount = finite(action.grams);
  if (amount === null || amount < 1 || amount > 5000 || !['g', 'ml'].includes(action.unit || 'g')) throw problem('needs_details', 'Уточните количество еды в граммах или объём напитка в миллилитрах.');
  return amount;
}

function enrich(action, per100, sources, method, options, recipe) {
  const amount = quantity(action), estimatedPortion = !!action.estimatedPortion || !!options.photo;
  const estimatedRecipe = !!action.estimatedRecipe;
  return { ...action, grams: amount, kcal100: round(per100.kcal), protein100: round(per100.protein), fat100: round(per100.fat), carbs100: round(per100.carbs),
    ...Object.fromEntries(KEYS.map(k => [k, round(per100[k] * amount / 100)])),
    nutrition: { method: estimatedRecipe ? 'estimate' : method, checkedAt: new Date().toISOString(), unit: action.unit || 'g', per100: Object.fromEntries(KEYS.map(k => [k, round(per100[k])])), sources, estimatedPortion, estimatedRecipe, ...(recipe ? { recipe } : {}) } };
}

export function createNutritionContext(env = {}, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const index = options.foodIndex ? options.foodIndex.map(matRecord).filter(Boolean) : MAT_RECORDS;

  async function getOff(action) {
    const barcode = clean(action.barcode, 30).replace(/\s/g, '');
    if (barcode && !/^\d{8,14}$/.test(barcode)) throw problem('needs_details', 'Проверьте штрихкод продукта: нужны от 8 до 14 цифр.');
    let record;
    if (barcode) {
      const data = await readJSON(`${OFF_ORIGIN}/api/v3.6/product/${barcode}.json`, fetchImpl);
      record = offRecord(data?.product);
      if (!record || record.code !== barcode || !compatible(record, action, { exactBarcode: true })) throw missing();
    } else {
      if (!action.brand) throw missing();
      // Structured brand search is documented; never issue search-as-you-type requests.
      const url = new URL(`${OFF_ORIGIN}/api/v2/search`);
      url.searchParams.set('brands_tags', norm(action.brand).replace(/\s+/g, '-'));
      url.searchParams.set('page_size', '50');
      url.searchParams.set('fields', 'code,product_name,product_name_ru,product_name_en,brands,countries_tags');
      const data = await readJSON(url.toString(), fetchImpl);
      record = await choose((data?.products || []).map(offRecord).filter(Boolean), action, options.selectCandidate);
      const detail = await readJSON(`${OFF_ORIGIN}/api/v3.6/product/${record.code}.json`, fetchImpl);
      const current = offRecord(detail?.product);
      if (!current || current.id !== record.id || !compatible(current, action)) throw missing();
      record = current;
    }
    const { per100, unit } = offNutrients(record.product, action);
    if (finite(action.fatPercent) !== null && record.fatPercent === null && unit === 'g' && Math.abs(Number(action.fatPercent) - per100.fat) > 0.5) throw missing();
    record.unit = unit;
    return { record, per100 };
  }

  async function single(action) {
    quantity(action);
    if (action.brand || action.barcode) {
      const { record, per100 } = await getOff(action);
      return enrich(action, per100, [sourceFor(record)], 'database', options);
    }
    if ((action.unit || 'g') !== 'g') throw problem('needs_details', 'Для этого продукта справочник даёт состав на 100 г. Укажите массу или конкретную марку напитка с этикеткой на 100 мл.');
    const record = await choose(index, action, options.selectCandidate);
    const html = await readContent(record.sourceUrl, fetchImpl, {}, true);
    const per100 = matNutrients(html, record);
    if (finite(action.fatPercent) !== null && record.fatPercent === null && Math.abs(Number(action.fatPercent) - per100.fat) > 0.5) throw missing('fat_mismatch');
    return enrich(action, per100, [sourceFor(record)], 'database', options);
  }

  async function resolve(action) {
    if (!action || typeof action !== 'object') throw missing();
    if (!Array.isArray(action.ingredients) || !action.ingredients.length) return single(action);
    if (action.ingredients.length > MAX_INGREDIENTS || (action.unit || 'g') !== 'g' || finite(action.yieldGrams) === null || Number(action.yieldGrams) <= 0 || Number(action.yieldGrams) > 100000) throw problem('needs_details', 'Для рецепта укажите массу ингредиентов и вес всего готового блюда.');
    quantity(action);
    const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 }, sources = new Map(), ingredients = [];
    for (const ingredient of action.ingredients) {
      if ((ingredient.unit || 'g') !== 'g') throw problem('needs_details', 'Для расчёта рецепта укажите массу каждого ингредиента в граммах.');
      let resolved;
      try { resolved = await single({ ...ingredient, unit: 'g' }); }
      catch (error) {
        if (error instanceof NutritionError) { error.message = `${clean(ingredient.name || ingredient.query || 'Ингредиент', 80).replace(/[<>]/g, '')}: ${error.message}`; throw error; }
        throw error;
      }
      for (const key of KEYS) totals[key] += resolved[key];
      for (const source of resolved.nutrition.sources) sources.set(source.id, source);
      ingredients.push({ name: clean(ingredient.name), grams: resolved.grams, state: ingredient.state || 'unspecified', per100: resolved.nutrition.per100, sourceIds: resolved.nutrition.sources.map(s => s.id) });
    }
    const yieldGrams = Number(action.yieldGrams), per100 = checkedNutrients(Object.fromEntries(KEYS.map(k => [k, totals[k] / yieldGrams * 100])));
    if (!per100) throw problem('needs_details', 'Проверьте вес готового блюда: расчёт рецепта получился неправдоподобным.');
    return enrich(action, per100, [...sources.values()], 'recipe', options, { ingredients, yieldGrams });
  }
  return { resolve };
}

export function resolveFood(action, env, options = {}) {
  return (options.context || createNutritionContext(env, options)).resolve(action);
}
