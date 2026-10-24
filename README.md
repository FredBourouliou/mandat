# Mandat

Spending mandates for AI shopping agents on PayPal: the agent proposes, a deterministic guard decides and pays, and every step is sealed into a verifiable receipt that the merchant can use as evidence in a dispute.

Work in progress for the PayPal AI Hackathon (sandbox only).

## Packages

- `packages/guard`: mandate evaluation, idempotent PayPal Orders v2 execution (`custom_id` = mandate hash), hash-chained Ed25519 receipt, PDF evidence pack.

```sh
pnpm install
pnpm test
```

## License

MIT
