# Item 9: probes for option (a-prime), the Unix-socket door. engine = a stand-in on the project's out network (isolated, internal) with the door named egress; door = the door's own network namespace; two controls. Attempts from 09b's reading. 2026-11-13T10:53:06Z

Answered (an UPPER-CASE word): a connection opened, an address was found, an HTTP status came back, a proxy answered, or a tunnel opened.
Not answered: unreach (no route), refused, timeout, no-name, no-dns, error.

| attempt | engine | door | control-default-bridge | control-host-network |
| --- | --- | --- | --- | --- |
| G 127.0.0.1:2024 | refused | refused | refused | OPEN-CLOSED |
| G 127.0.0.1:5432 | refused | refused | refused | OPEN |
| G 127.0.0.1:13128 | refused | refused | refused | refused |
| G 127.0.0.1:13129 | refused | refused | refused | OPEN |
| G 127.0.0.1:14010 | refused | refused | refused | refused |
| G 127.0.0.1:14610 | refused | refused | refused | OPEN |
| G 127.0.0.1:36339 | refused | refused | refused | OPEN |
| G 127.0.0.1:40261 | refused | refused | refused | OPEN |
| G 192.0.2.2:2024 | unreach | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 192.0.2.2:5432 | unreach | unreach | refused | refused |
| G 192.0.2.2:13128 | unreach | unreach | refused | refused |
| G 192.0.2.2:13129 | unreach | unreach | refused | refused |
| G 192.0.2.2:14010 | unreach | unreach | refused | refused |
| G 192.0.2.2:14610 | unreach | unreach | refused | refused |
| G 192.0.2.2:36339 | unreach | unreach | refused | refused |
| G 192.0.2.2:40261 | unreach | unreach | refused | refused |
| G 172.17.0.1:2024 | unreach | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 172.17.0.1:5432 | unreach | unreach | refused | refused |
| G 172.17.0.1:13128 | unreach | unreach | refused | refused |
| G 172.17.0.1:13129 | unreach | unreach | refused | refused |
| G 172.17.0.1:14010 | unreach | unreach | refused | refused |
| G 172.17.0.1:14610 | unreach | unreach | refused | refused |
| G 172.17.0.1:36339 | unreach | unreach | refused | refused |
| G 172.17.0.1:40261 | unreach | unreach | refused | refused |
| G 10.231.60.1:2024 | unreach | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 10.231.60.1:5432 | unreach | unreach | refused | refused |
| G 10.231.60.1:13128 | unreach | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 10.231.60.1:13129 | unreach | unreach | refused | refused |
| G 10.231.60.1:14010 | unreach | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 10.231.60.1:14610 | unreach | unreach | refused | refused |
| G 10.231.60.1:36339 | unreach | unreach | refused | refused |
| G 10.231.60.1:40261 | unreach | unreach | refused | refused |
| G 172.21.0.1:2024 | unreach | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 172.21.0.1:5432 | unreach | unreach | refused | refused |
| G 172.21.0.1:13128 | unreach | unreach | refused | refused |
| G 172.21.0.1:13129 | unreach | unreach | refused | refused |
| G 172.21.0.1:14010 | unreach | unreach | refused | refused |
| G 172.21.0.1:14610 | unreach | unreach | refused | refused |
| G 172.21.0.1:36339 | unreach | unreach | refused | refused |
| G 172.21.0.1:40261 | unreach | unreach | refused | refused |
| G 10.231.61.1:2024 | unreach | unreach | OPEN-CLOSED | OPEN-CLOSED |
| G 10.231.61.1:5432 | unreach | unreach | refused | refused |
| G 10.231.61.1:13128 | unreach | unreach | refused | refused |
| G 10.231.61.1:13129 | unreach | unreach | refused | refused |
| G 10.231.61.1:14010 | unreach | unreach | refused | refused |
| G 10.231.61.1:14610 | unreach | unreach | refused | refused |
| G 10.231.61.1:36339 | unreach | unreach | refused | refused |
| G 10.231.61.1:40261 | unreach | unreach | refused | refused |
| A2 | no-dns | no-dns | HTTP301 | HTTP301 |
| A4 | no-dns | no-dns | no-name | no-name |
| B1 | unreach | unreach | OPEN | OPEN |
| B4 | unreach | unreach | HTTP403 | HTTP403 |
| D1 | no-dns | no-dns | FOUND | FOUND |
| D2 | no-dns | no-dns | no-name | no-name |
| D3 | no-dns | no-dns | no-name | no-name |
| D5 | refused | refused | FOUND | FOUND |
| D6 | error | error | refused | refused |
| E2 | TUN>200 | TUN>200 | no-name | no-name |
| E3 | proxy403 | proxy403 | no-name | no-name |
| E4 | HTTP405 | HTTP405 | no-name | no-name |
| E5 | HTTP403 | HTTP403 | no-name | no-name |
| W1 | HTTP200 | HTTP200 | no-name | no-name |
| W2 | HTTP403 | HTTP403 | no-name | no-name |
| P1 | no-dns | no-dns | no-name | no-name |
| P2 | no-dns | no-dns | no-name | no-name |
| P3 | OPEN | OPEN | no-name | no-name |

