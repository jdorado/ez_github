# Changelog

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
