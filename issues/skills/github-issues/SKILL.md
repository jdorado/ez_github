---
name: github-issues-stocks
description: Report confirmed Stocks app or plugin source defects as GitHub issues for owner review.
---

Use the bound `ez github-issues --help`. This plugin is for `jdorado/stocks` (app, backend, data structures) and `jdorado/ezstocks-plugin` (agent-facing plugin) only. Keep workspace research and process records in the operating data repo; source defects go to the owning code repo.

Before creating, run `list --repo REPO` and inspect possible duplicates with `view`. State the observed behavior, expected behavior, evidence/source date, impact, and a reproducible path if known. Do not include account data, credentials, private strategy details, or a proposed code fix without evidence. Write the body in the agent workspace. Then call `create --repo REPO --title TITLE --body-file PATH`. A returned `verified: true` and URL are the GitHub readback. If the call is interrupted or uncertain, list issues and inspect the candidate before retrying.

After a new verified issue, send the owner one concise native Ez message with the issue link and why it matters; check the Ez delivery receipt. Do not code, push, merge, deploy, enable a schedule, or treat the issue as approval. Keep unchanged monitoring quiet. `auth set` is owner onboarding: it reads a fine-grained GitHub token from stdin and stores it in the plugin's private profile. Never request the token in chat or write it to the workspace. Doctor proves read access only; the first real authorized issue proves write access.
