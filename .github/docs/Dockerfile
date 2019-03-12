FROM node:alpine

RUN apk update && \
    apk upgrade && \
    apk add --no-cache \
      git \
      openssl \
      openssh-client \
      autoconf \
      automake \
      bash \
      g++ \
      libc6-compat \
      libjpeg-turbo-dev \
      libpng-dev \
      make \
      nasm
      # We need autoconf and automake for a docusaurus dep

ADD entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
