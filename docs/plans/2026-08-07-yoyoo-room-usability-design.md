# Yoyoo V0.6 Room Usability Design

## Product Shape

V0.6 keeps the accepted three-column conversation shell. The room rail becomes
more informative rather than larger: every active row contains the room name,
one restrained latest-message line, and a small activity time. An icon menu
owns rename and archive commands. Archived rooms stay behind one collapsed row
and expose a restore command, so inactive work leaves the main rail without
becoming hidden database deletion.

The server remains authoritative. A room mutation requires active owner
membership in the room's workspace. Archive and restore are status transitions;
the room ID and every child record remain unchanged. The final active room
cannot be archived. Latest-message summaries are selected from completed public
room messages and transported verbatim with a bounded preview; Yoyoo does not
interpret, rank, or summarize meaning.

## Interaction And State

Rename uses a compact inline editor with save, cancel, saving, error, and success
feedback. Archive requires a small confirmation surface because it removes a
room from the active list. A successful archive selects the next active room and
replaces the URL. Restore returns the same room to the active list but does not
force navigation away from the user's current context.

The timeline tracks whether the viewport is near its bottom. Initial room load
opens at the latest message. Later messages scroll into view only while the user
remains near the bottom; otherwise an unobtrusive “回到最新” button appears. This
keeps live collaboration responsive without interrupting reading.

## Rejected Alternatives

- Hard deletion was rejected because room history, runs, and Artifacts are durable work records.
- Unread badges were separated into V0.7 because reliable unread state needs a per-member cursor.
- A full room-settings page was rejected because four lifecycle commands do not justify a new surface.
- Semantic room previews were rejected because content interpretation belongs to connected Agents.

## Verification

Repository tests prove permission, transition, preservation, concurrency, and
activity ordering. HTTP tests prove stable status codes. UI tests cover state and
keyboard behavior. Playwright covers desktop/mobile lifecycle, URL fallback,
timeline behavior, touch targets, overflow, and existing multi-Agent regression.
