#!/usr/bin/env bash
set -euo pipefail

: "${PROXY_TYPE:=socks5}"
: "${PROXY_HOST:?PROXY_HOST is required}"
: "${PROXY_PORT:?PROXY_PORT is required}"
: "${PROXY_USERNAME:=}"
: "${PROXY_PASSWORD:=}"

READY_FILE="/tmp/sidecar.ready"
REDSOCKS_PORT="12345"
DNS_LISTEN_PORT="5353"
PROXY_UID="10001"
DNS_UPSTREAM_HOST="${DNS_UPSTREAM_HOST:-1.1.1.1}"
DNS_UPSTREAM_PORT="${DNS_UPSTREAM_PORT:-53}"
rm -f "$READY_FILE"

REDSOCKS_TYPE="socks5"
if [ "$PROXY_TYPE" = "http" ]; then
  REDSOCKS_TYPE="http-connect"
fi

ORIGINAL_PROXY_HOST="$PROXY_HOST"
if ! echo "$PROXY_HOST" | grep -Eq '^[0-9]+(\.[0-9]+){3}$'; then
  RESOLVED_PROXY_HOST="$(dig +short A "$PROXY_HOST" | grep -E '^[0-9]+(\.[0-9]+){3}$' | head -n 1 || true)"
  if [ -z "$RESOLVED_PROXY_HOST" ]; then
    echo "PROXY_HOST could not be resolved to an IPv4 address: ${PROXY_HOST}" >&2
    exit 1
  fi
  echo "Resolved proxy host ${PROXY_HOST} -> ${RESOLVED_PROXY_HOST}"
  PROXY_HOST="$RESOLVED_PROXY_HOST"
  export PROXY_HOST
fi

cat >/usr/local/bin/tcp_socks_proxy.py <<'PY'
import os
import select
import socket
import struct
import sys
import threading

SOL_IP = 0
SO_ORIGINAL_DST = 80

proxy_type = os.environ.get("PROXY_TYPE", "socks5")
proxy_host = os.environ["PROXY_HOST"]
proxy_port = int(os.environ["PROXY_PORT"])
proxy_user = os.environ.get("PROXY_USERNAME", "")
proxy_pass = os.environ.get("PROXY_PASSWORD", "")
listen_port = int(os.environ.get("REDSOCKS_PORT", "12345"))

def recvall(sock, size):
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise OSError("connection closed")
        data += chunk
    return data

def original_dst(client):
    data = client.getsockopt(SOL_IP, SO_ORIGINAL_DST, 16)
    port = struct.unpack_from("!H", data, 2)[0]
    host = socket.inet_ntoa(data[4:8])
    return host, port

def connect_socks5(dest_host, dest_port):
    sock = socket.create_connection((proxy_host, proxy_port), timeout=10)
    if proxy_user:
        sock.sendall(b"\x05\x02\x00\x02")
    else:
        sock.sendall(b"\x05\x01\x00")
    method = recvall(sock, 2)
    if method[0] != 5 or method[1] == 0xFF:
        raise OSError("SOCKS5 auth negotiation failed")
    if method[1] == 2:
        user = proxy_user.encode()
        password = proxy_pass.encode()
        sock.sendall(b"\x01" + bytes([len(user)]) + user + bytes([len(password)]) + password)
        auth = recvall(sock, 2)
        if auth != b"\x01\x00":
            raise OSError("SOCKS5 username/password auth failed")
    try:
        addr = socket.inet_aton(dest_host)
        request = b"\x05\x01\x00\x01" + addr + struct.pack("!H", dest_port)
    except OSError:
        encoded = dest_host.encode()
        request = b"\x05\x01\x00\x03" + bytes([len(encoded)]) + encoded + struct.pack("!H", dest_port)
    sock.sendall(request)
    resp = recvall(sock, 4)
    if resp[1] != 0:
        raise OSError(f"SOCKS5 connect failed: {resp[1]}")
    atyp = resp[3]
    if atyp == 1:
        recvall(sock, 4)
    elif atyp == 3:
        recvall(sock, recvall(sock, 1)[0])
    elif atyp == 4:
        recvall(sock, 16)
    recvall(sock, 2)
    return sock

