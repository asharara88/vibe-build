# Item 6: the relay WITH its source check (only 10.231.60.2, the egress proxy's pinned address on ext), seen from the egress proxy, from a container on another Compose project's ordinary bridge (m06c-other_ext, 10.231.61.0/28), from Docker's default network, and from the host network. 2026-11-13T10:47:59Z

Answered (an UPPER-CASE word): a connection opened, an address was found, an HTTP status came back, a proxy answered, or a tunnel opened.
Not answered: unreach (no route), refused, timeout, no-name, no-dns, error.

| attempt | egress | other-project-ext | default-bridge | host-network |
| --- | --- | --- | --- | --- |
| R1 | TUN>200 | connection-reset | connection-reset | OPEN-CLOSED |
| R3 | TUN>cert-untrusted | connection-reset | connection-reset | OPEN-CLOSED |
| R2 | HTTP200 | connection-reset | connection-reset | connection-reset |

## egress
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 10.231.60.2","eth1: IPv4 172.18.0.1"]
- interfaces in /sys/class/net: ["eth0","eth1","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 0.0.0.0 gw 10.231.60.1 mask 0.0.0.0","eth0 dest 10.231.60.0 gw 0.0.0.0 mask 255.255.255.240","eth1 dest 172.18.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: true
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 3 of 3
  - R1 (the relay's session-proxy port: a tunnel to the registry, then HTTPS GET): tunnel open; inside it: HTTP/1.1 200 OK — proxy said: HTTP/1.1 200 Connection Established; certificate trusted with the container's own store
  - R3 (the relay's session-proxy port: a tunnel to a host outside the project's list (github.com)): tunnel open; inside it: certificate not trusted — proxy said: HTTP/1.1 200 Connection Established
  - R2 (the relay's gateway port): HTTP 200 — server: m06c-gateway-standin; says: "{"answeredBy":"m06c gateway stand-in","path":"/v1/ping"}"

## other-project-ext
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 10.231.61.2"]
- interfaces in /sys/class/net: ["eth0","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 0.0.0.0 gw 10.231.61.1 mask 0.0.0.0","eth0 dest 10.231.61.0 gw 0.0.0.0 mask 255.255.255.240"]
- default route present: true
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 127.0.0.11"]
- answered: 0 of 3

## default-bridge
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 172.17.0.2"]
- interfaces in /sys/class/net: ["eth0","lo"]
- IPv4 routes (/proc/net/route): ["eth0 dest 0.0.0.0 gw 172.17.0.1 mask 0.0.0.0","eth0 dest 172.17.0.0 gw 0.0.0.0 mask 255.255.0.0"]
- default route present: true
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 8.8.8.8","nameserver 8.8.4.4"]
- answered: 0 of 3

## host-network
- uid: 1000
- interfaces (up, as Node lists them): ["lo: IPv4 127.0.0.1","eth0: IPv4 192.0.2.2","docker0: IPv4 172.17.0.1","br-eb770dd6da9d: IPv4 10.231.60.1","br-478ee2db8dbc: IPv4 172.21.0.1","br-bc16b8f7bd58: IPv4 10.231.61.1"]
- interfaces in /sys/class/net: ["br-06e6e23ec069","br-1522af90ed68","br-478ee2db8dbc","br-752ebc27944f","br-bc16b8f7bd58","br-eb770dd6da9d","docker0","eth0","ifb0","ifb1","lo","veth28b82a2","veth298ae24","veth5254d02","veth52f9f89","veth6943e46","veth772ef25","veth8ef4ef6","veth96f4821","vethab6cccb","vethacceba1","vethc2e4077","vethc9f0b05","vethf24d91b","vethfba90bd"]
- IPv4 routes (/proc/net/route): ["eth0 dest 0.0.0.0 gw 192.0.2.1 mask 0.0.0.0","br-eb770dd6da9d dest 10.231.60.0 gw 0.0.0.0 mask 255.255.255.240","br-bc16b8f7bd58 dest 10.231.61.0 gw 0.0.0.0 mask 255.255.255.240","docker0 dest 172.17.0.0 gw 0.0.0.0 mask 255.255.0.0","br-478ee2db8dbc dest 172.21.0.0 gw 0.0.0.0 mask 255.255.0.0","eth0 dest 192.0.2.0 gw 0.0.0.0 mask 255.255.255.0"]
- default route present: true
- ip_forward (/proc/sys/net/ipv4/ip_forward): "1"
- IPv6 in this network namespace: {"/proc/net/if_inet6":"(absent)","/proc/sys/net/ipv6":"absent"}
- name servers (/etc/resolv.conf): ["nameserver 8.8.8.8","nameserver 8.8.4.4"]
- answered: 2 of 3
  - R1 (the relay's session-proxy port: a tunnel to the registry, then HTTPS GET): connected, then closed by the other end — nothing came back
  - R3 (the relay's session-proxy port: a tunnel to a host outside the project's list (github.com)): connected, then closed by the other end — nothing came back

## the relay's log for this run
{"at":"2026-11-13T10:47:59.374Z","port":13128,"source":"172.17.0.2","decision":"refused: source not allowed"}
{"at":"2026-11-13T10:47:59.375Z","port":14010,"source":"172.17.0.2","decision":"refused: source not allowed"}
{"at":"2026-11-13T10:47:59.375Z","port":13128,"source":"172.17.0.2","decision":"refused: source not allowed"}
{"at":"2026-11-13T10:47:59.382Z","port":13128,"source":"10.231.60.2","decision":"accepted, forwarded to session proxy"}
{"at":"2026-11-13T10:47:59.385Z","port":13128,"source":"10.231.60.2","decision":"accepted, forwarded to session proxy"}
{"at":"2026-11-13T10:47:59.387Z","port":14010,"source":"10.231.60.2","decision":"accepted, forwarded to 127.0.0.1:14610"}
{"at":"2026-11-13T10:47:59.417Z","port":13128,"source":"10.231.61.2","decision":"refused: source not allowed"}
{"at":"2026-11-13T10:47:59.419Z","port":14010,"source":"10.231.61.2","decision":"refused: source not allowed"}
{"at":"2026-11-13T10:47:59.423Z","port":13128,"source":"10.231.61.2","decision":"refused: source not allowed"}
{"at":"2026-11-13T10:47:59.454Z","port":13128,"source":"192.0.2.2","decision":"refused: source not allowed"}
{"at":"2026-11-13T10:47:59.455Z","port":13128,"source":"192.0.2.2","decision":"refused: source not allowed"}
{"at":"2026-11-13T10:47:59.458Z","port":14010,"source":"192.0.2.2","decision":"refused: source not allowed"}
