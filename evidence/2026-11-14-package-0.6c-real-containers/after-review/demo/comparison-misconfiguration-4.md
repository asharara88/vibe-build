# Misconfiguration 4: the stream container (check) on the machine's network

| Id | Target | Expected | Actual | check, misconfigured |
| --- | --- | --- | --- | --- |
| A1 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | FAIL |
| A2 | registry.npmjs.org:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 301; server: cloudflare; location: https://registry.npmjs.org/-/ping | FAIL |
| A3 | example.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | FAIL |
| A4 | example.com:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 200; server: cloudflare | FAIL |
| A5 | github.com:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 301; location: https://github.com/ | FAIL |
| B1 | 1.1.1.1:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| B2 | 104.20.23.154:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| B3 | 104.20.23.154:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 200; server: cloudflare | FAIL |
| B4 | 169.254.169.254:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 403; x-deny-reason: private_dest_ip; says: "Destination IP is in a private/reserved range" | FAIL |
| C1 | 1.1.1.1:22 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C2 | 1.1.1.1:25 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C3 | 1.1.1.1:53 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C4 | 1.1.1.1:8080 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C5 | 127.0.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| C6 | 127.0.0.1:41327 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| C7 | 127.0.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| C8 | 127.0.0.1:3128 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C9 | 127.0.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| X2024 | 127.0.0.1:2024 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X4041 | 127.0.0.1:4041 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X34803 | 127.0.0.1:34803 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X38735 | 127.0.0.1:38735 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X41429 | 127.0.0.1:41429 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X44549 | 127.0.0.1:44549 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| X46123 | 127.0.0.1:46123 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| M172.17.0.1:2024 | 172.17.0.1:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.17.0.1:4041 | 172.17.0.1:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:5432 | 172.17.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:34803 | 172.17.0.1:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:38369 | 172.17.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:38735 | 172.17.0.1:38735 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:41327 | 172.17.0.1:41327 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:41429 | 172.17.0.1:41429 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:44549 | 172.17.0.1:44549 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:46123 | 172.17.0.1:46123 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.24.0.1:2024 | 172.24.0.1:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.24.0.1:4041 | 172.24.0.1:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:5432 | 172.24.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:34803 | 172.24.0.1:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:38369 | 172.24.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:38735 | 172.24.0.1:38735 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:41327 | 172.24.0.1:41327 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:41429 | 172.24.0.1:41429 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:44549 | 172.24.0.1:44549 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:46123 | 172.24.0.1:46123 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.27.0.1:2024 | 172.27.0.1:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.27.0.1:4041 | 172.27.0.1:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:5432 | 172.27.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:34803 | 172.27.0.1:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:38369 | 172.27.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:38735 | 172.27.0.1:38735 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:41327 | 172.27.0.1:41327 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:41429 | 172.27.0.1:41429 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:44549 | 172.27.0.1:44549 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.27.0.1:46123 | 172.27.0.1:46123 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M192.0.2.2:2024 | 192.0.2.2:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M192.0.2.2:4041 | 192.0.2.2:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:5432 | 192.0.2.2:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:34803 | 192.0.2.2:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:38369 | 192.0.2.2:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:38735 | 192.0.2.2:38735 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:41327 | 192.0.2.2:41327 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:41429 | 192.0.2.2:41429 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:44549 | 192.0.2.2:44549 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:46123 | 192.0.2.2:46123 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| D1 | registry.npmjs.org | no answer (refused, timed out, name not found, no name server, network unreachable) | found 12 addresses; 104.16.0.34, 104.16.4.34, 104.16.5.34 | FAIL |
| D2 | example.com | no answer (refused, timed out, name not found, no name server, network unreachable) | found 2 addresses; 172.66.147.243, 104.20.23.154 | FAIL |
| D3 | db | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| D4 | metadata.google.internal | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| D5 | registry.npmjs.org @1.1.1.1 | no answer (refused, timed out, name not found, no name server, network unreachable) | found 12 addresses; 104.16.0.34, 104.16.4.34, 104.16.5.34 | FAIL |
| D6 | example.com @1.1.1.1 | no answer (refused, timed out, name not found, no name server, network unreachable) | found 2 addresses; 172.66.147.243, 104.20.23.154 | FAIL |
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
