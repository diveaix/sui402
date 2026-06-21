# Security Policy

## Supported Versions

Sui402 is pre-1.0. Security fixes are applied to the active main development
line until versioned release branches exist.

## Reporting a Vulnerability

Do not open public issues for vulnerabilities that could affect payment
verification, replay protection, signing, session safety, admin access, or
merchant settlement.

Report privately to the maintainers with:

- affected package or app
- reproduction steps
- expected vs actual behavior
- impact assessment
- suggested fix, if known

## Security Scope

High-priority areas:

- Sui transaction and session verification
- challenge and transaction digest replay protection
- Move payment-session logic
- Redis/Postgres production storage requirements
- admin API authentication
- MCP payment proof handling
- hosted gateway merchant isolation
- policy checks before wallet signing

Out of scope for this repository alone:

- legal determinations
- third-party wallet security
- third-party Sui RPC correctness
- production infrastructure outside this codebase

## Audit Status

No third-party audit has been completed yet. Do not market this repository as
audited until both the Move package and TypeScript services have been reviewed
by qualified external reviewers.
