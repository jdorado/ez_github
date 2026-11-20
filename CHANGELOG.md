# Changelog

## 0.1.0-beta.8

- Bound the repositories volume. `ez github repos clone OWNER/REPO [NAME] [--path DIR]...` makes a partial, sparse clone (history without file contents, working tree of the root files plus the listed directories): a 2.3 GiB data repository clones in about 17 MiB, and a research commit adds about 1 MiB. `repos list` shows each clone's size and whether it is reclaimable; `repos reclaim` removes clones that are idle (default 24 hours), have no uncommitted, untracked or ignored files, no stash or submodules, and have every local branch commit on a remote-tracking ref; it inspects each clone again right before removal and keeps everything else or uncertain.
- Every `git clone` and `gh repo clone` through this plugin first reclaims, then fails loudly when `/repos` is over its budget (default 16 GiB, `EZ_GITHUB_REPOS_BUDGET_GIB`). Other git and gh commands, arguments and exit codes are unchanged. Fixes clones accumulating forever (91 GiB of full clones on one agent).

## 0.1.0-beta.7

- Run the runtime image on the October 2026 Node 22 security release (`node:22.23.4-bookworm-slim`, digest pinned); no CLI behavior changes.

## 0.1.0-beta.6

- Validate kanban fields and values before writing, compare numeric readback as numbers, and confirm newly created comments through provider readback.
- Add `kanban`: basic task-board commands for any agent (`board`, `list`, `show`, `add`, `move`, `set`, `comment`) over a GitHub Project, with JSON output and readback after each write. Tracker-neutral verbs; no workflow rules. Declared `requiresReview: false` because it only changes the team's own task board.

## 0.1.0-beta.5

- Requires Ez core 0.1.0-beta.50 or newer for the manifest example.
  Older cores refuse the update and retain the installed version.
- Add representative manifest examples for tool discovery; align the private issue adapter on beta.2.

- Add the read-only `github-work` command: a Project work eligibility check for core's owner-configured schedule preflight. It reads the complete Project through the private profile with caller-supplied field filters and optional `ez-work` metadata, returns only eligibility, IDs and a stable fingerprint, and makes no task writes or agent dispatch; `--observe-all` fingerprints complete Project state for changed-mode admission. Existing `github`/Git commands are unchanged.
- Work-check fails closed (error, exit 1) for filter fields that are not single-select/text, unreadable filtered values and over-long task identities; verify now syntax-checks `bin/work-check.mjs`.
- Preserve runtime CLI access when Ez snapshots package files with private modes by assigning the copied command to the non-root container user.
- Install GitHub CLI from its signed upstream package repository so current commands such as Projects are available.

## 0.1.0-beta.4

- Add the required Ez release contract so the native updater can admit the package.
- Publish a corrective beta after the malformed beta.3 package.

## 0.1.0-beta.3

- Align the executable, README, package and plugin manifest on the new prerelease version.
- Add the standard verify and release package-boundary checks; Git/gh transport remains unchanged.

## 0.1.0-beta.2

- Adopt latest-tag publication and the corrected shared publisher main-CI selection. Git/gh transport remains unchanged.
- Testing beta; previously documented live-provider and fresh-host acceptance limits remain.

## 0.1.0-beta.1

Initial Git/gh transport with private profile, writable repository volume,
native OAuth onboarding and read-only workspace access. Includes signal forwarding
and installable Docker/manifests. Requires Ez manager 0.1.0-beta.13 or newer.
Testing beta; separate-machine/reboot OAuth acceptance remains deferred.
