# Issue tracker: Local Markdown

Issues and specs live in `.scratch/`.

## Structure

- Each feature uses `.scratch/<feature-slug>/`.
- Its spec uses `.scratch/<feature-slug>/spec.md`.
- Each implementation issue uses `issues/<NN>-<slug>.md` beneath that feature.
- Issue numbers start at `01`.
- Each issue records its triage role in a `Status:` line.
- Comments append beneath a `## Comments` heading.

Use `triage-labels.md` for triage status strings.

## Implementation lifecycle

Implementation tickets retain their triage status and record a separate `State:` of `open`, `claimed`, or `resolved`.
Resolve a ticket only after its acceptance criteria are complete. Append completion evidence under `## Comments`.

## Skill operations

When a skill requests publication, create the appropriate Markdown file.
When a skill requests an existing ticket, read its referenced file.

## Wayfinding

Wayfinding uses separate investigation records.

- The map uses `.scratch/<effort>/map.md`.
- Each investigation uses `.scratch/<effort>/issues/NN-<slug>.md`.
- A `Type:` line identifies `research`, `prototype`, `grilling`, or `task`.
- Investigation status uses `open`, `claimed`, or `resolved`.
- A `Blocked by:` line lists prerequisite issue numbers.

Choose the lowest-numbered open investigation whose prerequisites are resolved.
Set its status to `claimed` before work.
Append the result beneath `## Answer`.
Set its status to `resolved`.
Add a result summary and link to the map.