def connect_http(dest_host, dest_port):
    sock = socket.create_connection((proxy_host, proxy_port), timeout=10)
    auth = b""
    if proxy_user:
        import base64
        token = base64.b64encode(f"{proxy_user}:{proxy_pass}".encode()).decode()
        auth = f"Proxy-Authorization: Basic {token}\r\n".encode()
    request = f"CONNECT {dest_host}:{dest_port} HTTP/1.1\r\nHost: {dest_host}:{dest_port}\r\n".encode() + auth + b"\r\n"
    sock.sendall(request)
    response = b""
    while b"\r\n\r\n" not in response:
        chunk = sock.recv(4096)
        if not chunk:
            raise OSError("HTTP proxy closed")
        response += chunk
        if len(response) > 8192:
            raise OSError("HTTP proxy response too large")
    if b" 200 " not in response.split(b"\r\n", 1)[0]:
        raise OSError("HTTP CONNECT failed")
    return sock

def relay(left, right):
    sockets = [left, right]
    try:
        while True:
            readable, _, _ = select.select(sockets, [], [], 60)
            if not readable:
                return
            for src in readable:
                data = src.recv(65536)
                if not data:
                    return
                dst = right if src is left else left
                dst.sendall(data)
    finally:
        left.close()
        right.close()

def handle(client, addr):
    try:
        dest_host, dest_port = original_dst(client)
        print(f"tcp_socks_proxy connect {dest_host}:{dest_port}", flush=True)
        upstream = connect_http(dest_host, dest_port) if proxy_type == "http" else connect_socks5(dest_host, dest_port)
        relay(client, upstream)
    except Exception as exc:
        print(f"tcp_socks_proxy error from {addr}: {exc}", file=sys.stderr, flush=True)
        client.close()

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("0.0.0.0", listen_port))
server.listen(256)
print(f"tcp_socks_proxy listening on 0.0.0.0:{listen_port}", flush=True)
while True:
    client, addr = server.accept()
    threading.Thread(target=handle, args=(client, addr), daemon=True).start()
PY

cat >/usr/local/bin/dns_tcp_proxy.py <<'PY'
import os
import socket
import struct
import sys
import threading

proxy_type = os.environ.get("PROXY_TYPE", "socks5")
proxy_host = os.environ["PROXY_HOST"]
proxy_port = int(os.environ["PROXY_PORT"])
proxy_user = os.environ.get("PROXY_USERNAME", "")
proxy_pass = os.environ.get("PROXY_PASSWORD", "")
upstream_host = os.environ.get("DNS_UPSTREAM_HOST", "1.1.1.1")
upstream_port = int(os.environ.get("DNS_UPSTREAM_PORT", "53"))
listen_port = int(os.environ.get("DNS_LISTEN_PORT", "5353"))

def recvall(sock, size):
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise OSError("connection closed")
        data += chunk
    return data

def connect_socks5():
    sock = socket.create_connection((proxy_host, proxy_port), timeout=8)
    if proxy_user:
        sock.sendall(b"\x05\x02\x00\x02")
    else:
        sock.sendall(b"\x05\x01\x00")
    method = recvall(sock, 2)
    if method[0] != 5 or method[1] == 0xFF:
        raise OSError("SOCKS5 auth negotiation failed")
    if method[1] == 2:
        user = proxy_user.encode()
        password = proxy_pass.encode()
        sock.sendall(b"\x01" + bytes([len(user)]) + user + bytes([len(password)]) + password)
        auth = recvall(sock, 2)
        if auth != b"\x01\x00":
            raise OSError("SOCKS5 username/password auth failed")
    host = socket.inet_aton(upstream_host)
    sock.sendall(b"\x05\x01\x00\x01" + host + struct.pack("!H", upstream_port))
    resp = recvall(sock, 4)
    if resp[1] != 0:
        raise OSError(f"SOCKS5 connect failed: {resp[1]}")
    atyp = resp[3]
    if atyp == 1:
        recvall(sock, 4)
    elif atyp == 3:
        recvall(sock, recvall(sock, 1)[0])
    elif atyp == 4:
        recvall(sock, 16)
    recvall(sock, 2)
    return sock

