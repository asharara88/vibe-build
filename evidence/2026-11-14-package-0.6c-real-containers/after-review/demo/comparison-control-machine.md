# comparison: the machine's own network

| Id | Target | Expected | Actual | comparison: the machine's own network |
| --- | --- | --- | --- | --- |
| A1 | registry.npmjs.org:443 | not compared (comparison container) | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | PASS |
| A2 | registry.npmjs.org:80 | not compared (comparison container) | HTTP 301; server: cloudflare; location: https://registry.npmjs.org/-/ping | PASS |
| A3 | example.com:443 | not compared (comparison container) | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | PASS |
| A4 | example.com:80 | not compared (comparison container) | HTTP 200; server: cloudflare | PASS |
| A5 | github.com:80 | not compared (comparison container) | HTTP 301; location: https://github.com/ | PASS |
| B1 | 1.1.1.1:443 | not compared (comparison container) | connected | PASS |
| B2 | 104.20.23.154:80 | not compared (comparison container) | connected | PASS |
| B3 | 104.20.23.154:80 | not compared (comparison container) | HTTP 200; server: cloudflare | PASS |
| B4 | 169.254.169.254:80 | not compared (comparison container) | HTTP 403; x-deny-reason: private_dest_ip; says: "Destination IP is in a private/reserved range" | PASS |
| C1 | 1.1.1.1:22 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| C2 | 1.1.1.1:25 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| C3 | 1.1.1.1:53 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| C4 | 1.1.1.1:8080 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| C5 | 127.0.0.1:5432 | not compared (comparison container) | connected | PASS |
| C6 | 127.0.0.1:41327 | not compared (comparison container) | connected | PASS |
| C7 | 127.0.0.1:5432 | not compared (comparison container) | connected | PASS |
| C8 | 127.0.0.1:3128 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| C9 | 127.0.0.1:38369 | not compared (comparison container) | connected | PASS |
| X2024 | 127.0.0.1:2024 | not compared (comparison container) | connected | PASS |
| X4041 | 127.0.0.1:4041 | not compared (comparison container) | connected | PASS |
| X34803 | 127.0.0.1:34803 | not compared (comparison container) | connected | PASS |
| X38735 | 127.0.0.1:38735 | not compared (comparison container) | connected | PASS |
| X41429 | 127.0.0.1:41429 | not compared (comparison container) | connected | PASS |
| X46123 | 127.0.0.1:46123 | not compared (comparison container) | connected | PASS |
| M172.17.0.1:2024 | 172.17.0.1:2024 | not compared (comparison container) | connected | PASS |
| M172.17.0.1:4041 | 172.17.0.1:4041 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:5432 | 172.17.0.1:5432 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:34803 | 172.17.0.1:34803 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:38369 | 172.17.0.1:38369 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:38735 | 172.17.0.1:38735 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:41327 | 172.17.0.1:41327 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:41429 | 172.17.0.1:41429 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M172.17.0.1:46123 | 172.17.0.1:46123 | connected: the harness's own listener, on every address of the machine, reached at each machine address | connected | PASS |
| M192.0.2.2:2024 | 192.0.2.2:2024 | not compared (comparison container) | connected | PASS |
| M192.0.2.2:4041 | 192.0.2.2:4041 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:5432 | 192.0.2.2:5432 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:34803 | 192.0.2.2:34803 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:38369 | 192.0.2.2:38369 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:38735 | 192.0.2.2:38735 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:41327 | 192.0.2.2:41327 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:41429 | 192.0.2.2:41429 | not compared (comparison container) | refused (ECONNREFUSED) | PASS |
| M192.0.2.2:46123 | 192.0.2.2:46123 | connected: the harness's own listener, on every address of the machine, reached at each machine address | connected | PASS |
| D1 | registry.npmjs.org | not compared (comparison container) | found 12 addresses; 104.16.6.34, 104.16.9.34, 104.16.4.34 | PASS |
| D2 | example.com | not compared (comparison container) | found 2 addresses; 172.66.147.243, 104.20.23.154 | PASS |
| D3 | db | not compared (comparison container) | name not found (ENOTFOUND) | PASS |
| D4 | metadata.google.internal | not compared (comparison container) | name not found (ENOTFOUND) | PASS |
| D5 | registry.npmjs.org @1.1.1.1 | not compared (comparison container) | found 12 addresses; 104.16.6.34, 104.16.9.34, 104.16.4.34 | PASS |
| D6 | example.com @1.1.1.1 | not compared (comparison container) | found 2 addresses; 172.66.147.243, 104.20.23.154 | PASS |
| E1 | registry.npmjs.org:443 | not compared (comparison container) | name not found (ENOTFOUND); the proxy itself could not be reached | PASS |
| E2 | registry.npmjs.org:443 | not compared (comparison container) | name not found (ENOTFOUND); the proxy itself could not be reached | PASS |
| E3 | example.com:443 | not compared (comparison container) | name not found (ENOTFOUND); the proxy itself could not be reached | PASS |
| E4 | registry.npmjs.org:80 | not compared (comparison container) | name not found (ENOTFOUND) | PASS |
| E5 | example.com:80 | not compared (comparison container) | name not found (ENOTFOUND) | PASS |
| W1 | egress:4010 | not compared (comparison container) | name not found (ENOTFOUND) | PASS |
| F1 | registry.npmjs.org:443 | not compared (comparison container) | proxy answered 200 | PASS |
| F2 | github.com:443 | not compared (comparison container) | proxy answered 200 | PASS |
| F3 | example.com:443 | not compared (comparison container) | proxy answered 200 | PASS |
| F4 | github.com:443 | not compared (comparison container) | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN); the proxy answered 200; the error came after | PASS |
| Papp:3171 | app:3171 | not compared (comparison container) | name not found (ENOTFOUND) | PASS |
| Pdb:5432 | db:5432 | not compared (comparison container) | name not found (ENOTFOUND) | PASS |
| Pegress:3128 | egress:3128 | not compared (comparison container) | name not found (ENOTFOUND) | PASS |
| Pegress:4010 | egress:4010 | not compared (comparison container) | name not found (ENOTFOUND) | PASS |
