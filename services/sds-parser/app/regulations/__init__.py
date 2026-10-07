"""Load regulations (eCFR) into the shared knowledge base the AI assistant cites.

Runs as the platform-level ``regulation_ingest`` job (see job.py): fetch a part
of the CFR, split it into sections, chunk and embed each section, and replace
that section's rows atomically. A section whose text has not changed is skipped,
so a re-run after a new amendment re-embeds only what changed.
"""
