# Production Certification

`npm run production:certify` is the local release gate for production-path
changes. It is intentionally stricter than `npm test`: it starts the Docker
Redis/Postgres stack, verifies both services, runs the normal repo gates, then
forces integration tests that would otherwise skip without live storage URLs.

```powershell
cd F:\Downloads\sui-hack
npm run infra:up
npm run production:certify
```

The command sets default local integration URLs when they are not already set:

- `SUI402_REDIS_URL=redis://localhost:6379`
- `SUI402_POSTGRES_URL=postgres://sui402:sui402@localhost:5432/sui402`
- `SUI402_CONSOLE_POSTGRES_URL=postgres://sui402:sui402@localhost:5432/sui402`
- `SUI402_INDEXER_POSTGRES_URL=postgres://sui402:sui402@localhost:5432/sui402`

It proves:

- Docker and Docker Compose are available.
- Redis responds to `PING`.
- Postgres accepts the `sui402` database connection.
- All TypeScript package checks pass.
- All non-integration unit tests pass.
- Redis/Postgres storage integration runs and passes.
- Indexer events persist into real Postgres with a durable cursor.
- Console API production-style Postgres storage persists merchants, indexer
  cursors, and audit events across restart.
- All packages and apps build.
- `sui move test --build-env testnet` passes.
- `sui move build --build-env testnet` passes.

Real talk: this is not a substitute for external audits or a mainnet incident
response program. It is the minimum local proof that the code paths we call
"production" are actually using durable infrastructure and not silently falling
back to memory or skipped tests.

Live public Sui gRPC event rehearsals should use a fresh checkpoint or a private
archive/fullnode source. Public fullnodes can prune old checkpoints, so a test
that depends on an old historical checkpoint will eventually become flaky even
when the indexer code is correct.
