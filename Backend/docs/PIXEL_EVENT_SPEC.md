# Pixel Event Specification

The canonical contract is maintained at
[`docs/PIXEL_EVENT_SPEC.md`](../../docs/PIXEL_EVENT_SPEC.md).

Backend ingestion must use that document's 16 event names and envelope without
maintaining a second copy. The enforced routes are:

- `POST /api/v1/events/ingest`
- `POST /api/v1/events/ingest/batch`

Each accepted event is stored with its canonical timestamp and committed in the
same database transaction as its idempotent feature job.
