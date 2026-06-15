# PageLingo Privacy

PageLingo runs in the browser and does not operate its own server.

## What the extension reads

- Visible page text that matches the translation rules.
- X / Twitter tweet text when translation or AI reply is used.
- Provider settings, target language, custom personas, and API keys saved in the extension settings.

## Where data is sent

- Default translation uses Google Translate.
- If you choose an LLM provider, selected page text or tweet text is sent to that provider.
- AI reply generation sends the tweet text, selected persona, tone, and optional instruction to the selected provider.

PageLingo does not sell, share, or separately collect this data.

## API keys

API keys are stored in `chrome.storage.sync`. Browser sync may copy them to other browsers logged into the same browser account.

Use keys with spending limits. Do not publish a filled `secrets.js`.

## Permissions

The extension requests broad page access so it can translate common websites. Browser permission warnings are expected.

Disable the extension or turn off translation when using pages whose text should not be sent to translation providers.
