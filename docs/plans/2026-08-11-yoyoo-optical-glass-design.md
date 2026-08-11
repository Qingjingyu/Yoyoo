# Yoyoo Optical Glass Material Design

## Objective

Give the existing image-free light and dark themes a premium frosted-glass
material language without sacrificing the readability and restrained hierarchy
established in V0.12.

## Physical Model

The interface is a precision instrument assembled from three materials:

- `base`: quiet solid canvas for sustained reading;
- `content`: substantially opaque message and data surfaces;
- `glass`: translucent navigation, framing, composition, and temporary layers.

Glass has an upper highlight, a restrained lower edge, bounded blur, controlled
saturation, and a compact shadow. Its thickness changes by role: navigation is
smoked/frosted, the composer is clearer and more elevated, and menus are the
most optically dense. Glass never replaces the content plane.

## Theme Character

- Light: ice-frost glass over cool mist and silver-blue base planes.
- Dark: smoked optical glass over graphite and blue-green black planes.
- Accent: cyan remains a signal rather than a decorative wash.

## Interaction

Hover and focus change local edge clarity and surface density. They do not add
large glows or move layout. Running Agent signals retain the existing restrained
breathing behavior; static glass never animates.

## Rejected Alternatives

- All-glass layout: lowers contrast and creates nested transparent cards.
- Background image or decorative gradient: contradicts the image-free product
  decision and makes the material dependent on scenery.
- Strong chromatic aberration: visually noisy for an everyday IM workspace.
- Canvas/WebGL refraction: unnecessary cost and weaker accessibility for a
  structural product material.

## Acceptance

Glass must be immediately perceptible at navigation and composition boundaries,
while messages remain as easy to read as V0.12. Both themes must feel like the
same instrument under different ambient light.
