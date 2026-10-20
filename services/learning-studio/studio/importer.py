"""Import a seed module (module.json + media files) into Supabase as a draft.

Idempotent: re-running updates the same draft version and replaces its quiz.
Never touches a published version: content that learners have already been
credited against must not change underneath their completions.
"""
from dataclasses import dataclass
from pathlib import Path

from . import supabase
from .content import content_type_for, load_module, rewrite_media_paths

EDITABLE = set(supabase.EDITABLE_STATUSES)


class ImportRefused(RuntimeError):
    pass


@dataclass(frozen=True)
class ImportResult:
    module_id: str
    version_id: str
    version_number: int
    created_module: bool
    created_version: bool
    uploaded: int
    questions: int


def import_seed_module(seed_dir: Path, *, allow_missing: bool = False, log=print) -> ImportResult:
    module = load_module(seed_dir)
    content, uploads, missing = rewrite_media_paths(module["content"], module["media_prefix"],
                                                    seed_dir)
    if missing and not allow_missing:
        raise ImportRefused(f"Media files missing from {seed_dir}: {', '.join(missing)}. "
                            "Generate them first or pass --allow-missing.")

    existing = supabase.get_global_module_by_slug(module["slug"])
    versions = sorted((existing or {}).get("strike_module_versions") or [],
                      key=lambda v: v["version_number"])
    editable = [v for v in versions if v["status"] in EDITABLE]
    if versions and not editable:
        latest = versions[-1]
        raise ImportRefused(
            f"Version {latest['version_number']} of {module['slug']} is {latest['status']} and "
            "cannot be overwritten. Start a new version in the Soteria web studio first.")

    for upload in uploads:
        supabase.upload(upload.bucket_path, upload.local.read_bytes(),
                        content_type_for(upload.bucket_path))
        log(f"uploaded {upload.bucket_path}")

    module_fields = {
        "title": module["title"],
        "description": module.get("description"),
        "category": module.get("category"),
        "tags": module.get("tags", []),
        "estimated_minutes": module.get("estimated_minutes"),
    }
    if existing:
        module_id = existing["id"]
        changes = dict(module_fields)
        if existing["status"] not in ("published", "archived"):
            changes["status"] = "in_review"
        supabase.update_module(module_id, changes)
    else:
        module_id = supabase.insert_row("strike_modules", {
            **module_fields, "slug": module["slug"], "library_scope": "global",
            "tenant_id": None, "status": "in_review",
        })["id"]

    version_fields = {
        "content": content,
        "passing_score": module.get("passing_score", 80),
        "retake_limit": module.get("retake_limit"),
        "validity_days": module.get("validity_days"),
        "locale": module.get("locale", "en"),
    }
    if editable:
        target = editable[-1]
        version = supabase.update_editable_version(target["id"], version_fields)
        created_version = False
    else:
        version = supabase.insert_row("strike_module_versions", {
            **version_fields, "module_id": module_id, "library_scope": "global",
            "tenant_id": None, "version_number": 1, "status": "draft",
        })
        created_version = True

    supabase.delete_questions(version["id"])
    questions = supabase.insert_rows("strike_quiz_questions", [
        {"module_version_id": version["id"], "library_scope": "global", "tenant_id": None,
         "question_type": q["question_type"], "prompt": q["prompt"],
         "explanation": q.get("explanation"), "sort_order": index, "points": 1,
         "required": True, "graded": True}
        for index, q in enumerate(module["questions"])
    ])
    supabase.insert_rows("strike_quiz_answers", [
        {"question_id": row["id"], "library_scope": "global", "tenant_id": None,
         "answer_text": answer["text"], "is_correct": bool(answer["correct"]),
         "sort_order": answer_index}
        for row, source in zip(questions, module["questions"], strict=True)
        for answer_index, answer in enumerate(source["answers"])
    ])

    return ImportResult(module_id, version["id"], version["version_number"], existing is None,
                        created_version, len(uploads), len(questions))
