# Site Translation Profiles

`site-profiles.js` is the extension point for non-X websites.

Each profile is declarative:

```js
{
  id: "github",
  label: "GitHub",
  hostPattern: "(^|\\.)github\\.com$",
  promptProfile: "github",
  minLength: 18,
  maxLength: 1200,
  selectors: [
    ".markdown-body p",
    ".markdown-body li"
  ]
}
```

## Fields

- `id`: Stable profile id.
- `label`: Human-readable site name for debugging and future UI.
- `hostPattern`: Regular expression string matched against `location.hostname`.
- `promptProfile`: Translation prompt style used by `service-worker.js`.
  - `github`: technical translation, preserves Markdown, code, paths, API names.
  - `web`: common webpage translation for articles, docs, blogs, product pages.
- `minLength`: Ignore short UI fragments below this length.
- `maxLength`: Ignore very large nodes and let smaller child nodes translate instead.
- `selectors`: Main content selectors. Keep these targeted to avoid translating nav bars, sidebars, code, and forms.

## Adding A Site

1. Add a new profile before the fallback `web` profile.
2. Keep selectors close to readable content areas.
3. Prefer paragraphs, list items, and headings over huge containers.
4. If the site needs a new translation tone, add a new `promptProfile` in `service-worker.js`.
5. Reload the extension and test one content page plus one dense page.

## Guardrails

The scanner already skips code blocks, forms, buttons, inputs, media, hidden content, and existing translation blocks. Site profiles should still avoid broad selectors like `body *` or `.container *`, because they create noisy translation and unnecessary API calls.
