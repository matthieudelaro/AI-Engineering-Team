# 001 - Auto.ge messaging with Playwright

**Cadence:** On demand only.

Load Auto.ge conversations or send one approved message through the authenticated
Chrome session. The conversation history is authoritative; listing-page errors and
the post-click form state are not reliable delivery signals.

## Preconditions

- The user has approved the exact message and conversation or listing.
- Chrome is authenticated on `https://www.auto.ge/en/`.
- The message is non-empty and no longer than 250 Unicode characters.
- No earlier send for the same action is pending or marked `delivery_unknown`.

## Load message history

1. Open `https://www.auto.ge/en/my-messages.html` with the Chrome browser skill.
2. Wait for `domcontentloaded` and capture a fresh Playwright DOM snapshot.
3. Collect conversation links matching `my-messages.html?id=<id>`.
4. Open each required conversation and archive the visible listing reference,
   message text, displayed time and conversation ID.
5. Do not send anything during a history-loading run.

## Send one conversation reply

```js
await tab.goto("https://www.auto.ge/en/my-messages.html?id=<conversation_id>");
await tab.playwright.waitForLoadState({
  state: "domcontentloaded",
  timeoutMs: 20_000,
});

const before = await tab.playwright.domSnapshot();

await tab.playwright.locator("textarea").first().fill(message, {
  timeoutMs: 10_000,
});

await tab.playwright
  .locator('input[type="button"][value="Send"]')
  .click({ timeoutMs: 10_000 });
```

The click is the single transmission attempt. Do not click again, even when:

- the textarea keeps its contents;
- `Send` remains focused;
- the current DOM snapshot does not change;
- Auto.ge displays its generic system-error banner.

## Confirm delivery

1. Open the conversation URL in a fresh verification tab. Do not reuse the
   potentially stale post-click DOM as evidence.
2. Capture a fresh snapshot and count exact occurrences of `message`.
3. Mark `sent` only when the history count increased by one.
4. If it is absent, wait briefly and perform one final fresh history read.
5. If it remains absent, mark `delivery_unknown`, stop and request human review.
6. If the count increased by more than one, record a duplicate incident and stop
   all outbound messaging.

## Observed Auto.ge behavior

On 2026-08-06, messages appeared in conversation history even though the sending
page retained the text or displayed a generic system error. Re-clicking based on
that stale state created a duplicate. Never use the sending form itself as the
delivery authority.

## Done when

- A read-only run returns the requested conversation history; or
- a send run has exactly one confirmed new history entry; or
- the run stops safely as `delivery_unknown` without a retry.
