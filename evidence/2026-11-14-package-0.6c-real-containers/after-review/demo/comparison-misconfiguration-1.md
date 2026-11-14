# Misconfiguration 1: the app (stand-in image) also on an ordinary bridge

| Id | Target | Expected | Actual | app, misconfigured |
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
| C5 | 127.0.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C6 | 127.0.0.1:41327 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C7 | 127.0.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C8 | 127.0.0.1:3128 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C9 | 127.0.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| X40859 | 127.0.0.11:40859 | connected: Docker's own name server, inside this container's own network namespace (127.0.0.11) | connected | PASS |
| M172.17.0.1:2024 | 172.17.0.1:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.17.0.1:4041 | 172.17.0.1:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:5432 | 172.17.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:34803 | 172.17.0.1:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:38369 | 172.17.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:38735 | 172.17.0.1:38735 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:41327 | 172.17.0.1:41327 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:41429 | 172.17.0.1:41429 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:46123 | 172.17.0.1:46123 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.24.0.1:2024 | 172.24.0.1:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.24.0.1:4041 | 172.24.0.1:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:5432 | 172.24.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:34803 | 172.24.0.1:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:38369 | 172.24.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:38735 | 172.24.0.1:38735 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:41327 | 172.24.0.1:41327 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:41429 | 172.24.0.1:41429 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M172.24.0.1:46123 | 172.24.0.1:46123 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M192.0.2.2:2024 | 192.0.2.2:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M192.0.2.2:4041 | 192.0.2.2:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:5432 | 192.0.2.2:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:34803 | 192.0.2.2:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:38369 | 192.0.2.2:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:38735 | 192.0.2.2:38735 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:41327 | 192.0.2.2:41327 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:41429 | 192.0.2.2:41429 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:46123 | 192.0.2.2:46123 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| D1 | registry.npmjs.org | no answer (refused, timed out, name not found, no name server, network unreachable) | found 12 addresses; 104.16.6.34, 104.16.9.34, 104.16.4.34 | FAIL |
| D2 | example.com | no answer (refused, timed out, name not found, no name server, network unreachable) | found 2 addresses; 172.66.147.243, 104.20.23.154 | FAIL |
| D3 | db | found \d+ address(es)?: the project's database, by its name on the data network | found 1 address; 172.25.0.1 | PASS |
| D4 | metadata.google.internal | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| D5 | registry.npmjs.org @1.1.1.1 | no answer (refused, timed out, name not found, no name server, network unreachable) | found 12 addresses; 104.16.6.34, 104.16.9.34, 104.16.4.34 | FAIL |
| D6 | example.com @1.1.1.1 | no answer (refused, timed out, name not found, no name server, network unreachable) | found 2 addresses; 172.66.147.243, 104.20.23.154 | FAIL |
| E1 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND); the proxy itself could not be reached | PASS |
| E2 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND); the proxy itself could not be reached | PASS |
| E3 | example.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND); the proxy itself could not be reached | PASS |
| E4 | registry.npmjs.org:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| E5 | example.com:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| W1 | egress:4010 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| F1 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED); the proxy itself could not be reached | PASS |
| F2 | github.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED); the proxy itself could not be reached | PASS |
| F3 | example.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED); the proxy itself could not be reached | PASS |
| F4 | github.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED); the proxy itself could not be reached | PASS |
| Papp:3171 | app:3171 | connected: the project's app, which listens on every address of its own container, data included (gap 119) | connected | PASS |
| Pdb:5432 | db:5432 | connected: its project's database (2.5) | connected | PASS |
| Pegress:3128 | egress:3128 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
| Pegress:4010 | egress:4010 | no answer (refused, timed out, name not found, no name server, network unreachable) | name not found (ENOTFOUND) | PASS |
