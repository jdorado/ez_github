FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS runtime
RUN mkdir /state && chown node:node /state && chmod 700 /state
COPY --chown=node:node bin /app/bin
USER node
WORKDIR /app
CMD ["sleep", "infinity"]
