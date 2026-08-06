# PERMISSIONS.md

The policy layer: who may do what, with which tool. **Deny-by-default** —
anything not listed here stays read-only. A capability is real only when it is
granted here **and** permitted by the active runner's native enforcement: the
Claude agent allow-list or the Codex approval/sandbox configuration. Both layers
must agree; the stricter wins. **DELETE is never granted.**

## Action tiers
| Tier | Means |
|---|---|
| READ | view, search, fetch |
| ANNOTATE | add or edit comments / notes |
| EDIT | change existing items |
| CREATE | make new items |
| TRANSITION | change state (complete, archive, move) |
| DELETE | remove permanently — never granted |

## Grants
| Role | Surface | Granted |
|---|---|---|
| Architect | this repo's files | READ, EDIT, CREATE |
| Backend | this repo's files | READ, EDIT, CREATE |
| Frontend | this repo's files | READ, EDIT, CREATE |
| Security | this repo's files | READ, EDIT, CREATE |
| QA | everything | READ only |
| Engineering roles | external connectors (e.g. GitHub) | READ |
| Architect | auto.ge seller messaging | CREATE — limited to exact messages and destinations explicitly approved by the user in the active task; no autonomous retries or channel changes |

Anything not listed stays READ-only. Connectors start read-only; grant a scoped
write both here and in the active runner's native enforcement, deliberately, when
you need it.
