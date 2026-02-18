ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20
FROM ${BUILD_FROM}

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apk add --no-cache nodejs npm git openssh-client

WORKDIR /app
COPY rootfs/app/package.json /app/package.json
RUN npm install --omit=dev

COPY rootfs /
RUN chmod +x /entrypoint.sh

EXPOSE 8099
ENTRYPOINT ["/entrypoint.sh"]
