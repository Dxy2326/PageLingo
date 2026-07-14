# PageLingo Privacy

PageLingo runs in the browser and does not operate its own server.

Translation is disabled on new installations. When enabled, PageLingo only processes websites in the user's allowlist. X / Twitter and GitHub are included in the initial allowlist; other sites must be added from the extension popup.

## What the extension reads

- Visible page text that matches the translation rules.
- X / Twitter tweet text when translation or AI reply is used.
- Provider settings, target language, custom personas, and API keys saved in the extension settings.

## Where data is sent

- Default translation uses Google Translate.
- If you choose an LLM provider, selected page text or tweet text is sent to that provider.
- AI reply generation sends the tweet text, selected persona, tone, and optional instruction to the selected provider.

PageLingo does not automatically fall back from an LLM provider to Google. A failed provider request stops with an error.

PageLingo does not sell, share, or separately collect this data.

## API keys

API keys are stored in `chrome.storage.local` and are not copied through browser sync. Remote provider URLs must use HTTPS; HTTP is only accepted for localhost development.

Use keys with spending limits. Do not publish a filled `secrets.js`.

## Permissions

The extension requests broad page access so it can translate common websites. Browser permission warnings are expected.

Remove a site from the allowlist, turn off translation, or disable the extension when its text should not be sent to a translation provider. Translation results are cached only in service-worker memory and are not persisted across browser restarts.
