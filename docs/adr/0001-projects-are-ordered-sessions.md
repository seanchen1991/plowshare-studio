# Projects are ordered lists of Sessions, with Cuts on each Session's timeline

A Project must both combine takes end to end (wanted for the first solo episodes) and, from phase 6, stack several participants' Recordings in parallel. We model a Project as an ordered list of Sessions, where each Session groups the parallel Recordings of one start-to-stop capture, and every Cut is a range on one Session's timeline that removes that time from all of its Tracks. This keeps editing as a simple cut list, which is what silence suggestions and transcript deletion produce, while still allowing takes to be combined. As a result, even a solo recording creates a Session.

## Considered options

- **One Recording per Project (the Brief's original shape):** rejected because it cannot combine takes.
- **Free clip timeline (any range of any Recording placed anywhere):** rejected for now. It is more flexible, but it replaces the cut list with a full non-linear editor and makes silence and transcript suggestions harder to show.

## Consequences

- Not supported: reusing one Session twice in a Project, Cuts that cross into the next Session, and cutting one participant's Track without the others. Each of these would need a change to this model.
- The Brief's `sources[]` data model is replaced by `sessions[]`, each holding its Recordings (with role and clock offset) and its own `cuts[]`.
