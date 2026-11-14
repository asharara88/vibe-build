# Misconfiguration 4: the stream container (check) on the machine's network

| Id | Target | Expected | Actual | check, misconfigured |
| --- | --- | --- | --- | --- |
| A1 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | FAIL |
| A2 | registry.npmjs.org:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 301; server: cloudflare; location: https://registry.npmjs.org/-/ping | FAIL |
| A3 | example.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | FAIL |
| A4 | example.com:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 200; server: cloudflare | FAIL |
| A5 | github.com:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 301; location: https://github.com/ | FAIL |
| B1 | 1.1.1.1:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| B2 | 172.66.147.243:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| B3 | 172.66.147.243:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 200; server: cloudflare | FAIL |
| B4 | 169.254.169.254:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 403; x-deny-reason: private_dest_ip; says: "Destination IP is in a private/reserved range" | FAIL |
| C1 | 1.1.1.1:22 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C2 | 1.1.1.1:25 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C3 | 1.1.1.1:53 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C4 | 1.1.1.1:8080 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C5 | 127.0.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| C6 | 127.0.0.1:35271 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| C7 | 127.0.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| C8 | 127.0.0.1:3128 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C9 | 127.0.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| X2024 | 127.0.0.1:2024 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X4041 | 127.0.0.1:4041 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X34803 | 127.0.0.1:34803 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X40475 | 127.0.0.1:40475 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X43013 | 127.0.0.1:43013 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X43049 | 127.0.0.1:43049 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X46861 | 127.0.0.1:46861 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| M172.17.0.1:2024 | 172.17.0.1:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.17.0.1:4041 | 172.17.0.1:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:5432 | 172.17.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:34803 | 172.17.0.1:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:35271 | 172.17.0.1:35271 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:38369 | 172.17.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:40475 | 172.17.0.1:40475 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:43013 | 172.17.0.1:43013 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:43049 | 172.17.0.1:43049 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:46861 | 172.17.0.1:46861 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.25.0.1:2024 | 172.25.0.1:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.25.0.1:4041 | 172.25.0.1:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.25.0.1:5432 | 172.25.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.25.0.1:34803 | 172.25.0.1:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.25.0.1:35271 | 172.25.0.1:35271 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.25.0.1:38369 | 172.25.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.25.0.1:40475 | 172.25.0.1:40475 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.25.0.1:43013 | 172.25.0.1:43013 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.25.0.1:43049 | 172.25.0.1:43049 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.25.0.1:46861 | 172.25.0.1:46861 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.27.0.1:2024 | 172.27.0.1:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.27.0.1:4041 | 172.27.0.1:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:5432 | 172.27.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:34803 | 172.27.0.1:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:35271 | 172.27.0.1:35271 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:38369 | 172.27.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:40475 | 172.27.0.1:40475 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:43013 | 172.27.0.1:43013 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:43049 | 172.27.0.1:43049 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:46861 | 172.27.0.1:46861 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M192.0.2.2:2024 | 192.0.2.2:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M192.0.2.2:4041 | 192.0.2.2:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:5432 | 192.0.2.2:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:34803 | 192.0.2.2:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:35271 | 192.0.2.2:35271 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:38369 | 192.0.2.2:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:40475 | 192.0.2.2:40475 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:43013 | 192.0.2.2:43013 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:43049 | 192.0.2.2:43049 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:46861 | 192.0.2.2:46861 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| D1 | registry.npmjs.org | no answer (refused, timed out, name not found, no name server, network unreachable) | found 12 addresses; 104.16.0.34, 104.16.3.34, 104.16.4.34 | FAIL |
| D2 | example.com | no answer (refused, timed out, name not found, no name server, network unreachable) | found 2 addresses; 104.20.23.154, 172.66.147.243 | FAIL |
| D3 | db | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| D4 | metadata.google.internal | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| D5 | registry.npmjs.org @1.1.1.1 | no answer (refused, timed out, name not found, no name server, network unreachable) | found 12 addresses; 104.16.0.34, 104.16.3.34, 104.16.4.34 | FAIL |
| D6 | example.com @1.1.1.1 | no answer (refused, timed out, name not found, no name server, network unreachable) | found 2 addresses; 104.20.23.154, 172.66.147.243 | FAIL |
| E1 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND); the proxy itself could not be reached | PASS |
| E2 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND); the proxy itself could not be reached | PASS |
| E3 | example.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND); the proxy itself could not be reached | PASS |
| E4 | registry.npmjs.org:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| E5 | example.com:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| W1 | egress:4010 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| F1 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | proxy answered 200 | FAIL |
| F2 | github.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | proxy answered 200 | FAIL |
| F3 | example.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | proxy answered 200 | FAIL |
| F4 | github.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN); the proxy answered 200; the error came after | FAIL |
| Papp:3171 | app:3171 | connected: the project's app, on the front network (a stream's only peer) | name not found (ENOTFOUND) | FAIL |
| Pdb:5432 | db:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| Pegress:3128 | egress:3128 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| Pegress:4010 | egress:4010 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
