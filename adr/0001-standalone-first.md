# ADR-0001: Standalone repository, destination recorded

Status: accepted. Date: 2026-07-10.

## Decision

Argelander develops in a standalone monorepo under a personal org, with NASA-AMMOS or the Open Mission Foundation scope recorded as the deliberate destination. Forks of MMGIS, Bessel, or Cosmolabe are never the repository of record; an MMGIS fork may exist only as a disposable integration testbed, and a Cosmolabe-hosted demo arrives via an examples app pinning Cosmolabe at a commit or a short-lived integration branch agreed with its owner.

## Rationale

Forking MMGIS inverts the dependency and chains demos to a server-backed host. Forking Bessel couples this schedule to the merge critical path mid bake-off. Forking Cosmolabe diverges against a base at its most fluid, forfeits renderer-agnosticism by incubation inside one renderer, and sidesteps the CODEOWNERS contract the merge established. Standalone-first is Decision F of the survey; convergence is by contract.