def connect_http():
    sock = socket.create_connection((proxy_host, proxy_port), timeout=8)
    auth = b""
    if proxy_user:
        import base64
        token = base64.b64encode(f"{proxy_user}:{proxy_pass}".encode()).decode()
        auth = f"Proxy-Authorization: Basic {token}\r\n".encode()
    request = f"CONNECT {upstream_host}:{upstream_port} HTTP/1.1\r\nHost: {upstream_host}:{upstream_port}\r\n".encode() + auth + b"\r\n"
    sock.sendall(request)
    response = b""
    while b"\r\n\r\n" not in response:
        response += sock.recv(4096)
        if len(response) > 8192:
            raise OSError("HTTP proxy response too large")
    if b" 200 " not in response.split(b"\r\n", 1)[0]:
        raise OSError("HTTP CONNECT failed")
    return sock

def query_dns(payload):
    sock = connect_http() if proxy_type == "http" else connect_socks5()
    with sock:
        sock.settimeout(10)
        sock.sendall(struct.pack("!H", len(payload)) + payload)
        size = struct.unpack("!H", recvall(sock, 2))[0]
        return recvall(sock, size)

def handle(payload, addr, server):
    try:
        response = query_dns(payload)
        server.sendto(response, addr)
    except Exception as exc:
        print(f"dns_tcp_proxy error: {exc}", file=sys.stderr, flush=True)

server = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
server.bind(("127.0.0.1", listen_port))
print(f"dns_tcp_proxy listening on 127.0.0.1:{listen_port}", flush=True)
while True:
    payload, addr = server.recvfrom(4096)
    threading.Thread(target=handle, args=(payload, addr, server), daemon=True).start()
PY

drop_ipv6() {
  if ip -6 addr show scope global 2>/dev/null | grep -q 'inet6'; then
    ip6tables -F OUTPUT
    ip6tables -P OUTPUT DROP
    ip6tables -F INPUT
    ip6tables -P INPUT DROP
    ip6tables -F FORWARD
    ip6tables -P FORWARD DROP
    return
  fi

  ip6tables -F OUTPUT 2>/dev/null || true
  ip6tables -P OUTPUT DROP 2>/dev/null || true
  ip6tables -F INPUT 2>/dev/null || true
  ip6tables -P INPUT DROP 2>/dev/null || true
  ip6tables -F FORWARD 2>/dev/null || true
  ip6tables -P FORWARD DROP 2>/dev/null || true
}

install_ipv4_killswitch() {
  iptables -t mangle -F OUTPUT
  iptables -F OUTPUT
  iptables -P OUTPUT DROP
  iptables -F INPUT
  iptables -P INPUT DROP
  iptables -F FORWARD
  iptables -P FORWARD DROP

  iptables -A OUTPUT -o lo -j ACCEPT
  iptables -A INPUT -i lo -j ACCEPT
  iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -A OUTPUT -m owner --uid-owner "${PROXY_UID}" -p tcp -d "${PROXY_HOST}/32" --dport "${PROXY_PORT}" -j ACCEPT
  iptables -A INPUT -p tcp -s "${PROXY_HOST}/32" --sport "${PROXY_PORT}" -m conntrack --ctstate ESTABLISHED -j ACCEPT
  iptables -A OUTPUT -d 0.0.0.0/8 -j DROP
  iptables -A OUTPUT -d 10.0.0.0/8 -j DROP
  iptables -A OUTPUT -d 169.254.0.0/16 -j DROP
  iptables -A OUTPUT -d 172.16.0.0/12 -j DROP
  iptables -A OUTPUT -d 192.168.0.0/16 -j DROP
  iptables -A OUTPUT -p tcp -m mark --mark 0x1 -j ACCEPT
  iptables -t nat -N REDSOCKS 2>/dev/null || true
  iptables -t nat -F REDSOCKS
  iptables -t nat -A REDSOCKS -d 0.0.0.0/8 -j RETURN
  iptables -t nat -A REDSOCKS -d 10.0.0.0/8 -j RETURN
  iptables -t nat -A REDSOCKS -d 127.0.0.0/8 -j RETURN
  iptables -t nat -A REDSOCKS -d 169.254.0.0/16 -j RETURN
  iptables -t nat -A REDSOCKS -d 172.16.0.0/12 -j RETURN
  iptables -t nat -A REDSOCKS -d 192.168.0.0/16 -j RETURN
  iptables -t nat -A REDSOCKS -d "${PROXY_HOST}/32" -j RETURN
  iptables -t nat -A REDSOCKS -p tcp -j REDIRECT --to-ports "${REDSOCKS_PORT}"

  iptables -t nat -D OUTPUT -p udp --dport 53 -j REDIRECT --to-ports "${DNS_LISTEN_PORT}" 2>/dev/null || true
  iptables -t nat -A OUTPUT -p udp --dport 53 -j REDIRECT --to-ports "${DNS_LISTEN_PORT}"
  iptables -t mangle -A OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -d 0.0.0.0/8 -j RETURN
  iptables -t mangle -A OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -d 10.0.0.0/8 -j RETURN
  iptables -t mangle -A OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -d 127.0.0.0/8 -j RETURN
  iptables -t mangle -A OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -d 169.254.0.0/16 -j RETURN
  iptables -t mangle -A OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -d 172.16.0.0/12 -j RETURN
  iptables -t mangle -A OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -d 192.168.0.0/16 -j RETURN
  iptables -t mangle -A OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -d "${PROXY_HOST}/32" -j RETURN
  iptables -t mangle -A OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -j MARK --set-mark 0x1
  iptables -t nat -D OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -j REDSOCKS 2>/dev/null || true
  iptables -t nat -A OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -j REDSOCKS
}

