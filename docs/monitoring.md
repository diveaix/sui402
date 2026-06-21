# Production Monitoring

Sui402 provider and console services expose:

- `GET /health/live`: process liveness only.
- `GET /health/ready`: dependency-aware readiness. Returns `503` when a
  configured Redis/Postgres dependency probe fails.
- `GET /metrics`: Prometheus text exposition for uptime, request counts, and
  request-duration histograms.

Restrict `/metrics` to the monitoring network or scrape it through an
authenticated reverse proxy. It is intentionally not an application-facing
API.

## Metrics

```text
sui402_process_uptime_seconds
sui402_http_requests_total
sui402_http_request_duration_seconds_bucket
sui402_http_request_duration_seconds_sum
sui402_http_request_duration_seconds_count
```

Labels are limited to service, method, normalized route, and status. Dynamic
addresses, digests, numeric IDs, and long path segments are replaced to avoid
high-cardinality telemetry.

## Minimum Alerts

| Alert | Suggested threshold | Action |
| --- | --- | --- |
| Service not ready | readiness `503` for 2 minutes | page primary operator |
| HTTP 5xx rate | over 2% for 5 minutes and at least 20 requests | page primary operator |
| Payment replay responses | `409` on paid routes exceeds baseline or 5/minute | investigate client retries or proof abuse |
| Verification failures | `402` retries remain elevated after an initial challenge | inspect Sui RPC health and verifier logs |
| Policy violations | sustained `403` on paid routes | inspect merchant policy/config changes |
| p95 latency | over 2 seconds for 10 minutes | inspect Sui RPC, Redis, Postgres, and signer latency |
| Process restart loop | uptime repeatedly below 5 minutes | inspect deployment and dependency failures |
| Merchant review overdue | any pending application past `reviewDueAt` | notify merchant operations |
| Audit verification failure | `/v1/audit-events/verify` returns `ok: false` | preserve evidence and open a security incident |

Example PromQL for provider p95:

```promql
histogram_quantile(
  0.95,
  sum by (le) (
    rate(sui402_http_request_duration_seconds_bucket{
      service="sui402-provider-api"
    }[5m])
  )
)
```

Example 5xx ratio:

```promql
sum(rate(sui402_http_requests_total{status=~"5.."}[5m]))
/
sum(rate(sui402_http_requests_total[5m]))
```

## Dashboard Panels

At minimum, graph:

1. readiness and process uptime by service
2. request rate by route and status
3. p50, p95, and p99 request latency
4. `402`, `403`, `409`, and `5xx` rates on paid routes
5. Redis/Postgres availability and latency from infrastructure exporters
6. indexer cursor age and latest indexed checkpoint
7. settlement reconciliation mismatches and unsettled receipt counts
8. merchant application backlog and overdue reviews
9. most recent Walrus audit-head blob ID and anchored head hash

Application metrics do not replace Redis, Postgres, host, container, or Sui RPC
monitoring. Install the relevant infrastructure exporters in the deployment
environment.

## Logging

Provider requests already emit structured JSON with request ID, route, status,
duration, and client IP. Preserve logs in a centralized system with access
controls and retention appropriate for payment disputes. Do not log payment
signing material, wallet private keys, authorization headers, or raw OIDC
tokens.

The console audit log is separate from operational logs. Verify its hash chain
regularly and publish audit heads to Walrus on a schedule and before/after
privileged key rotations.
