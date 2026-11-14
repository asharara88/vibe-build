# Misconfiguration R4: the scripted engine's container given the out network

The engine service, a one-off container of the real image node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 (sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202), compared with the list `engine-scripted`.

| Id | Target | Expected | Actual | engine, misconfigured |
| --- | --- | --- | --- | --- |
| A1 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (EAI_AGAIN) | PASS |
| A2 | registry.npmjs.org:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (EAI_AGAIN) | PASS |
| A3 | example.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (EAI_AGAIN) | PASS |
| A4 | example.com:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (EAI_AGAIN) | PASS |
| A5 | github.com:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (EAI_AGAIN) | PASS |
| B1 | 1.1.1.1:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| B2 | 93.184.215.14:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| B3 | 93.184.215.14:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| B4 | 169.254.169.254:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| C1 | 1.1.1.1:22 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| C2 | 1.1.1.1:25 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| C3 | 1.1.1.1:53 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| C4 | 1.1.1.1:8080 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| C5 | 127.0.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C6 | 127.0.0.1:4010 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C7 | 127.0.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C8 | 127.0.0.1:3128 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| C9 | 127.0.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED) | PASS |
| X42407 | 127.0.0.11:42407 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| M172.17.0.1:2024 | 172.17.0.1:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M172.17.0.1:4041 | 172.17.0.1:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M172.17.0.1:5432 | 172.17.0.1:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M172.17.0.1:34803 | 172.17.0.1:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M172.17.0.1:35271 | 172.17.0.1:35271 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M172.17.0.1:37461 | 172.17.0.1:37461 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M172.17.0.1:38369 | 172.17.0.1:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M172.17.0.1:43013 | 172.17.0.1:43013 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M172.17.0.1:46861 | 172.17.0.1:46861 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M192.0.2.2:2024 | 192.0.2.2:2024 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M192.0.2.2:4041 | 192.0.2.2:4041 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M192.0.2.2:5432 | 192.0.2.2:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M192.0.2.2:34803 | 192.0.2.2:34803 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M192.0.2.2:35271 | 192.0.2.2:35271 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M192.0.2.2:37461 | 192.0.2.2:37461 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M192.0.2.2:38369 | 192.0.2.2:38369 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M192.0.2.2:43013 | 192.0.2.2:43013 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| M192.0.2.2:46861 | 192.0.2.2:46861 | no answer (refused, timed out, name not found, no name server, network unreachable) | network unreachable (ENETUNREACH) | PASS |
| D1 | registry.npmjs.org | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (EAI_AGAIN) | PASS |
| D2 | example.com | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (EAI_AGAIN) | PASS |
| D3 | db | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (EAI_AGAIN) | PASS |
| D4 | metadata.google.internal | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (EAI_AGAIN) | PASS |
| D5 | registry.npmjs.org @1.1.1.1 | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (ECONNREFUSED) | PASS |
| D6 | example.com @1.1.1.1 | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (ECONNREFUSED) | PASS |
| E1 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | proxy answered 200 | FAIL |
| E2 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 200; server: cloudflare | FAIL |
| E3 | example.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | proxy answered 403; says: "egress refused: example.com is not an allowed host" | FAIL |
| E4 | registry.npmjs.org:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 405; says: "agent-proxy relay: this proxy only accepts HTTPS CONNECT tunnels. Plain-HTTP/absolute-form requests are not su" | FAIL |
| E5 | example.com:80 | no answer (refused, timed out, name not found, no name server, network unreachable) | HTTP 403; says: "egress refused: example.com is not an allowed host" | FAIL |
| W1 | egress:4010 | no answer (refused, timed out, name not found, no name server, network unreachable) | connection reset (ECONNRESET) | FAIL |
| F1 | registry.npmjs.org:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED); the proxy itself could not be reached | PASS |
| F2 | github.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED); the proxy itself could not be reached | PASS |
| F3 | example.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED); the proxy itself could not be reached | PASS |
| F4 | github.com:443 | no answer (refused, timed out, name not found, no name server, network unreachable) | refused (ECONNREFUSED); the proxy itself could not be reached | PASS |
| Papp:3191 | app:3191 | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (EAI_AGAIN) | PASS |
| Pdb:5432 | db:5432 | no answer (refused, timed out, name not found, no name server, network unreachable) | no name server answered (EAI_AGAIN) | PASS |
| Pegress:3128 | egress:3128 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
| Pegress:4010 | egress:4010 | no answer (refused, timed out, name not found, no name server, network unreachable) | connected | FAIL |
