# ADR-0010: an optional radius on the event sub-structure

Status: accepted. Date: 2026-07-12.

## Decision

Add one optional field, `radiusKm`, to the `event` sub-structure of SPEC-STRIP: `{ kind: 'event', center, radiusKm?, eventId? }`. The frozen strip schema (`schemas/strip.schema.json`), the TypeScript contract (`types.ts`), and the SPEC-STRIP section 3 table all gain it. The field is the ground radius of the event's measurement footprint, kilometers; when present the renderer draws the event ring at that size (projected to pixels with a legibility floor), and when absent it falls back to the current fixed pixel ring, so every existing strip and every existing consumer is unaffected. The limb-occultation sampler, the one family that emits events, now carries its model's `eventRadiusKm` onto the event instead of validating it and discarding it.

This is an additive, optional schema evolution of a Phase 0 frozen contract, recorded here because ADR-0007 froze the three specs and any contract move needs an ADR. Additive optional fields are the gentlest evolution the closed schema allows: an old strip that omits the field still validates, a consumer that ignores the field still works, and the conformance anchors (atlas tiles 1 pushbroom and 21 flyby) carry no events, so the numeric freeze is untouched. Only the limb-occultation strip fixture regenerates.

## Rationale

The review of the exotic-family slice found the one place in the engine where a required instrument-model parameter never reaches the picture: `limb-occultation` requires `eventRadiusKm`, the sampler validated its presence and threw the value away, and the painter drew every event at a hardcoded pixel radius. The strip still validated and the event still rendered, so it was a disclosed fidelity gap, not a defect, and it had a precedent (push-frame's `frameletHalfAlongKm` is declarative pending a later phase). The reason to close it rather than defer it: it is a required parameter, not an optional one, so leaving it inert is a small standing exception to the principle that the engine draws exactly what the strip says, and the fix is small, purely additive, and non-breaking. Event footprint size is genuinely a modeled quantity that varies (GNSS radio-occultation and solar-occultation events differ in ground scale), so the field earns its place beyond this one family.

The alternative, keeping the parameter declarative, was declined because the change costs one optional field and one painter branch, and closing a required-param gap is worth that. A non-optional field was declined because most event families (a bare occultation marker) have no meaningful footprint radius, so requiring it would force a synthetic value; optional keeps the field honest. Encoding the footprint as an ellipse (like `footprint`) was declined because an event is a point measurement whose size is a scalar in every model that carries one, and a circle is the honest rendering-grade shape; a family that needs an oriented event footprint can emit a `footprint` sub-structure instead.

Refs: AGE-03, AGE-08, AGE-09
