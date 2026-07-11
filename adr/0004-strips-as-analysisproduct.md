# ADR-0004: Strips publish as AnalysisProduct records

Status: accepted. Date: 2026-07-10.

## Decision

The strip serializes as an AnalysisProduct with `kind: "acquisition-strip"` and the provenance authority field, so acquisition products flow through the same plumbing as other Bessel results. AGE-20.

## Rationale

The merge places provenance authority in the product contract; adopting it makes convergence a type-level binding and gives every strip mission, instrument, mode, and pass identity for free.
