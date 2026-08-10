# Yoyoo V0.7 Room Details Design

## Product Shape

The conversation workspace keeps one primary task: reading and writing in the
shared room. Room administration remains hidden until requested. Clicking a
room's overflow action selects that room and opens a stable details pane on the
right instead of showing a compact popover. This yields three functional areas:
compound navigation, conversation, and room details.

The pane starts with the member roster because membership defines who can read,
speak, and be routed work in the room. Human and AI principals use the same row,
with a quiet secondary kind label. “添加成员” selects only active principals
already belonging to the workspace. Creating accounts, inviting people, and
connecting external Agents are different onboarding workflows and do not enter
this release.

## Interaction And Responsive Behavior

Desktop details occupy about 320px and reduce the conversation only while enough
width remains. Compact desktop keeps the conversation width and overlays details
from the right. Mobile uses a full-width right-hand surface with a clear back or
close control. The pane is temporary UI state and is not persisted in the URL.

Member mutations show saving, success, conflict, forbidden, and retry states.
Removing a member never erases prior content. The owner cannot be removed. An
Agent with active work cannot be removed until its run settles. Re-adding a
removed principal restores the membership and immediately refreshes composer
routing from the authoritative room snapshot.

## Information Hierarchy

1. Room identity and close action.
2. Member count, current roster, and add-member action.
3. Room name and copy-link controls.
4. Archive in a separated danger section.

Search, announcements, notifications, pinned content, files, nicknames, role
editing, and external Agent setup are excluded rather than rendered as inactive placeholders.

## Rejected Alternatives

- A modal interrupts the conversation and cannot remain visible while reviewing context.
- A permanent details pane spends width on a low-frequency task.
- A popover plus a second click to details adds hierarchy without adding meaning.
- A separate bot-management surface demotes Agents from first-class room members.
