# Legal and Compliance Notes

These notes are placeholders for counsel and product review. They are not legal
advice.

Sui402 can be used for machine payments, paid APIs, MCP tools, hosted gateways,
and agent-managed spending policies. Some deployments may involve financial
automation, digital assets, cross-border payments, tax reporting, consumer
protection, sanctions compliance, or money transmission analysis.

Before a production launch with real users or mainnet funds, review:

- custody model
- whether users or agents control signing keys
- whether the product recommends trades or only processes payments
- supported jurisdictions
- sanctions and abuse controls
- seller onboarding and fraud response
- data retention for payment logs
- user-facing terms
- privacy policy
- incident response obligations

Recommended product posture for early releases:

- non-custodial
- user- or agent-controlled signing
- explicit spending policies
- transparent payment receipts
- no investment advice
- no autonomous trading defaults
- clear mainnet risk warnings
