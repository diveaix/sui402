# NPM SDK Release Checklist

Sui402 should be published as small, stable SDK packages instead of asking users
to install or understand the full monorepo.

## Public packages

- `@sui402/client`: agent/client payment flow
- `@sui402/server`: Express provider middleware
- `@sui402/sui`: low-level Sui builders and verifiers
- `@sui402/protocol`: shared protocol primitives
- `@sui402/policy`: payment policy checks
- `@sui402/receipts`: signed receipt primitives
- `@sui402/storage`: durable state adapters
- `@sui402/indexer`: event indexer primitives and CLI
- `@sui402/gateway`: merchant/gateway helpers
- `@sui402/registry`: service listing helpers
- `@sui402/walrus`: Walrus export helpers
- `@sui402/mcp`: paid MCP helpers

The hosted apps remain private packages and should not be published:

- `@sui402/provider-api`
- `@sui402/console-api`
- `@sui402/dashboard`
- `@sui402/session-cli`
- `@sui402/create-sui402`

## Required release gates

Run this before any npm publish:

```powershell
npm run release:check
```

For package-content checks only:

```powershell
npm run build
npm run package:check
```

`package:check` runs `npm pack --dry-run --json` for every public package and
fails if a package would include source, tests, env files, logs, local state, or
missing entrypoints.

## Human decisions still required

Do not publish until these are resolved:

1. License: choose and commit the project license. Do not let an agent guess
   this; it affects downstream legal rights.
2. NPM org: create/verify the `@sui402` npm org and package ownership.
3. Access control: require publisher 2FA and avoid shared human tokens.
4. Provenance: publish from CI with npm provenance where possible.
5. Versioning: decide whether first public publish is `0.1.0-beta.1` or
   `0.1.0`.
6. Support policy: document what APIs are stable and what can change before
   `1.0.0`.

## Recommended first publish

Start with beta tags:

```powershell
npm publish -w @sui402/protocol --tag beta --access public
npm publish -w @sui402/policy --tag beta --access public
npm publish -w @sui402/sui --tag beta --access public
npm publish -w @sui402/client --tag beta --access public
npm publish -w @sui402/server --tag beta --access public
```

Publish dependency packages before packages that depend on them. Keep hosted
apps private.