## engine
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.22.0.1"]
- interfaces in /sys/class/net: ["eth0","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 172.22.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: false
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 7 of 66
  - E2 (through the egress proxy: tunnel, then HTTPS GET, no session certificate): tunnel open; inside it: HTTP/1.1 200 OK — proxy said: HTTP/1.1 200 Connection Established; certificate trusted with the container's own store
  - E3 (through the egress proxy: a refused host): proxy answered: HTTP/1.1 403 Forbidden — says: "egress refused: example.com is not an allowed host"
  - E4 (through the egress proxy: plain HTTP, allowed host): HTTP 405 — says: "agent-proxy relay: this proxy only accepts HTTPS CONNECT tunnels. Plain-HTTP/absolute-form"
  - E5 (through the egress proxy: plain HTTP, refused host): HTTP 403 — says: "egress refused: example.com is not an allowed host"
  - W1 (the gateway through the egress container's fixed port): HTTP 200 — server: m06c-gateway-standin; says: "{"answeredBy":"m06c gateway stand-in","path":"/v1/ping"}"
  - W2 (the gateway by proxy semantics (gateway.internal through the egress proxy)): HTTP 403 — says: "egress refused: gateway.internal is not an allowed host"
  - P3 (the project's egress proxy): connected — from 172.22.0.1

## door
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.22.0.2"]
- interfaces in /sys/class/net: ["eth0","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 172.22.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: false
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 7 of 66
  - E2 (through the egress proxy: tunnel, then HTTPS GET, no session certificate): tunnel open; inside it: HTTP/1.1 200 OK — proxy said: HTTP/1.1 200 Connection Established; certificate trusted with the container's own store
  - E3 (through the egress proxy: a refused host): proxy answered: HTTP/1.1 403 Forbidden — says: "egress refused: example.com is not an allowed host"
  - E4 (through the egress proxy: plain HTTP, allowed host): HTTP 405 — says: "agent-proxy relay: this proxy only accepts HTTPS CONNECT tunnels. Plain-HTTP/absolute-form"
  - E5 (through the egress proxy: plain HTTP, refused host): HTTP 403 — says: "egress refused: example.com is not an allowed host"
  - W1 (the gateway through the egress container's fixed port): HTTP 200 — server: m06c-gateway-standin; says: "{"answeredBy":"m06c gateway stand-in","path":"/v1/ping"}"
  - W2 (the gateway by proxy semantics (gateway.internal through the egress proxy)): HTTP 403 — says: "egress refused: gateway.internal is not an allowed host"
  - P3 (the project's egress proxy): connected — from 172.22.0.2

## control-default-bridge
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.17.0.2"]
- interfaces in /sys/class/net: ["eth0","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 0.0.0.0 gw 172.17.0.1 mask 0.0.0.0","eth0 dest 172.17.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: true
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 8.8.8.8","nameserver 8.8.4.4"]
- answered: 12 of 66
  - G 192.0.2.2:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 172.17.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:13128 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:14010 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 172.21.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.61.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - A2 (outside, by name, plain HTTP, no proxy): HTTP 301 — server: cloudflare
  - B1 (outside address, TCP 443): connected — from 172.17.0.2
  - B4 (the cloud's machine-information address): HTTP 403 — x-deny-reason: private_dest_ip; says: "Destination IP is in a private/reserved range"
  - D1 (allowed outside name, the container's resolver): address found — 104.16.9.34 104.16.3.34 104.16.4.34 104.16.11.34 104.16.6.34 104.16.1.34 104.16.7.34 104.16.2.34 104.16.8.34 104.16.5.34 104.16.10.34 104.16.0.34
  - D5 (allowed name, asking 1.1.1.1 directly (UDP 53)): address found — 104.16.1.34 104.16.6.34 104.16.0.34 104.16.4.34 104.16.5.34 104.16.10.34 104.16.11.34 104.16.2.34 104.16.7.34 104.16.8.34 104.16.9.34 104.16.3.34

## control-host-network
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 192.0.2.2","docker0: IPv4 172.17.0.1","br-eb770dd6da9d: IPv4 10.231.60.1","br-478ee2db8dbc: IPv4 172.21.0.1","br-bc16b8f7bd58: IPv4 10.231.61.1"]
- interfaces in /sys/class/net: ["br-06e6e23ec069","br-1522af90ed68","br-478ee2db8dbc","br-752ebc27944f","br-bc16b8f7bd58","br-db4c3089dd07","br-eb770dd6da9d","docker0","eth0","ifb0","ifb1","lo","veth10c1edf","veth298ae24","veth5254d02","veth52f9f89","veth6943e46","veth772ef25","veth8ef4ef6","veth96f4821","vethab6cccb","vethb6dd517","vethc2e4077","vethc8ff22c","vethc9f0b05","vethf24d91b","vethf2ef0da","vethfba90bd"]
- IPv4 routes (/proc/net/route): ["eth0 dest 0.0.0.0 gw 192.0.2.1 mask 0.0.0.0","br-eb770dd6da9d dest 10.231.60.0 gw 0.0.0.0 mask 255.255.255.240","br-bc16b8f7bd58 dest 10.231.61.0 gw 0.0.0.0 mask 255.255.255.240","docker0 dest 172.17.0.0 gw 0.0.0.0 mask 255.255.0.0","br-478ee2db8dbc dest 172.21.0.0 gw 0.0.0.0 mask 255.255.0.0","eth0 dest 192.0.2.0 gw 0.0.0.0 mask 255.255.255.0"]
- default route present: true
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 8.8.8.8","nameserver 8.8.4.4"]
- answered: 18 of 66
  - G 127.0.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 127.0.0.1:5432 (a machine address and a port that listens on the machine): connected — from 127.0.0.1
  - G 127.0.0.1:13129 (a machine address and a port that listens on the machine): connected — from 127.0.0.1
  - G 127.0.0.1:14610 (a machine address and a port that listens on the machine): connected — from 127.0.0.1
  - G 127.0.0.1:36339 (a machine address and a port that listens on the machine): connected — from 127.0.0.1
  - G 127.0.0.1:40261 (a machine address and a port that listens on the machine): connected — from 127.0.0.1
  - G 192.0.2.2:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 172.17.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:13128 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.60.1:14010 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 172.21.0.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - G 10.231.61.1:2024 (a machine address and a port that listens on the machine): connected, then closed by the other end
  - A2 (outside, by name, plain HTTP, no proxy): HTTP 301 — server: cloudflare
  - B1 (outside address, TCP 443): connected — from 192.0.2.2
  - B4 (the cloud's machine-information address): HTTP 403 — x-deny-reason: private_dest_ip; says: "Destination IP is in a private/reserved range"
  - D1 (allowed outside name, the container's resolver): address found — 104.16.3.34 104.16.10.34 104.16.1.34 104.16.4.34 104.16.6.34 104.16.0.34 104.16.2.34 104.16.5.34 104.16.11.34 104.16.8.34 104.16.9.34 104.16.7.34
  - D5 (allowed name, asking 1.1.1.1 directly (UDP 53)): address found — 104.16.3.34 104.16.10.34 104.16.1.34 104.16.4.34 104.16.6.34 104.16.0.34 104.16.2.34 104.16.5.34 104.16.11.34 104.16.8.34 104.16.9.34 104.16.7.34

## egress-host's decisions during the probes
{"at":"2026-11-13T10:53:03.903Z","accepted":"unix","to":"127.0.0.1:14610"}
{"at":"2026-11-13T10:53:03.927Z","method":"CONNECT","host":"registry.npmjs.org","port":443,"decision":"allowed"}
{"at":"2026-11-13T10:53:03.930Z","method":"CONNECT","host":"example.com","port":443,"decision":"refused"}
{"at":"2026-11-13T10:53:03.944Z","method":"GET","host":"registry.npmjs.org","port":80,"decision":"allowed"}
{"at":"2026-11-13T10:53:03.954Z","method":"GET","host":"example.com","port":80,"decision":"refused"}
{"at":"2026-11-13T10:53:03.961Z","method":"GET","host":"gateway.internal","port":4010,"decision":"refused"}
{"at":"2026-11-13T10:53:03.999Z","accepted":"unix","to":"127.0.0.1:14610"}
{"at":"2026-11-13T10:53:04.000Z","method":"CONNECT","host":"registry.npmjs.org","port":443,"decision":"allowed"}
{"at":"2026-11-13T10:53:04.003Z","method":"CONNECT","host":"example.com","port":443,"decision":"refused"}
{"at":"2026-11-13T10:53:04.003Z","method":"GET","host":"registry.npmjs.org","port":80,"decision":"allowed"}
{"at":"2026-11-13T10:53:04.004Z","method":"GET","host":"example.com","port":80,"decision":"refused"}
{"at":"2026-11-13T10:53:04.007Z","method":"GET","host":"gateway.internal","port":4010,"decision":"refused"}
## the door's log during the probes
{"at":"2026-11-13T10:53:03.898Z","accepted":"172.22.0.2","to":"/sock/egress.sock"}
{"at":"2026-11-13T10:53:03.899Z","accepted":"172.22.0.2","to":"/sock/gw.sock"}
{"at":"2026-11-13T10:53:03.907Z","accepted":"172.22.0.2","to":"/sock/egress.sock"}
{"at":"2026-11-13T10:53:03.917Z","accepted":"172.22.0.2","to":"/sock/egress.sock"}
{"at":"2026-11-13T10:53:03.919Z","accepted":"172.22.0.2","to":"/sock/egress.sock"}
{"at":"2026-11-13T10:53:03.925Z","accepted":"172.22.0.2","to":"/sock/egress.sock"}
{"at":"2026-11-13T10:53:03.946Z","accepted":"172.22.0.2","to":"/sock/egress.sock"}
{"at":"2026-11-13T10:53:03.996Z","accepted":"172.22.0.1","to":"/sock/egress.sock"}
{"at":"2026-11-13T10:53:03.996Z","accepted":"172.22.0.1","to":"/sock/egress.sock"}
{"at":"2026-11-13T10:53:03.997Z","accepted":"172.22.0.1","to":"/sock/egress.sock"}
{"at":"2026-11-13T10:53:03.997Z","accepted":"172.22.0.1","to":"/sock/gw.sock"}
{"at":"2026-11-13T10:53:03.998Z","accepted":"172.22.0.1","to":"/sock/egress.sock"}
{"at":"2026-11-13T10:53:03.998Z","accepted":"172.22.0.1","to":"/sock/egress.sock"}
{"at":"2026-11-13T10:53:04.011Z","accepted":"172.22.0.1","to":"/sock/egress.sock"}
## the gateway stand-in's log during the probes
{"at":"2026-11-13T10:53:03.913Z","method":"GET","url":"/v1/ping","source":"127.0.0.1"}
{"at":"2026-11-13T10:53:04.002Z","method":"GET","url":"/v1/ping","source":"127.0.0.1"}
