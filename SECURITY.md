# Security

Never submit credentials or private provider data in reports. This plugin trusts the
owning agent and host/Docker administrator. It is a CLI transport, not an authorization
broker: arbitrary native Git/gh options are available. Git hooks are executable code.
Credentials are stored in a private Docker volume, never copied from the host.
Report security concerns privately to the repository maintainer.
