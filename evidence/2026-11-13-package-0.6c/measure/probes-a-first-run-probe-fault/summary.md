Answered (an UPPER-CASE word): a connection opened, an address was found, an HTTP status came back, a proxy answered, or a tunnel opened.
Not answered: unreach (no route), refused, timeout, no-name, no-dns, error.

| attempt | app | db | tools | runner | engine | egress | mis1-app-with-ext | mis2-plain-internal | control-host-network | control-default-bridge |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G 127.0.0.1:2024 | refused | refused | refused | refused | refused | refused | refused | refused | OPEN-CLOSED | refused |
| G 127.0.0.1:5432 | refused | OPEN | refused | refused | refused | refused | refused | refused | OPEN | refused |
| G 127.0.0.1:13128 | refused | refused | refused | refused | refused | refused | refused | refused | refused | refused |
| G 127.0.0.1:14010 | refused | refused | refused | refused | refused | refused | refused | refused | refused | refused |
| G 127.0.0.1:14610 | refused | refused | refused | refused | refused | refused | refused | refused | OPEN | refused |
| G 127.0.0.1:45589 | refused | refused | refused | refused | refused | refused | refused | refused | OPEN | refused |
| G 127.0.0.1:46619 | refused | refused | refused | refused | refused | refused | refused | refused | OPEN | refused |
| G 192.0.2.2:2024 | unreach | unreach | unreach | unreach | unreach | OPEN-CLOSED | OPEN-CLOSED | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 192.0.2.2:5432 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 192.0.2.2:13128 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 192.0.2.2:14010 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 192.0.2.2:14610 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 192.0.2.2:45589 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 192.0.2.2:46619 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 172.17.0.1:2024 | unreach | unreach | unreach | unreach | unreach | OPEN-CLOSED | OPEN-CLOSED | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 172.17.0.1:5432 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 172.17.0.1:13128 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 172.17.0.1:14010 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 172.17.0.1:14610 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 172.17.0.1:45589 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 172.17.0.1:46619 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 10.231.60.1:2024 | unreach | unreach | unreach | unreach | unreach | OPEN-CLOSED | OPEN-CLOSED | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 10.231.60.1:5432 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 10.231.60.1:13128 | unreach | unreach | unreach | unreach | unreach | OPEN | OPEN-CLOSED | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 10.231.60.1:14010 | unreach | unreach | unreach | unreach | unreach | OPEN | OPEN-CLOSED | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 10.231.60.1:14610 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 10.231.60.1:45589 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 10.231.60.1:46619 | unreach | unreach | unreach | unreach | unreach | refused | refused | unreach | refused | refused |
| G 172.21.0.1:2024 | unreach | unreach | unreach | unreach | unreach | OPEN-CLOSED | OPEN-CLOSED | OPEN-CLOSED | OPEN-CLOSED | OPEN-CLOSED |
| G 172.21.0.1:5432 | unreach | unreach | unreach | unreach | unreach | refused | refused | refused | refused | refused |
| G 172.21.0.1:13128 | unreach | unreach | unreach | unreach | unreach | refused | refused | refused | refused | refused |
| G 172.21.0.1:14010 | unreach | unreach | unreach | unreach | unreach | refused | refused | refused | refused | refused |
| G 172.21.0.1:14610 | unreach | unreach | unreach | unreach | unreach | refused | refused | refused | refused | refused |
| G 172.21.0.1:45589 | unreach | unreach | unreach | unreach | unreach | refused | refused | refused | refused | refused |
| G 172.21.0.1:46619 | unreach | unreach | unreach | unreach | unreach | refused | refused | refused | refused | refused |
| A2 | no-dns | no-dns | no-dns | no-dns | no-dns | HTTP301 | HTTP301 | no-dns | HTTP301 | HTTP301 |
| A4 | no-dns | no-dns | no-dns | no-dns | no-dns | no-name | no-name | no-dns | no-name | no-name |
| B1 | unreach | unreach | unreach | unreach | unreach | OPEN | OPEN | unreach | OPEN | OPEN |
| B4 | unreach | unreach | unreach | unreach | unreach | HTTP403 | HTTP403 | unreach | HTTP403 | HTTP403 |
| D1 | timeout | timeout | timeout | timeout | timeout | FOUND | FOUND | timeout | FOUND | FOUND |
| D2 | timeout | timeout | timeout | timeout | timeout | no-name | no-name | timeout | no-name | no-name |
| D3 | timeout | timeout | timeout | timeout | timeout | no-name | FOUND | timeout | no-name | no-name |
| D5 | refused | refused | refused | refused | refused | FOUND | FOUND | refused | FOUND | FOUND |
| D6 | error | error | error | error | error | FOUND | FOUND | error | refused | refused |
| E2 | timeout | timeout | timeout | timeout | timeout | TUN>200 | TUN>200 | timeout | no-name | no-name |
| E3 | timeout | timeout | timeout | timeout | timeout | proxy403 | proxy403 | timeout | no-name | no-name |
| E4 | timeout | timeout | timeout | timeout | timeout | HTTP405 | HTTP405 | timeout | no-name | no-name |
| E5 | timeout | timeout | timeout | timeout | timeout | HTTP403 | HTTP403 | timeout | no-name | no-name |
| W1 | timeout | timeout | timeout | timeout | timeout | HTTP200 | HTTP200 | timeout | no-name | no-name |
| W2 | timeout | timeout | timeout | timeout | timeout | HTTP405 | HTTP405 | timeout | no-name | no-name |
| R1 | unreach | unreach | unreach | unreach | unreach | OPEN-SILENT | OPEN-CLOSED | unreach | OPEN-CLOSED | OPEN-CLOSED |
| R2 | unreach | unreach | unreach | unreach | unreach | HTTP200 | connection-reset | unreach | connection-reset | connection-reset |
| P1 | timeout | timeout | timeout | timeout | timeout | no-name | OPEN | timeout | no-name | no-name |
| P2 | timeout | timeout | timeout | timeout | timeout | no-name | HTTP200 | timeout | no-name | no-name |
| P3 | timeout | timeout | timeout | timeout | timeout | OPEN | OPEN | timeout | no-name | no-name |

