# Start an AutoGe operator task

Give a new agent this instruction from the repository root:

> Work on `projects/AutoGe`. Follow its `AGENTS.md` and use the committed
> `auto-ge-operator` and `auto-ge-messaging` skills. Run the daily review and
> sourcing playbook: inspect Auto.ge message history read-only, translate new
> replies, update the evaluation, source live candidate vehicles, and produce the
> action report entirely in English. Draft each seller message only in the seller's
> detected language (normally Georgian). For every proposed reply, show the
> original-language message, English translation, listing link and discussion link
> side by side. Do not send any message; wait for my approval of the exact text and
> destination.

If Chrome is logged out, the agent must stop and ask for a manual login. It must
not substitute copied cookies or credentials.

After reviewing the report, authorize messages explicitly, for example:

> Send proposals 2 and 4 exactly as written, waiting randomly between 45 and 75
> seconds. Verify each in a fresh Auto.ge conversation-history read and do not
> retry automatically.
