# ez-github

Thin native GitHub CLI and Git plugin for Ez. Private per-agent profile and writable
repository volume; no provider API implementation or workflow engine.

Requires Node 22+, Docker/Compose and Ez with the cancellation fix (manager release
0.1.0-beta.13 or newer). Obtain `@jc_stack/ez-github@0.1.0-beta.3` with
`npm pack @jc_stack/ez-github@0.1.0-beta.3 --ignore-scripts`, extract into a permanent
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
`npm run verify`, `npm run release:check`, Docker build and manager dispatch. Live GitHub verification needs consent.

Testing beta: Debian supplies Git/gh updates at image build; the installed image
is retained by Ez's source revision. Capture `gh --version` and `git --version` during QA.
Fresh isolated Docker installation and PA authentication are tested; a separate
machine/reboot and a fresh OAuth consent in that environment remain stable-release QA.
