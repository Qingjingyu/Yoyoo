# Yoyoo Space Roadmap

> Updated: 2026-08-05

## Current State

- Product direction: confirmed.
- Retired Yoyoo active repository: removed from the original path.
- Retired PostgreSQL container and development volume: removed.
- Retired local uploads, Connector state, and action bridge: moved to the macOS
  Trash after direct deletion was rejected by the host safety policy.
- Legacy tracked source snapshot: isolated outside this repository at commit
  `d0a1e0990ec8ec79515995ba48291f07623cfda6`.
- New repository: initialized with no inherited Git history or application code.
- Product spec and development plan: drafted.
- Runtime implementation: not started.

## Delivery Stages

1. **Requirements** - In review
   - Confirm conversation-only v0.1 and explicit non-goals.
2. **Plan** - Drafted
   - Lock current dependency versions and current YOS contract before coding.
3. **Foundation** - Not started
   - Reproducible project, tests, database, and Agent contract.
4. **Golden conversation slice** - Not started
   - New visual system and complete test-Agent conversation.
5. **Real YOS integration** - Not started
   - Confirmed capabilities only, with real ten-turn acceptance.
6. **Polish and handoff** - Not started
   - Browser, security, accessibility, source-boundary, and recovery evidence.

## Decisions

- Yoyoo remains the primary brand; the product surface is Yoyoo Space.
- The new product is implemented independently, not migrated from legacy code.
- V0.1 optimizes one conversation before adding any adjacent product surface.
- YOS is the first adapter, not a shared-domain dependency.
- Third-party AGPL source remains reference-only.

## Rejected Alternatives

- Restyle the retired application: rejected because its product and domain scope
  would continue shaping the new interface.
- Delete all historical source evidence: rejected because a small isolated,
  credential-free snapshot is useful for protocol archaeology and rollback.
- Rebrand Glass UI React: rejected because of license obligations and its generic
  dashboard architecture.
- Add avatar, voice, tasks, files, or multiple Agents to v0.1: rejected until the
  real conversation slice is accepted.
