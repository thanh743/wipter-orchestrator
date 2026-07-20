FROM alpine:3.20

RUN apk add --no-cache bash bind-tools curl ip6tables iptables python3 redsocks su-exec

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
