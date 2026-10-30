# 0006: Imports and the source of record

Status: accepted, 2026-10-28

## Context
Rows come from three kinds of files: the payments app report, the old notes log and the monthly budget workbooks (plus a generic CSV for synthetic data). The owner re-uploads files when they correct them, and sometimes uploads the same file twice. Totals must never count a row twice, a correction must replace what it corrects, and the owner's review work must not be lost on the next import.

## Decisions
- **D-8**: Source files are the record: notes log and budget workbook rows are corrected in the file and re-uploaded. Review choices are stored only for payments report rows, kept apart and applied on top.
- **D-9**: A new file for the same source and period replaces the earlier rows from that source and period; undo restores the previous file's rows.
- **D-16**: Periods: payments report and budget workbook files cover one calendar month; a notes log or generic CSV covers the whole file. One import at a time per source and period, by a conditional lock.
- **D-17**: Undo applies only to a period's active import: it moves the period pointer to the previous file, or to none, and reconciles; a repeat undo gets conflict. Raw uploads are kept until delete-all.
- **D-28**: An import commits by moving its period pointer before writing rows, then reconciles: the period's stored rows are made equal to the active file's rows. Retries, re-uploads and a repair request re-run the reconcile.

## Options

### Where review choices live (D-8)
- **Keep every review choice apart from imported rows and apply it on top**: works for every source, but notes log and workbook rows would then have two records that can disagree.
- **Write review choices onto the imported row**: the next import of the file overwrites them.
- **Fix notes log and workbook rows in the source file; store choices only for payments report rows, which cannot be edited** (chosen): the owner's files stay the single record and the review store stays small. Cost: every correction to a notes log or workbook row is a file edit and a re-upload.
- **Do nothing**: no review choices; flags stay until the source changes.

### What a new file for the same period does (D-9)
- **Replace earlier rows from the same source and period** (chosen): corrections land cleanly, and undo stays possible by restoring the previous file. Cost: the period of each file must be known exactly; a wrong period would remove the wrong rows.
- **Do nothing**: only add rows; corrections leave duplicates.
- **Keep every version and let the owner choose**: more state and a choice the owner must make on every upload.

### Periods, undo and commit order (D-16, D-17, D-28)
Two-way design decisions, accepted by the owner in bulk on 2026-10-22. A period is one calendar month for payments reports and budget workbooks, and the whole file for a notes log or generic CSV. A conditional lock on the period pointer allows one import at a time per source and period. An import moves the pointer first and then makes the stored rows equal to the active file's rows, so a crash, a retry or a repeat upload re-runs the same reconcile and ends in the same rows.

## Decision
- Each source and period has one pointer (`PER#<source>#<period>`) naming its active import and the history of imports that counted.
- An import takes the period lock, commits by moving the pointer to itself only if the active import sorts before it, then reconciles: it puts every row of the active file and removes every stored row of that source and period that is not in it. The same file twice ends unchanged; a corrected file replaces the earlier rows.
- Undo is allowed only on the active import. It moves the pointer back to the previous history entry, or to none, and reconciles. Repair re-runs the reconcile without moving the pointer; it is the owner's fix for a stalled import.
- Raw uploads stay in the bucket until delete-all, so undo can parse the previous file again.
- Review choices are stored only for payments report rows, at `OVR#<date>#<id>`, and applied on read. A review choice on a notes log or workbook row is refused with source_file_only.

## Consequences
- Re-importing never double counts, and the owner's payments report choices survive later imports of the same source.
- A wrong period would remove another file's rows, so the period rule lives in one function with a test per source, and the parser fails a one-month file with a row dated outside its month.
- Every notes log or workbook correction is a file edit and a re-upload.
- Raw uploads, which may hold account details, are kept until delete-all; the threat model covers them.

## Revisit when
- A source without stable row ids or without a clear period is added.
- The owner wants to edit notes log or workbook rows in the app.
