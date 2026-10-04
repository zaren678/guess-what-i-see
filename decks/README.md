# Decks

Each deck is one JSON file in this directory. The app loads every `*.json` file
here automatically at build time (via `import.meta.glob` in `src/domain.ts`), so
adding a new deck is just: drop in a file, rebuild, done.

## Format

```json
{
  "id": "my-deck",
  "title": "My Deck",
  "blurb": "One short line shown under the title",
  "cards": [
    {
      "word": "Noah",
      "category": "Person",
      "forbiddenWords": ["ark", "flood", "animals"],
      "hint": "One kid-friendly sentence the describer may read aloud."
    }
  ]
}
```

## Fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique, lowercase, URL-safe (used in the `/deck/:deckId` route). |
| `title` | yes | Shown in the deck picker. Keep it short. |
| `blurb` | no | One short line under the title in the picker. |
| `cards[].word` | yes | The secret word the class must guess. |
| `cards[].category` | yes | Shown to the describer (e.g. `Person`, `Place`, `Thing`, `Action`, `Ordinance`). |
| `cards[].forbiddenWords` | yes | 3–5 words the describer may NOT say. Keep them kid-friendly and age-appropriate for 7-year-olds. |
| `cards[].hint` | no | One sentence the describer may read aloud if the class is stuck. Never contains a forbidden word. |

## Tips for a good deck

- Aim for 10–15 cards per deck; a 60-second round usually covers 4–8.
- Forbidden words should be the *obvious* giveaways, not obscure ones.
- Hints are a lifeline, not a giveaway: one sentence, no forbidden words inside.
- Test the deck on the `/teacher` console before class.
