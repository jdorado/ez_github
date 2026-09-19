# Releasing

Use an isolated worktree and focused PR. Update package/manifest versions together,
refresh package-lock.json and CHANGELOG.md, and never replace a published version.
Run npm run verify, npm run release:check, npm audit --omit=dev, git diff --check and npm pack --ignore-scripts.
Inspect both Git history and archive for credentials and private records. Test the
extracted archive and build its Docker runtime, then install through a fresh Ez
registry with isolated volumes. Verify no inherited credentials, native arguments,
cancellation, restart persistence and data-preserving removal.

Verify an authorized repository creation, Git push and matching remote SHA using
the intended agent connection. Never copy credentials into test profiles. A fresh
isolated Docker installation is not a separate-host/reboot OAuth test; record that
limitation for this testing beta and require it before stable publication.

Obtain independent review and green CI for the final PR. Confirm maintainer release
authorization, merge, and check the merged tree matches the tested source. Verify
npm whoami returns jc_stack. Publish the exact reviewed archive with
`npm publish /absolute/candidate.tgz --access public --tag latest` after confirming
the required Ez manager release exists. Complete normal npm 2FA when requested.
Tag the merged commit and create a GitHub prerelease with the archive and SHA-256.
Read back package version/dist-tags, download the registry archive, compare its
checksum, and verify installation. Latest is the default distribution tag; the version remains a prerelease.

Keep profiles during upgrades and rollback; account revocation is separate.

Approved beta publication updates latest automatically through the shared OIDC
publisher. No second tag write or local login is needed for enrolled packages.
The legacy beta tag is not advanced. Versions/GitHub releases remain prereleases;
stable-only deployment policies remain unchanged. Older Ez updaters need an
exact-version core update containing latest-aware discovery. This policy change
does not republish existing versions; prepare a new version for changed metadata.
