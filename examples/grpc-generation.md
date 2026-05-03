# Example: Cross-Language Code Generation (Rust gRPC → TypeScript)

This example shows how to use Hydra Workers to parallelize cross-language code generation — generating TypeScript clients from a Rust gRPC service.

## Scenario

Your backend team maintains a Rust gRPC service (Nexus). The frontend needs TypeScript client bindings, type definitions, and integration tests. These three concerns are independent and can be worked on simultaneously.

## Setup

```
nexus/
├── proto/              # Protobuf definitions (source of truth)
│   ├── user.proto
│   ├── billing.proto
│   └── analytics.proto
├── src/                # Rust server implementation
├── clients/
│   └── typescript/     # Target: generated TS client
└── tests/
    └── integration/    # Target: integration tests
```

## Step 1: Spawn Three Workers

From the Copilot or terminal:

```bash
# Worker 1: Generate TypeScript types and client stubs from .proto files
hydra worker create --repo . --branch gen/ts-client \
  --agent claude \
  --task "Generate TypeScript client code from the proto/ definitions. Create:
    1. Type definitions matching each .proto message
    2. Client classes with typed methods for each RPC
    3. Serialization/deserialization helpers
    Output to clients/typescript/src/. Use grpc-js as the transport."

# Worker 2: Generate validation and middleware
hydra worker create --repo . --branch gen/ts-validation \
  --agent claude \
  --task "Based on the proto/ definitions, generate:
    1. Zod schemas matching each proto message (clients/typescript/src/schemas/)
    2. Runtime validation middleware for the TS client
    3. Error type mapping from gRPC status codes to typed errors
    Follow the patterns in clients/typescript/ if any exist."

# Worker 3: Generate integration tests
hydra worker create --repo . --branch gen/ts-tests \
  --agent codex \
  --task "Write integration tests for the TypeScript gRPC client. For each RPC in proto/:
    1. Test happy path with valid data
    2. Test error cases (invalid input, not found, permission denied)
    3. Test streaming RPCs if any
    Output to tests/integration/typescript/. Use vitest."
```

## Step 2: Monitor the Pipeline

```
Hydra
├── Workers
│   ├── ● gen/ts-client     — Claude — generating client stubs
│   ├── ● gen/ts-validation — Claude — generating Zod schemas
│   └── ● gen/ts-tests      — Codex  — writing integration tests
```

Since the test Worker might need the generated client types, you can send it a follow-up once the client Worker finishes:

```bash
# After gen/ts-client completes, tell the test Worker where to find types
tmux send-keys -t nexus-a1b2c3d4_gen-ts-tests \
  "The generated client types are now at clients/typescript/src/. Import them in your tests for type-safe assertions." Enter
```

## Step 3: Merge in Order

Because the branches have a dependency chain, merge in order:

1. **gen/ts-client** first — provides the base types
2. **gen/ts-validation** second — builds on the types
3. **gen/ts-tests** last — tests everything

```bash
# Rebase validation onto client before merging
git -C .hydra/worktrees/gen-ts-validation rebase gen/ts-client
# Rebase tests onto validation before merging
git -C .hydra/worktrees/gen-ts-tests rebase gen/ts-validation
```

## When to Use This Pattern

- **Protobuf/OpenAPI code generation** — generate clients in multiple languages simultaneously
- **Database schema migrations** — generate ORM models, migration files, and seed data in parallel
- **SDK generation** — generate SDKs for different platforms (iOS, Android, Web) from a shared spec
- **Documentation generation** — generate API docs, type docs, and example code from the same source

## Tips

- **Pin the source of truth.** Workers should read from `proto/` or `openapi.yaml` — not from each other's output.
- **Use different agents for different strengths.** Claude for nuanced type generation, Codex for boilerplate test writing.
- **Rebase, don't merge between Workers.** Keeps the history linear and makes conflicts easier to resolve.
