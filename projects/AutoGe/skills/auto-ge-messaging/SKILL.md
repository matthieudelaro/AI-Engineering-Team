---
name: auto-ge-messaging
description: Read Auto.ge message history and send a single verified reply through an authenticated Chrome session with Playwright. Use for auto.ge conversation discovery, loading seller messages, replying in my-messages.html, confirming delivery, and preventing duplicate seller contacts.
---

# Auto.ge Messaging

Use Chrome browser control and its Playwright API. Keep authentication inside the
browser; never inspect, copy, log, or export cookies or browser storage.

## Authentication and Playwright-first operation

Use the browser connection only to attach to the user's persistent Chrome session.
Perform normal navigation, DOM inspection, form filling and clicks through the
attached tab's Playwright API. Use visual or coordinate control only to discover a
selector or recover when the Playwright surface cannot expose the required state.

To check authentication, open `https://www.auto.ge/en/my-messages.html`, wait for
`domcontentloaded`, and take a fresh DOM snapshot. An authenticated page contains
the conversation table; a logged-out page contains the labelled `Email` and
`Password` textboxes and `Sign in` button. When logged out:

1. leave the sign-in page open for the user to complete manually in Chrome;
2. never read the fields' values or inspect password-manager, cookie, storage or
   session state;
3. after the user reports completion, claim the same visible Chrome tab and take
   a fresh snapshot;
4. continue only when the conversation table is visible; if the sign-in form is
   still visible, record authentication as blocked and request another manual
   login later.

This procedure records selectors and verification state only. It intentionally
does not make unattended login possible without an approved secret-management
mechanism.

## Read conversations

1. Open `https://www.auto.ge/en/my-messages.html`.
2. Wait for `domcontentloaded` and take a fresh DOM snapshot.
3. Extract conversation URLs matching `my-messages.html?id=<conversation_id>`.
4. Open the selected conversation URL and take another fresh snapshot.
5. Treat the message list in this page as the authoritative delivery history.
6. Preserve message text, displayed time, referenced listing URL, direction when
   determinable, and conversation ID in sanitized events. Do not retain account
   credentials or unrelated user information.

## Reply once

Require explicit user approval for the exact message and destination conversation.
Reject empty messages and messages longer than 250 Unicode characters.

```js
const message = "<approved message>";
const conversationUrl =
  "https://www.auto.ge/en/my-messages.html?id=<conversation_id>";

await tab.goto(conversationUrl);
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

Click `Send` exactly once. After the click, immediately consider delivery unknown
until verified. Never infer failure from an unchanged textarea, a stale snapshot,
the button remaining focused, or Auto.ge's generic system-error banner.

## Verify without resending

1. Do not click the send control again.
2. Open the same conversation URL in a fresh verification tab, or reload a
   read-only verification tab.
3. Take a new DOM snapshot and count exact occurrences of the approved message.
4. Confirm delivery only when the history count increased by exactly one.
5. If the count did not increase, wait briefly and perform at most one more fresh
   history read. If still absent, record `delivery_unknown` and require human
   inspection. Never retry from the send form automatically.
6. If the count increased by more than one, record a duplicate-delivery incident
   and stop all outbound messaging.

For an initial listing contact, apply the same verification rule by discovering
the resulting conversation from `/en/my-messages.html` after the single click.

## Safety invariants

- Treat conversation history, not the listing-page toast, as delivery truth.
- Never send while loading or auditing messages.
- Never retry a timed-out or apparently failed submission automatically.
- Never send to a different conversation or channel without separate approval.
- Pause on login expiry or CAPTCHA; require human intervention.
- Archive sanitized observations and corrections as append-only events.
