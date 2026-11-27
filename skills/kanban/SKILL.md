---
name: kanban
description: Manage team tasks on a kanban board — list, add, move, update and comment on cards.
---

`ez kanban` is a basic kanban board for agents: columns, cards and a few
fields. Use it to see what work exists, pick up a card, record progress and
hand work on. Run `ez kanban --help` for the exact arguments.

```sh
ez kanban board --board OWNER/NUMBER            # columns and fields
ez kanban list --board OWNER/NUMBER --column Ready
ez kanban show --board OWNER/NUMBER OWNER/REPO#12
ez kanban add --board OWNER/NUMBER --repo OWNER/REPO --title "…" --body-file /abs/brief.md --column Backlog --set "Due date=2026-10-20"
ez kanban move --board OWNER/NUMBER OWNER/REPO#12 "In Progress"
ez kanban set --board OWNER/NUMBER OWNER/REPO#12 "Due date=2026-10-21" Role=CIO
ez kanban comment --board OWNER/NUMBER OWNER/REPO#12 --body "Done: PR #40 merged"
ez kanban claim --board OWNER/NUMBER OWNER/REPO#12 --by "worker, model, run" --from Ready --to "In Progress"
```

The board is the shared task list; the workspace's own instructions say which
board, which columns and what each field means. The tool keeps no workflow
rules: deciding when a card is ready, who takes it and when it is done is the
agents' judgment. Every write reads the card back and prints it, so the output
is the confirmation. If a write fails or is interrupted, `list` or `show` the
card before trying again; `add` has no idempotency key, so look for the card
before re-adding it.

`claim` is how a worker takes a card when others may be looking at the same one.
Read the card, then run `claim` once: it posts a claim comment (naming `--by`), reads
the claims made since the card last changed and moves the card only if yours is the
earliest (lowest comment id). It prints `"claimed": true` with the card, or exits 3
with `"claimed": false` (`lost`, with the winning comment, or `not-in-column` when the
card already moved): leave that card alone and take another. Do not post your own claim
comment or `move` the card first; the claim is the comment `claim` writes, and a claim
that did not win needs no undoing. One claim costs one Project read, one field write and
one readback, less than reading, moving and commenting by hand.

This adapter keeps the board in a GitHub Project through the plugin's private
GitHub login (see the github skill for setup). The login needs Project access;
if `board` reports the board as not readable, run
`ez github gh auth refresh --hostname github.com --scopes project` with the
owner. Cards are issues, pull requests or drafts; comments go on the issue.
