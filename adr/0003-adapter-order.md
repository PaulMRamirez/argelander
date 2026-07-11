# ADR-0003: Adapter order: Leaflet first, Three second

Status: accepted. Date: 2026-07-10.

## Decision

The Leaflet adapter ships first, targeting the MMGIS 2D Map. The Three adapter follows as one adapter core serving both LithoSphere (MMGIS Globe) and Cosmolabe hosts. A deck.gl adapter is possible but off the critical path.

## Rationale

MMGIS 2D is the mature, funded surface and the standalone value; the Leaflet canvas approach also serves as the tier-C representation on constrained hosts. The Three adapter waits for ADR-0006 so it binds to the ratified release train once.
