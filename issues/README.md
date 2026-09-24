# Stocks GitHub issues

Private Ez plugin for the running Stocks agent. It can list, read, and create issues only in `jdorado/stocks` and `jdorado/ezstocks-plugin`. It has no command to edit source, push, open pull requests, close issues, or alter repository settings. The token's GitHub permissions must also be limited to these two repositories with Issues read/write and Metadata read. The source is a subpackage of `jdorado/ez_github`; it is not published to npm.

Install from a reviewed source revision using the Ez plugin manager, then run `ez github-issues --help` and `ez github-issues doctor` through the Stocks agent's bound launcher. The plugin keeps its token in its private `/state` volume; never put it in the agent workspace, Git, command arguments, or messages. The owner supplies the fine-grained token on standard input to `ez github-issues auth set`. This verifies read access, then stores it with file mode 0600. Doctor verifies current read access, not issue-write permission. The first authorized real issue and its readback prove write access.

Example read: `ez github-issues list --repo jdorado/stocks`. For creation, the agent writes an issue body within its own workspace and calls `ez github-issues create --repo jdorado/stocks --title 'Observed defect' --body-file /opt/stocks/ez-agent/mind/issue.md`. The command reads back the new issue and returns its URL. If a create call is interrupted, list issues before retrying; GitHub issue creation has no idempotency key.

This plugin does not notify the owner. After readback, the agent uses the existing native Ez owner channel and checks its delivery receipt. No source or deployment action is implied by an issue.
