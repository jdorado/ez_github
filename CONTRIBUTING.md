# Contributing

Use one isolated worktree and branch per change. Preserve unrelated state.
Run npm test and git diff --check. Package with npm pack --ignore-scripts;
test and build the extracted package and verify Ez manager installation.
Credentials, argument transport and cancellation changes require negative tests.
Never put provider credentials or private records in tests or PRs.
Independent review, CI and maintainer authorization precede merge/publication.
Keep the worktree while review or QA is open. Publication is a separate decision.
