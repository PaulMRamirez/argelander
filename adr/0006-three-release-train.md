# ADR-0006: Three release train and WebGPU path

Status: proposed, blocked. Date: 2026-07-10.

## Decision (proposed)

The Three adapter targets the same Three release train and WebGPU-with-WebGL2-fallback strategy that the Cosmolabe renderer tier ADR baselines. Blocked on that ADR (owner: Aaron, per the merge driver split).

## Consequence

Phase 2 work on `argelander-three` does not begin until this ADR flips to accepted with a concrete version pin. The adapter surface stays tiny (strips in, meshes out) so the pin lands late and cheap.