watch_firewall() {
  while true; do
    if ! iptables -t nat -C OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -j REDSOCKS 2>/dev/null; then
      echo "REDSOCKS NAT rule missing; stopping sidecar" >&2
      kill "$TCP_PROXY_PID" 2>/dev/null || true
      return 1
    fi
    if ! iptables -t mangle -C OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -j MARK --set-mark 0x1 2>/dev/null; then
      echo "Safe TCP mark rule missing; stopping sidecar" >&2
      kill "$TCP_PROXY_PID" 2>/dev/null || true
      return 1
    fi
    if iptables -t mangle -C OUTPUT -p tcp -m owner ! --uid-owner "${PROXY_UID}" -d 10.0.0.0/8 -j MARK --set-mark 0x1 2>/dev/null; then
      echo "Unsafe private TCP mark rule detected; stopping sidecar" >&2
      kill "$TCP_PROXY_PID" 2>/dev/null || true
      return 1
    fi
    if iptables -C OUTPUT -p tcp -j ACCEPT 2>/dev/null; then
      echo "Unsafe TCP ACCEPT-all rule detected; stopping sidecar" >&2
      kill "$TCP_PROXY_PID" 2>/dev/null || true
      return 1
    fi
    if ! pgrep -f tcp_socks_proxy.py >/dev/null || ! pgrep -f dns_tcp_proxy.py >/dev/null; then
      echo "Required proxy process missing; stopping sidecar" >&2
      kill "$TCP_PROXY_PID" 2>/dev/null || true
      return 1
    fi
    sleep 5
  done
}

wait_for_ready() {
  for _ in $(seq 1 30); do
    if dig +time=2 +tries=1 @"127.0.0.1" -p "${DNS_LISTEN_PORT}" wipter.com A >/dev/null 2>&1; then
      touch "$READY_FILE"
      return 0
    fi
    sleep 1
  done
  echo "DNSCrypt did not become ready" >&2
  exit 1
}

drop_ipv6
install_ipv4_killswitch
printf 'nameserver 127.0.0.1\noptions timeout:3 attempts:2\n' >/etc/resolv.conf
addgroup -g "${PROXY_UID}" proxyproc 2>/dev/null || true
adduser -D -H -u "${PROXY_UID}" -G proxyproc proxyproc 2>/dev/null || true

REDSOCKS_PORT="${REDSOCKS_PORT}" su-exec "${PROXY_UID}:${PROXY_UID}" python3 /usr/local/bin/tcp_socks_proxy.py &
TCP_PROXY_PID="$!"

DNS_LISTEN_PORT="${DNS_LISTEN_PORT}" su-exec "${PROXY_UID}:${PROXY_UID}" python3 /usr/local/bin/dns_tcp_proxy.py &
DNS_PID="$!"

trap 'rm -f "$READY_FILE"; kill "$DNS_PID" "$TCP_PROXY_PID" 2>/dev/null || true' TERM INT
wait_for_ready
watch_firewall &
wait "$TCP_PROXY_PID"
