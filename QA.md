# Release assessment — 2026-09-09

Candidate: 6664f26. Not yet approved for publication.

Five tests passed in source and extracted npm archive: literal argument transport,
ambient GitHub-token removal, native failure propagation, invalid executable
rejection and cancellation. Runtime images built from source and extracted archive.
Independent review by Codex agent /root/review checked this commit and reproduced
cancellation with a native child ignoring TERM; no remaining source-level findings.

Ez catalog contains the candidate at revision
sha256:aa6ce6cb831b87368f859a1800c00b0e8a047c4e0088abd76b5cea2a5ff8f08e.
PA installation/replacement preserved OAuth identity and HTTPS Git credential helper.
Container /state and /repos were owned by UID 1000 with mode 0700. Synthetic
container check found no relay or ambient GitHub token environment.

Artifact SHA-256:
c2e8f0bbeb9e409bac9889ec8e2edb166f4713b749a4acf568d3db856f0b8947

Release blocker: actual PA launcher cancellation returned exit 130 while the native
command container continued running. Reproduction: start `ez github git -c
'alias.wait=!echo cancellation-ready; sleep 30' wait`, terminate the launched Ez
process on the ready marker, then inspect running github-call containers. The call
container remained. Source wrapper cancellation passes; the launcher/manager path
needs investigation and a regression fix before release. The bounded test container
and an old OAuth login container were stopped; profile/repository volumes retained.

Still pending: manager cancellation acceptance, clean-host QA, authenticated push
and remote SHA readback in this audit, remote repository/PR/CI and final publication
metadata. The local repository has no remote. package.json remains private to prevent
accidental npm publication. No tag, npm package or public repository was published.
