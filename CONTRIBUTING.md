# Contributing

Use one isolated worktree and branch per change. Preserve unrelated state.
Run npm run verify, npm run release:check, npm audit --omit=dev and git diff --check. Package with npm pack --ignore-scripts;
test and build the extracted package and verify Ez manager installation.
Credentials, argument transport and cancellation changes require negative tests.
Never put provider credentials or private records in tests or PRs.
Independent review, CI and maintainer authorization precede merge/publication.
Keep the worktree while review or QA is open. Publication is a separate decision.

## Shared beta publisher

`.github/workflows/publish-beta.yml` is a generated caller of the reviewed,
SHA-pinned shared publisher in `jdorado/ez-agents`. Keep the reusable workflow
reference and `publisher-sha` on the same full commit; regenerate through a
reviewed PR when upgrading. Required checks are `test` from
`.github/workflows/ci.yml`, successful on the exact source commit's push to
`main`. Review the check list whenever CI policy changes.

Follow the [shared publishing procedure](https://github.com/jdorado/ez-agents/blob/main/docs/trusted-publishing.md)
for caller regeneration, receipt fields, dispatch and failure reconciliation.
Complete this repository's contribution checks, packed installation QA and
independent review before release. Stage the exact tested tarball as
`candidate.tgz` with `release-receipt.json` on a draft prerelease `vVERSION`,
whose tag resolves to the tested current `main` commit. The receipt binds
`jdorado/ez_github`, `@jc_stack/ez-github`, version, full source SHA,
SHA-256 and public independent-review/test evidence URLs. Dispatch the caller
on `main` with the numeric draft release ID, version, source SHA and independently
verified SHA-256. Actions validates and publishes those bytes without rebuilding.
Only `X.Y.Z-beta.N` versions published to the `latest` dist-tag are supported.

The npm package owner must separately authenticate and enroll `jdorado/ez_github`
and caller filename `publish-beta.yml`, with direct publication enabled and no
environment (the shared job currently declares none). npm validates the caller
identity for reusable workflows. Verify enrollment with npm settings or
`npm trust list @jc_stack/ez-github`; workflow merge does not establish trust.
Keep npm tokens and private profiles out of Actions and test containers.

Preserve Actions registry readback and artifact hash on the release record,
then finish and read back the public GitHub prerelease and required installation
QA. After uncertain publication, inspect registry state before retrying. Never
publish to probe authentication or overwrite a version.

Initial beta.1 bootstrap is complete. Verify current registry version, trust and
release readback before preparing a new version; never replace that artifact.
