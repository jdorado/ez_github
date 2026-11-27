# ez-github

Thin native GitHub CLI and Git plugin for Ez. Private per-agent profile and writable
repository volume; no provider API implementation or workflow engine.

Requires Node 22+, Docker/Compose and Ez with the cancellation fix (manager release
0.1.0-beta.60 or newer). Obtain `@jc_stack/ez-github@0.1.0-beta.10` with
`npm pack @jc_stack/ez-github@0.1.0-beta.10 --ignore-scripts`, extract into a permanent
private tools directory, and inspect the extracted package.

Inspect this directory with `ez plugins inspect github --source /absolute/package`,
then install with the inspected source and revision and run `ez plugins start github`.
Read skills/github/SKILL.md for complete agent-owned OAuth setup and verification.

`ez github gh --help` and `ez github git --help` expose upstream tools unchanged.
`ez github doctor` verifies authentication with a nonzero exit when unavailable.
Native GitHub JSON is available with `gh api` and supported `gh --json` options.

Credentials persist in /state; repositories persist in /repos. The PA workspace is
read-only. A local clone transfers committed history, not uncommitted/untracked files.
HTTPS Git uses `gh auth setup-git`. No manual token or GitHub App registration needed.
OAuth permissions are broad within the connected user's existing GitHub authority;
use a dedicated account when separation is wanted. Container tokens are private files,
not encrypted by a keyring. No unattended identity creation or token display.

Uninstall preserves data. Revocation is separate in GitHub's authorized applications.
Rollback retains volumes; do not run concurrent writers on one repository. Test with
`pnpm run verify`, `pnpm run release:check`, Docker build and manager dispatch. Live GitHub verification needs consent.

Testing beta: Debian supplies Git and the signed upstream GitHub CLI repository
supplies gh at image build; the installed image
is retained by Ez's source revision. Capture `gh --version` and `git --version` during QA.
Fresh isolated Docker installation and PA authentication are tested; a separate
machine/reboot and a fresh OAuth consent in that environment remain stable-release QA.

Requires Ez core 0.1.0-beta.60 or newer for the manifest example.
Older cores refuse the update and retain the installed version.

## Bounded repository clones

Agents clone into `/repos`; nothing used to remove those clones, so full clones of a large
data repository (2.3 GiB each) accumulated to 91 GiB. The plugin now bounds the volume itself:

- `ez github repos clone OWNER/REPO [NAME] [--path DIR]... [--branch BRANCH]` clones with
  `--filter=blob:none --sparse`, materialising only the root files and the `--path`
  directories. Measured on a 2.3 GiB repository: 17 MiB root only, 18 MiB after an add-only
  research commit, 23 MiB with a 3 MiB directory checked out. Add new files outside the
  checkout with `git add --sparse FILE`. Plain `git clone` remains for work that needs the whole tree.
- `ez github repos reclaim [--idle-hours N]` removes clones that are idle (default 24 hours),
  have no uncommitted, untracked or ignored files (caches such as `__pycache__`, `.pytest_cache`,
  `node_modules` and `.venv` excepted), no stash, no submodules or embedded repositories, and have every
  local branch commit (and HEAD) reachable from a remote-tracking ref. The remote is not asked
  again, so a branch deleted there after its push (the usual end of a merged research branch)
  still counts as pushed; tags are not considered. Uncertain clones are kept, and each clone is
  inspected again right before removal. `ez github repos list` shows the same decision per
  clone without removing.
- Every `git clone` and `gh repo clone` through the plugin reclaims first, then refuses while
  `/repos` is over its budget (default 16 GiB; set `EZ_GITHUB_REPOS_BUDGET_GIB` in the
  service environment to change it). This is a bound, not a security boundary.

## Publish files as a pull request

`ez github repos publish OWNER/REPO --branch B --title T [--base BASE] < bundle.json`
takes the files as a JSON bundle on stdin (`{"files":[{"path":"docs/a.md","content":"text"}],"body":"optional pull request text"}`, with
`"encoding":"base64"` for binary), so no host path is needed. It creates the branch from the base
(default: the repository's default branch) or writes onto it, one contents-API commit per changed file,
reads every stored file back and compares its bytes, then opens the pull request or reuses the open
one for the branch, and prints `url`, `number`, `created`, `branch`, `base` and each file's `path` and blob `sha`.
A write that conflicts with a changed branch, or a readback that differs, exits 1; nothing is retried,
merged or resolved. Files over 1 MB cannot be read back.

## Kanban

`ez kanban` gives agents basic task-board operations: `board`, `list`, `show`,
`add`, `move`, `set` and `comment`, with JSON output and a readback after every
write. The verbs are tracker-neutral; this adapter stores the board in a GitHub
Project through the private profile, so another tracker can later provide the
same commands. It holds no workflow rules. Example:
`ez kanban list --board OWNER/NUMBER --column Ready`. The login needs the
`project` scope. See skills/kanban/SKILL.md.

## Read-only work queue preflight

`ez github-work --project PROJECT_NODE_ID --field Role=CIO --field Status=Ready --require-metadata` reads the complete Project through the private GitHub profile, returning only eligibility, IDs and a stable fingerprint. Field names/values are caller supplied; this adapter contains no role, model or workflow routing. `ez-work` JSON on an issue records `schemaVersion:1`, `identity`, optional `notBefore` and `freshUntil`; requiring metadata also requires a valid unexpired freshness clock. Missing provider/schema coverage is an error, never empty work. A malformed, ambiguous or over-long (200+ characters) `ez-work` block on any open item blocks the whole queue (the check errors, fail closed) by design; fix or remove the block to unblock it. Filter fields must be single-select or text, and an unreadable value for a filtered field is an error. This command makes no task writes and starts no agent. Core's installed plugin preflight calls it before creating an LLM run. When Ez core (the release after 0.79.0) sets `EZ_PREFLIGHT_SINCE` to the start of a scheduler tick, the tick's checks on the same Project share one complete read made at or after that instant (kept as `work-snapshots/PROJECT.json` in the private profile volume, at most two minutes); a later tick, a manual trigger or a direct call always reads again, and `observedAt` is the time of the read. Existing native `github`/Git commands are unchanged. Managed snippet: unnecessary; installed help/skill owns discovery.

For coordination, `github-work --project PROJECT_NODE_ID --observe-all` fingerprints complete Project state, including waiting, closed and archived items. It ignores queue clocks/metadata and permits a changed-state check even for an empty Project. Use it with native changed-mode admission; keep role queue selection on the filtered path.
