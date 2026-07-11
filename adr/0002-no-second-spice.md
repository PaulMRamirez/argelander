# ADR-0002: No embedded CSPICE; states via providers

Status: accepted. Date: 2026-07-10.

## Decision

Argelander never embeds a CSPICE build, WASM or otherwise. SPICE-quality states arrive through the StateProvider seam: a pre-sampled service standalone, cspice-wasm consumed from Bessel when hosted together.

## Rationale

The SPICE re-point is the highest-risk seam of the Bessel and Cosmolabe merge, gated by a differential validation harness. A second SPICE inside Argelander recreates that risk in a second place and guarantees divergence. AGE-19.
