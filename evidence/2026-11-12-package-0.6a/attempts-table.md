| Id | Target | What | app container (host network) | tools container (host network) | engine container (no network) | comparison: default network, not a project container |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | registry.npmjs.org:443 | a host the egress list allows, HTTPS | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | HTTP 200 | no name server answered (EAI_AGAIN) | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) |
| A2 | registry.npmjs.org:80 | a host the egress list allows, plain HTTP | HTTP 301 | HTTP 301 | no name server answered (EAI_AGAIN) | HTTP 301 |
| A3 | example.com:443 | a host the egress list refuses, HTTPS | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| A4 | example.com:80 | a host the egress list refuses, plain HTTP | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| A5 | github.com:80 | another host the egress list refuses, plain HTTP | HTTP 301 | HTTP 301 | no name server answered (EAI_AGAIN) | HTTP 301 |
| B1 | 1.1.1.1:443 | a public address, HTTPS port | connected | connected | network unreachable (ENETUNREACH) | connected |
| B2 | 93.184.215.14:80 | example.com's address, HTTP port | connected | connected | network unreachable (ENETUNREACH) | connected |
| B3 | 93.184.215.14:80 | example.com's address, plain HTTP | HTTP 403 | HTTP 403 | network unreachable (ENETUNREACH) | HTTP 403 |
| B4 | 169.254.169.254:80 | the cloud's machine-information address (link-local) | HTTP 403 | HTTP 403 | network unreachable (ENETUNREACH) | HTTP 403 |
| C1 | 1.1.1.1:22 | an outside address, port 22 (remote login) | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C2 | 1.1.1.1:25 | an outside address, port 25 (mail) | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C3 | 1.1.1.1:53 | an outside address, port 53 (name service over TCP) | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C4 | 1.1.1.1:8080 | an outside address, port 8080 | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C5 | 127.0.0.1:5432 | the builder's own database (PostgreSQL) | connected | connected | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| C6 | 127.0.0.1:4010 | the model gateway's port | connected | connected | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| C7 | 127.0.0.1:5562 | the project's database | connected | connected | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| C8 | 127.0.0.1:3128 | the project's egress proxy | connected | connected | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| C9 | 127.0.0.1:45887 | the cloud session's proxy | connected | connected | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| X2024 | 127.0.0.1:2024 | another listening port, seen inside the container | connected | connected | not tried | not tried |
| X33427 | 127.0.0.1:33427 | another listening port, seen inside the container | connected | connected | not tried | not tried |
| D1 | registry.npmjs.org | an outside name the egress list allows | found 12 addresses | found 12 addresses | no name server answered (EAI_AGAIN) | found 12 addresses |
| D2 | example.com | an outside name the egress list refuses | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| D3 | db | an internal-looking name: the database's name on the server profile | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| D4 | metadata.google.internal | an internal-looking name: the cloud's machine-information service | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| D5 | registry.npmjs.org @1.1.1.1 | an allowed name, asking an outside name server directly | found 12 addresses | found 12 addresses | no name server answered (ECONNREFUSED) | found 12 addresses |
| D6 | example.com @1.1.1.1 | a refused name, asking an outside name server directly | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (ECONNREFUSED) | name not found (ENOTFOUND) |
| E1 | registry.npmjs.org:443 | an allowed host, tunnel | proxy answered 200 | proxy answered 200 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| E2 | registry.npmjs.org:443 | an allowed host, HTTPS inside the tunnel | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | HTTP 200 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| E3 | example.com:443 | a refused host, tunnel | proxy answered 403 | proxy answered 403 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| E4 | registry.npmjs.org:80 | an allowed host, plain HTTP | HTTP 405 | HTTP 405 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| E5 | example.com:80 | a refused host, plain HTTP | HTTP 403 | HTTP 403 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| F1 | registry.npmjs.org:443 | a host the egress list allows | proxy answered 200 | proxy answered 200 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| F2 | github.com:443 | a host the egress list refuses | proxy answered 200 | proxy answered 200 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| F3 | example.com:443 | another host the egress list refuses | proxy answered 403 | proxy answered 403 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| F4 | github.com:443 | a host the egress list refuses, HTTPS inside the tunnel | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | HTTP 200 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