## app
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.19.0.2","eth1: IPv4 172.20.0.1"]
- interfaces in /sys/class/net: ["eth0","eth1","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 172.19.0.0 gw 0.0.0.0 mask 255.255.0.0","eth1 dest 172.20.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: false
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 0 of 55

## db
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.19.0.1"]
- interfaces in /sys/class/net: ["eth0","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 172.19.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: false
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 1 of 55
  - G 127.0.0.1:5432 (a machine address and a port that listens on the machine): connected — from 127.0.0.1

## tools
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.19.0.3"]
- interfaces in /sys/class/net: ["eth0","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 172.19.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: false
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 0 of 55

## runner
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.20.0.3"]
- interfaces in /sys/class/net: ["eth0","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 172.20.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: false
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 0 of 55

## engine
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.18.0.2"]
- interfaces in /sys/class/net: ["eth0","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 172.18.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: false
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 0 of 55

## egress
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 10.231.60.2","eth1: IPv4 172.18.0.1"]
- interfaces in /sys/class/net: ["eth0","eth1","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 0.0.0.0 gw 10.231.60.1 mask 0.0.0.0","eth0 dest 10.231.60.0 gw 0.0.0.0 mask 255.255.255.240","eth1 dest 172.18.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: true
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 21 of 55
  - G 192.0.2.2:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 172.17.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:13128 (a machine address and a port that listens on the machine): connected — from 10.231.60.2
  - G 10.231.60.1:14010 (a machine address and a port that listens on the machine): connected — from 10.231.60.2
  - G 172.21.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - A2 (outside, by name, plain HTTP, no proxy): HTTP 301 — server: cloudflare
  - B1 (outside address, TCP 443): connected — from 10.231.60.2
  - B4 (the cloud's machine-information address): HTTP 403 — x-deny-reason: private_dest_ip; says: "Destination IP is in a private/reserved range"
  - D1 (allowed outside name, the container's resolver): address found — 104.16.4.34 104.16.7.34 104.16.10.34 104.16.2.34 104.16.11.34 104.16.9.34 104.16.6.34 104.16.5.34 104.16.3.34 104.16.0.34 104.16.8.34 104.16.1.34
  - D5 (allowed name, asking 1.1.1.1 directly (UDP 53)): address found — 104.16.4.34 104.16.7.34 104.16.10.34 104.16.2.34 104.16.11.34 104.16.9.34 104.16.6.34 104.16.5.34 104.16.3.34 104.16.0.34 104.16.8.34 104.16.1.34
  - D6 (asking Docker's own name server directly): address found — 104.16.4.34 104.16.7.34 104.16.10.34 104.16.2.34 104.16.11.34 104.16.9.34 104.16.6.34 104.16.5.34 104.16.3.34 104.16.0.34 104.16.8.34 104.16.1.34
  - E2 (through the egress proxy: tunnel, then HTTPS GET, no session certificate): tunnel open; inside it: HTTP/1.1 200 OK — proxy said: HTTP/1.1 200 Connection Established; certificate trusted with the container's own store
  - E3 (through the egress proxy: a refused host): proxy answered: HTTP/1.1 403 Forbidden — says: "egress refused: example.com is not an allowed host"
  - E4 (through the egress proxy: plain HTTP, allowed host): HTTP 405 — says: "agent-proxy relay: this proxy only accepts HTTPS CONNECT tunnels. Plain-HTTP/absolute-form"
  - E5 (through the egress proxy: plain HTTP, refused host): HTTP 403 — says: "egress refused: example.com is not an allowed host"
  - W1 (the gateway through the egress container's fixed port): HTTP 200 — server: m06c-gateway-standin; says: "{"answeredBy":"m06c gateway stand-in","path":"/v1/ping"}"
  - W2 (the gateway by proxy semantics (gateway.internal through the egress proxy)): HTTP 405 — says: "agent-proxy relay: this proxy only accepts HTTPS CONNECT tunnels. Plain-HTTP/absolute-form"
  - R1 (the relay's session-proxy port directly (not through the egress proxy)): connected, then no answer within the limit — CONNECT sent
  - R2 (the relay's gateway port directly): HTTP 200 — server: m06c-gateway-standin; says: "{"answeredBy":"m06c gateway stand-in","path":"/v1/ping"}"
  - P3 (the project's egress proxy): connected — from 10.231.60.2

## mis1-app-with-ext
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.20.0.2","eth1: IPv4 172.19.0.4","eth2: IPv4 10.231.60.3"]
- interfaces in /sys/class/net: ["eth0","eth1","eth2","lo"]
- IPv4 routes (/proc/net/route): ["eth2 dest 0.0.0.0 gw 10.231.60.1 mask 0.0.0.0","eth2 dest 10.231.60.0 gw 0.0.0.0 mask 255.255.255.240","eth1 dest 172.19.0.0 gw 0.0.0.0 mask 255.255.0.0","eth0 dest 172.20.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: true
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 23 of 55
  - G 192.0.2.2:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 172.17.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:13128 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:14010 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 172.21.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - A2 (outside, by name, plain HTTP, no proxy): HTTP 301 — server: cloudflare
  - B1 (outside address, TCP 443): connected — from 10.231.60.3
  - B4 (the cloud's machine-information address): HTTP 403 — x-deny-reason: private_dest_ip; says: "Destination IP is in a private/reserved range"
  - D1 (allowed outside name, the container's resolver): address found — 104.16.4.34 104.16.7.34 104.16.10.34 104.16.2.34 104.16.11.34 104.16.9.34 104.16.6.34 104.16.5.34 104.16.3.34 104.16.0.34 104.16.8.34 104.16.1.34
  - D3 (the project's database by service name): address found — 172.19.0.1
  - D5 (allowed name, asking 1.1.1.1 directly (UDP 53)): address found — 104.16.4.34 104.16.7.34 104.16.10.34 104.16.2.34 104.16.11.34 104.16.9.34 104.16.6.34 104.16.5.34 104.16.3.34 104.16.0.34 104.16.8.34 104.16.1.34
  - D6 (asking Docker's own name server directly): address found — 104.16.4.34 104.16.7.34 104.16.10.34 104.16.2.34 104.16.11.34 104.16.9.34 104.16.6.34 104.16.5.34 104.16.3.34 104.16.0.34 104.16.8.34 104.16.1.34
  - E2 (through the egress proxy: tunnel, then HTTPS GET, no session certificate): tunnel open; inside it: HTTP/1.1 200 OK — proxy said: HTTP/1.1 200 Connection Established; certificate trusted with the container's own store
  - E3 (through the egress proxy: a refused host): proxy answered: HTTP/1.1 403 Forbidden — says: "egress refused: example.com is not an allowed host"
  - E4 (through the egress proxy: plain HTTP, allowed host): HTTP 405 — says: "agent-proxy relay: this proxy only accepts HTTPS CONNECT tunnels. Plain-HTTP/absolute-form"
  - E5 (through the egress proxy: plain HTTP, refused host): HTTP 403 — says: "egress refused: example.com is not an allowed host"
  - W1 (the gateway through the egress container's fixed port): HTTP 200 — server: m06c-gateway-standin; says: "{"answeredBy":"m06c gateway stand-in","path":"/v1/ping"}"
  - W2 (the gateway by proxy semantics (gateway.internal through the egress proxy)): HTTP 405 — says: "agent-proxy relay: this proxy only accepts HTTPS CONNECT tunnels. Plain-HTTP/absolute-form"
  - R1 (the relay's session-proxy port directly (not through the egress proxy)): connected, then closed by the other end — nothing came back
  - P1 (the project's database): connected — from 172.19.0.4
  - P2 (the project's app, sign-in page): HTTP 200 — says: "<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charSet="utf-8"/><meta name="viewport"
  - P3 (the project's egress proxy): connected — from 10.231.60.3

## mis2-plain-internal
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.21.0.2"]
- interfaces in /sys/class/net: ["eth0","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 172.21.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: false
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 1 of 55
  - G 172.21.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end

## control-host-network
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 192.0.2.2","docker0: IPv4 172.17.0.1","br-eb770dd6da9d: IPv4 10.231.60.1","br-478ee2db8dbc: IPv4 172.21.0.1"]
- interfaces in /sys/class/net: ["br-06e6e23ec069","br-1522af90ed68","br-478ee2db8dbc","br-752ebc27944f","br-eb770dd6da9d","docker0","eth0","ifb0","ifb1","lo","veth0a028d8","veth1fd4583","veth294f651","veth54165d6","veth60b31e0","veth6d869b8","veth7eb3fb1","veth8c6fa4d","veth8cd7a93","vethc376e35","vethd3f246e","vethd8fc2ec","vethdd0501b"]
- IPv4 routes (/proc/net/route): ["eth0 dest 0.0.0.0 gw 192.0.2.1 mask 0.0.0.0","br-eb770dd6da9d dest 10.231.60.0 gw 0.0.0.0 mask 255.255.255.240","docker0 dest 172.17.0.0 gw 0.0.0.0 mask 255.255.0.0","br-478ee2db8dbc dest 172.21.0.0 gw 0.0.0.0 mask 255.255.0.0","eth0 dest 192.0.2.0 gw 0.0.0.0 mask 255.255.255.0"]
- default route present: true
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 8.8.8.8","nameserver 8.8.4.4"]
- answered: 17 of 55
  - G 127.0.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 127.0.0.1:5432 (a machine address and a port that listens on the machine): connected — from 127.0.0.1
  - G 127.0.0.1:14610 (a machine address and a port that listens on the machine): connected — from 127.0.0.1
  - G 127.0.0.1:45589 (a machine address and a port that listens on the machine): connected — from 127.0.0.1
  - G 127.0.0.1:46619 (a machine address and a port that listens on the machine): connected — from 127.0.0.1
  - G 192.0.2.2:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 172.17.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:13128 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:14010 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 172.21.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - A2 (outside, by name, plain HTTP, no proxy): HTTP 301 — server: cloudflare
  - B1 (outside address, TCP 443): connected — from 192.0.2.2
  - B4 (the cloud's machine-information address): HTTP 403 — x-deny-reason: private_dest_ip; says: "Destination IP is in a private/reserved range"
  - D1 (allowed outside name, the container's resolver): address found — 104.16.4.34 104.16.7.34 104.16.10.34 104.16.2.34 104.16.11.34 104.16.9.34 104.16.6.34 104.16.5.34 104.16.3.34 104.16.0.34 104.16.8.34 104.16.1.34
  - D5 (allowed name, asking 1.1.1.1 directly (UDP 53)): address found — 104.16.4.34 104.16.7.34 104.16.10.34 104.16.2.34 104.16.11.34 104.16.9.34 104.16.6.34 104.16.5.34 104.16.3.34 104.16.0.34 104.16.8.34 104.16.1.34
  - R1 (the relay's session-proxy port directly (not through the egress proxy)): connected, then closed by the other end — nothing came back

## control-default-bridge
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.17.0.2"]
- interfaces in /sys/class/net: ["eth0","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 0.0.0.0 gw 172.17.0.1 mask 0.0.0.0","eth0 dest 172.17.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: true
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 8.8.8.8","nameserver 8.8.4.4"]
- answered: 12 of 55
  - G 192.0.2.2:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 172.17.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:13128 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:14010 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 172.21.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - A2 (outside, by name, plain HTTP, no proxy): HTTP 301 — server: cloudflare
  - B1 (outside address, TCP 443): connected — from 172.17.0.2
  - B4 (the cloud's machine-information address): HTTP 403 — x-deny-reason: private_dest_ip; says: "Destination IP is in a private/reserved range"
  - D1 (allowed outside name, the container's resolver): address found — 104.16.4.34 104.16.7.34 104.16.10.34 104.16.2.34 104.16.11.34 104.16.9.34 104.16.6.34 104.16.5.34 104.16.3.34 104.16.0.34 104.16.8.34 104.16.1.34
  - D5 (allowed name, asking 1.1.1.1 directly (UDP 53)): address found — 104.16.4.34 104.16.7.34 104.16.10.34 104.16.2.34 104.16.11.34 104.16.9.34 104.16.6.34 104.16.5.34 104.16.3.34 104.16.0.34 104.16.8.34 104.16.1.34
  - R1 (the relay's session-proxy port directly (not through the egress proxy)): connected, then closed by the other end — nothing came back
