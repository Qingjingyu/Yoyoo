# Yoyoo Centered Conversation Design

> Date: 2026-08-06
>
> Status: superseded by the homepage and conversation split

## Experience

Yoyoo opens onto a quiet rain-lit city. This document originally placed the
complete conversation on the homepage. Browser use showed that long history
became a short internal window, so the backdrop and visual axis remain while
the transcript now lives on a dedicated full-height conversation page.

## Composition

- The background fills the viewport and is uniformly graded so the original
  image remains recognizable without competing with text.
- The navigation rail stays narrow and separate from the central task.
- The conversation rail is capped at 42rem and centered within the content
  area, excluding the desktop navigation rail.
- Submitted user and Agent-local states grow within the same rail. No recent
  conversation dashboard or secondary right panel is introduced.
- Live mode uses the same center and keeps only the Orb, state, mute, and end
  controls.

## Responsive Behavior

- Desktop preserves the complete city composition and exact content centering.
- Mobile keeps the quiet central part of the same image and moves navigation to
  the bottom without reducing control targets below 44px.
- The original bitmap is served without responsive downsampling because a
  portrait `object-fit: cover` crop requires more source pixels than `100vw`
  suggests.

## Non-goals

- No Three.js scene, decorative ambient animation, dashboard, recent threads,
  fake Agent response, microphone transport, or backend integration.
- No separate visual language for Live mode.

## Acceptance

- Desktop and mobile show the original-resolution backdrop without overflow.
- Greeting, message timeline, composer, and Live Orb remain centered.
- Text submission remains explicitly local-only until an Agent is connected.
- Loading, error, ready, Live, muted, and reduced-motion states remain usable.
