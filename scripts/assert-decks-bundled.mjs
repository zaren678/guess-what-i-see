// Post-build guard: fail the build loudly if the deck JSON never made it
// into the bundle (e.g. an untransformed import.meta.glob, which degrades
// to an empty deck picker instead of an error). Runs automatically as
// `postbuild` after `npm run build`, locally and on Vercel.
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const root = process.cwd();
const assetsDir = join(root, 'dist', 'assets');
const decksDir = join(root, 'decks');

function fail(message) {
  console.error(`assert-decks-bundled: ${message}`);
  process.exit(1);
}

let bundle;
try {
  const files = readdirSync(assetsDir).filter(f => f.endsWith('.js'));
  if (files.length === 0) fail('no JS output in dist/assets');
  bundle = files.map(f => readFileSync(join(assetsDir, f), 'utf8')).join('\n');
} catch {
  fail('cannot read dist/assets -- did vite build succeed?');
}

if (bundle.includes('import.meta.glob')) {
  fail('untransformed import.meta.glob in bundle; decks are missing');
}

let deckFiles;
try {
  deckFiles = readdirSync(decksDir).filter(f => f.endsWith('.json'));
} catch {
  fail('cannot read decks/');
}
if (deckFiles.length === 0) fail('no deck JSON files found');

for (const file of deckFiles) {
  let deck;
  try {
    deck = JSON.parse(readFileSync(join(decksDir, file), 'utf8'));
  } catch {
    fail(`${file} is not valid JSON`);
  }
  if (!deck?.id || !Array.isArray(deck.cards) || deck.cards.length === 0) {
    fail(`${file} has no usable cards`);
  }
  for (const sentinel of [deck.id, deck.cards[0].word]) {
    if (typeof sentinel !== 'string' || !bundle.includes(sentinel)) {
      fail(`deck "${deck.id}" (${file}) missing from bundle`);
    }
  }
}

console.log(
  `assert-decks-bundled: ${deckFiles.length} deck(s) present in bundle.`,
);
