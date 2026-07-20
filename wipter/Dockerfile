FROM debian:bookworm-slim

ARG WIPTER_TARBALL_URL=https://provider-assets.wipter.com/latest/linux/x64/wipter-app-x64.tar.gz

ENV DISPLAY=:99 \
    DEBIAN_FRONTEND=noninteractive \
    WIPTER_HOME=/opt/wipter

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl dbus-x11 fonts-liberation libasound2 libatk-bridge2.0-0 \
    libatk1.0-0 libcairo2 libcups2 libdrm2 libgbm1 libgtk-3-0 libnss3 \
    iproute2 libpango-1.0-0 libx11-xcb1 libxcb-dri3-0 libxcomposite1 libxdamage1 \
    libxfixes3 libxkbcommon0 libxrandr2 openbox procps unzip x11vnc xauth \
    xdotool xvfb \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/wipter /tmp/wipter-download \
  && curl -fL "${WIPTER_TARBALL_URL}" -o /tmp/wipter-download/wipter.tar.gz \
  && tar -xzf /tmp/wipter-download/wipter.tar.gz -C /tmp/wipter-download \
  && mv /tmp/wipter-download/wipter-app-*/* /opt/wipter/ \
  && chmod +x /opt/wipter/wipter-app /opt/wipter/wipter-app.bin \
  && rm -rf /tmp/wipter-download

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
