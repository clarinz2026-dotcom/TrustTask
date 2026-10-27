# ADR 0001: Use a modular monolith

- **Status:** Accepted for the MVP
- **Date:** 2026-10-27

## Context

TrustTask needs several related workflows with strong transaction and audit requirements, while its scale and operational needs are not yet established. Distributed services would add deployment and consistency costs without a demonstrated benefit.

## Decision

Use one TypeScript API deployment, one PostgreSQL database, and explicit internal module boundaries. Isolate external capabilities behind adapter interfaces when they are introduced.

## Consequences

Cross-module changes can use PostgreSQL transactions and local function calls. Teams must preserve module boundaries and avoid embedding domain rules in routes. Split services only when independently evidenced scale, security, or ownership needs justify the operational cost.
