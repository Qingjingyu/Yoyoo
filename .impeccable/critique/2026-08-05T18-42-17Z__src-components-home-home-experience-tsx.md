---
target: Yoyoo homepage future product quality
total_score: 20
p0_count: 1
p1_count: 3
timestamp: 2026-08-05T18-42-17Z
slug: src-components-home-home-experience-tsx
---
# Yoyoo Homepage Future-Quality Critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 2/4 | Live is clear; text preparing has no terminal state |
| 2 | Match system / real world | 3/4 | Mostly natural copy, with some mixed product language |
| 3 | User control and freedom | 1/4 | Text submission cannot be cancelled or recovered |
| 4 | Consistency and standards | 3/4 | Components are consistent; empty hash navigation is not |
| 5 | Error prevention | 2/4 | Empty input is blocked, but submitted content disappears |
| 6 | Recognition rather than recall | 2/4 | Main action is visible; navigation relies on icon memory |
| 7 | Flexibility and efficiency | 2/4 | Enter works; no Escape, history, or recovery path |
| 8 | Aesthetic and minimalist design | 3/4 | Focused, but empty space lacks intentional composition |
| 9 | Error recovery | 1/4 | Core text flow has no failure or retry state |
| 10 | Help and documentation | 1/4 | Placeholder and title are the only guidance |
| **Total** | | **20/40** | **Acceptable floor; major improvement required** |

## Anti-Patterns Verdict

The homepage is easy to read as a low-cost AI assistant template: uniform black,
mint status accents, Lucide icons, centered greeting, and one glass composer.
The deterministic CLI detector returned zero findings, which confirms the issue
is not a simple forbidden-CSS pattern. Browser overlays identified dark-glow and
AI-palette families around the status and Live orb; a clipped-overflow signal on
the shell was a false positive because viewport measurements showed no clipping
or horizontal overflow.

## Overall Impression

The interface is clean and operationally focused, but it has no spatial world.
The reference feels expensive because it combines a full environment, physical
depth, directional light, credible material, and several controlled visual
anchors. Yoyoo currently places generic controls on one flat plane. Glass has
nothing to refract, the empty pixels carry no atmosphere, and the only memorable
material is hidden until Live mode.

## What Is Working

- The homepage has one clear task and low cognitive load.
- Responsive behavior, contrast, focus, reduced motion, and 44px targets are
  sound.
- The Live orb has genuine state expression and is the strongest brand asset.

## Priority Issues

### P0: Text conversation is a permanent dead end

Submission clears the content and leaves the UI in preparing forever. Preserve
the message and add complete, failed, timeout, cancel, and retry outcomes before
presenting send as a working action.

### P1: The homepage has no physical environment

Future quality needs a coherent background, middle interaction plane, and
foreground response. Build one cinematic collaboration space and let Live light
that same space instead of switching to an isolated orb demo.

### P1: Composition and scale are generic

Centered greeting plus wide composer is category-default grammar. Introduce a
directional scene, asymmetric weight, and an intentional interaction threshold
without adding dashboard cards.

### P1: Navigation promises destinations that do not exist

The conversation and settings hash links expose prototype status. Remove them
from v0.1 or connect them to real destinations.

### P2: Live is a component demo, not a continuous world

Let orb light, material response, transition, and controls belong to the same
environment as the homepage. The orb need not become much larger; its influence
on the space should become larger.

## Persona Red Flags

- **Alex**: no cancel, Escape, history, or recovery; empty navigation wastes
  attention.
- **Jordan**: icon-only destinations and the voice symbol require guessing;
  submitted text disappears without explanation.
- **Casey**: mobile touch targets are good, but no draft or state survives an
  interruption.

## Minor Observations

- Sidebar and header repeat the brand.
- 0.62rem state copy resembles diagnostics rather than a premium product voice.
- The disabled send control is visually absent instead of visibly ready to wake.
- The Live eyebrow and glass control wrapper reinforce a component-demo look.

## Direction Options

1. **Cinematic Presence Space**: a full-screen, low-information environment with
   real depth and directional light. This most directly creates the feeling of
   entering another world.
2. **Precision Instrument**: asymmetric geometry, typography, and engineered
   control detail without imagery. Safer, but more likely to feel like an
   expensive tool than a future world.
3. **Living Material Chamber**: one responsive material surface whose tension,
   refraction, and illumination respond to text and voice. Most distinctive,
   but hardest to execute without WebGL quality problems.

Recommendation: use Cinematic Presence Space as the environmental foundation
and Living Material Chamber as the interaction language. Do not add generic HUD
lines, neon ornaments, or more cards.

## Questions To Consider

- Is the homepage merely an entrance, or a world the user should want to return
  to every day?
- If v0.1 has no real destinations, should it have a permanent navigation rail?
- If all copy and logos disappear, what visual property still identifies Yoyoo?
