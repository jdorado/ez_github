FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates wget \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && wget -qO /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*
RUN mkdir /state /repos && chown node:node /state /repos && chmod 700 /state /repos
ENV GH_CONFIG_DIR=/state/gh XDG_CONFIG_HOME=/state/config GIT_CONFIG_GLOBAL=/state/gitconfig GH_PROMPT_DISABLED=1
COPY --chown=node:node bin /app/bin
USER node
WORKDIR /repos
CMD ["sleep", "infinity"]
