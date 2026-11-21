# ADR 0006: Motion system for the landing page

Status: accepted (2026-11-22).

## Context

The original spec describes a static glow at the edges of the hero shot and the final-CTA box, with no motion. The owner asked for visible, polished motion: a soft light that travels around those two boxes, and gradients moving along the diagram lines.

## Decision

- **Glow:** soft blobs orbit just inside each box and change shape and colour as they move. A mask limits the visible halo to 92px or less past the box, inside the section's padding.
- **Diagram lines:** the lines stay solid. A gradient clipped to each line travels along it on a separate layer.
- **Page motion:** content settles in on load and on scroll with CSS. Controls use short press and state transitions.
- **Limits:** motion animates transforms, opacity, one small text blur and the position of the line gradients. Reduced motion, print and the footer pause control all leave content visible and at rest.
- **Surfaces:** backgrounds move from blue-tinted to a near-neutral graphite, so the mint, blue and violet light reads cleanly. Cards still have no strokes.

## Consequences

This replaces the static glow recipe and the surface colours in `docs/landing-page.md`. `scripts/check-site-css.mjs` allows radial gradients only in `GlowMesh.astro`, and linear gradients only as that component's mask or on the diagram-line layers in `motion.css`.
