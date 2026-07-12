# PHASE-1: Core engine and Leaflet adapter

Deliver: samplers for all families sufficient to reproduce atlas behavior; SGP4 worker provider and pre-sampled SPICE provider; `argelander-leaflet` painting strips with all six treatments and the trail-decay canvas; the demo-leaflet app with live SGP4 footprints over open tiles; three demonstration configurations (an Earth SAR constellation, ICESat-2 beads, a Mars orbiter pair CTX plus HiRISE targeting) proving the planetary path early; atlas tiles re-rendered through argelander-core, converting the demo into the regression corpus.

Exit: golden-image tests per family against the re-rendered atlas; AGE-15 budget measured and recorded; antimeridian and polar cases tested (AGE-10).

## Slice ledger

| slice | scope | status |
| --- | --- | --- |
| 1 | ADR-0008 and argelander-providers: from-source SGP4 and pre-sampled providers, worker port marshalling | merged |
| 2 | Along-track family samplers (whiskbroom, framing, push-frame, multi-angle, profiler beside the pushbroom anchor), fixtures regenerated as anchors | merged |
| 3 | Radar and scatterometer family samplers (stripmap, TOPS, spotlight, SweepSAR, bistatic, fan-beam, pencil-beam, bilateral) | merged |
| 4 | argelander-leaflet: strip painting, the six treatments, the trail-decay canvas | merged |
| 5 | Pointed and scanning families (step-scan-sounder, conical-radiometer, limb-occultation, geo-raster, agile-tasking, target-stare), folding in the generalization of the flyby sampler out of conformance.ts | queued |
| 6 | demo-leaflet app: trackStrip provider bridge in core, worker-hosted SGP4, hosted on Pages beside the atlas | next |

Sequencing note: the adapter runs ahead of the remaining six families because the fifteen landed samplers already cover every structural stress case the adapter must survive (zero-width beads, varying-width flyby, three non-Earth bodies, burst quilts with time gaps, baseline subs, dual strips sharing a passId), the remaining families mostly stress the sampler side, and the two genuinely novel display behaviors they introduce (geo-raster's stationary repaint, the richer state choreography of agile and stare) are small adapter follow-ups rather than foundations. The adapter unlocks the demo app, which is the standalone story; the exotics verify better landing into a surface that can display them than into fixture JSON. The flyby generalization has been parked once already (since the radar re-sequencing) and rides slice 5 so it is not forgotten a second time.
