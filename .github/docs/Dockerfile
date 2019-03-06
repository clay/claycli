FROM node:alpine

RUN apk update && \
    apk upgrade && \
    apk add \
      git \
      openssl \
      openssh-client \
      autoconf \
      automake
      # We need autoconf and automake for a docusaurus dep

ADD entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
