FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends git gh ca-certificates && rm -rf /var/lib/apt/lists/*
RUN mkdir /state /repos && chown node:node /state /repos && chmod 700 /state /repos
ENV GH_CONFIG_DIR=/state/gh XDG_CONFIG_HOME=/state/config GIT_CONFIG_GLOBAL=/state/gitconfig GH_PROMPT_DISABLED=1
COPY bin /app/bin
USER node
WORKDIR /repos
CMD ["sleep", "infinity"]
