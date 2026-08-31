export const DISH_TYPES = [
  'Pusryčiai',
  'Sriubos',
  'Troškiniai ir kariai',
  'Makaronai',
  'Salotos',
  'Ryžių ir kruopų patiekalai',
  'Bulvių patiekalai',
  'Sumuštiniai ir kebabai',
  'Užkandžiai',
  'Kepiniai ir picos',
  'Desertai',
  'Kita',
]

export const CUISINES = [
  'Italų',
  'Meksikiečių',
  'Indų',
  'Tailando',
  'Japonų',
  'Korėjiečių',
  'Graikų',
  'Artimųjų Rytų',
  'Lietuvių',
  'Prancūzų',
  'Ispanų',
  'Marokiečių',
  'Švedų',
  'Tarptautinė',
]

export const DISH_TAG_PREFIX = 'Tipas: '
export const CUISINE_TAG_PREFIX = 'Virtuvė: '

const includesAny = (value, words) => words.some((word) => value.includes(word))

export function classifyRecipe(title, ingredients = []) {
  const text = `${title} ${ingredients.join(' ')}`.toLocaleLowerCase('lt')

  let dishType = 'Kita'
  if (includesAny(text, ['pusry', 'aviž', 'blynel', 'blynai', 'scramble', 'shakshuka', 'košė', 'puding'])) dishType = 'Pusryčiai'
  else if (includesAny(text, ['sriub', 'ramen', 'minestrone', 'šaltibar'])) dishType = 'Sriubos'
  else if (includesAny(text, ['troškin', 'karis', 'curry', 'tagin', 'chili', 'čili'])) dishType = 'Troškiniai ir kariai'
  else if (includesAny(text, ['makaron', 'pasta', 'spage', 'lazan', 'lasagn', 'gnocchi', 'orzo'])) dishType = 'Makaronai'
  else if (includesAny(text, ['salot', 'tabbouleh', 'panzanella'])) dishType = 'Salotos'
  else if (includesAny(text, ['ryži', 'risotto', 'paella', 'polenta', 'griki', 'kuskus', 'quinoa', 'bolivin'])) dishType = 'Ryžių ir kruopų patiekalai'
  else if (includesAny(text, ['bulv', 'kugelis'])) dishType = 'Bulvių patiekalai'
  else if (includesAny(text, ['sumušt', 'kebab', 'gyros', 'burger', 'taco', 'burrito', 'wrap'])) dishType = 'Sumuštiniai ir kebabai'
  else if (includesAny(text, ['humus', 'falafel', 'užkand', 'dip', 'gyoza'])) dishType = 'Užkandžiai'
  else if (includesAny(text, ['pica', 'pizza', 'pyrag', 'quiche', 'tart'])) dishType = 'Kepiniai ir picos'
  else if (includesAny(text, ['desert', 'tort', 'sausain', 'brownie', 'ledai'])) dishType = 'Desertai'

  let cuisine = 'Tarptautinė'
  if (includesAny(text, ['pasta', 'spage', 'lazan', 'lasagn', 'risotto', 'gnocchi', 'orzo', 'panzanella', 'pesto', 'polenta', 'ceci', 'pizza', 'pica'])) cuisine = 'Italų'
  else if (includesAny(text, ['meksik', 'enchilada', 'taco', 'burrito', 'quesadilla'])) cuisine = 'Meksikiečių'
  else if (includesAny(text, ['indišk', 'tikka masala', 'dal ', 'dhal'])) cuisine = 'Indų'
  else if (includesAny(text, ['tailand', 'pad thai'])) cuisine = 'Tailando'
  else if (includesAny(text, ['japon', 'ramen', 'gyoza', 'katsu', 'sushi'])) cuisine = 'Japonų'
  else if (includesAny(text, ['korėj', 'gochujang', 'kimchi'])) cuisine = 'Korėjiečių'
  else if (includesAny(text, ['graik', 'gyros', 'tzatziki'])) cuisine = 'Graikų'
  else if (includesAny(text, ['falafel', 'humus', 'tahini', 'shakshuka', 'tabbouleh'])) cuisine = 'Artimųjų Rytų'
  else if (includesAny(text, ['lietuvi', 'kugelis', 'šaltibar', 'cepelin', 'bulviniai blynai'])) cuisine = 'Lietuvių'
  else if (includesAny(text, ['prancūz', 'bourguignon'])) cuisine = 'Prancūzų'
  else if (includesAny(text, ['ispan', 'paella'])) cuisine = 'Ispanų'
  else if (includesAny(text, ['marok', 'tagin'])) cuisine = 'Marokiečių'
  else if (includesAny(text, ['šved'])) cuisine = 'Švedų'

  return { dishType, cuisine }
}

export function classificationTags(draft) {
  const detected = classifyRecipe(draft.title, draft.ingredients)
  return [
    `${DISH_TAG_PREFIX}${draft.dishType || detected.dishType}`,
    `${CUISINE_TAG_PREFIX}${draft.cuisine || detected.cuisine}`,
  ]
}

export function recipeTagNames(recipe) {
  return (recipe.recipe_tags || []).map((link) => link.tag?.name).filter(Boolean)
}

export function dishTypeFor(recipe) {
  const tagged = recipeTagNames(recipe).find((name) => name.startsWith(DISH_TAG_PREFIX))
  return tagged?.slice(DISH_TAG_PREFIX.length) || classifyRecipe(recipe.title, recipe.recipe_ingredients.map((item) => item.item)).dishType
}

export function cuisineFor(recipe) {
  const tagged = recipeTagNames(recipe).find((name) => name.startsWith(CUISINE_TAG_PREFIX))
  return tagged?.slice(CUISINE_TAG_PREFIX.length) || classifyRecipe(recipe.title, recipe.recipe_ingredients.map((item) => item.item)).cuisine
}
