import json

import pytest
from django.core.management import CommandError, call_command

from studio.importer import ImportRefused, import_seed_module
from studio.models import MediaJob


def touch_all_media(seed_dir):
    module = json.loads((seed_dir / "module.json").read_text())
    for block in module["content"]["blocks"]:
        if block.get("image"):
            (seed_dir / block["image"]["path"].split("/")[-1]).write_bytes(b"png")
        narration = block.get("narration") or {}
        for field in ("audio_path", "captions_path"):
            if narration.get(field):
                (seed_dir / narration[field].split("/")[-1]).write_bytes(b"x")
    return module


def test_refuses_when_media_is_missing(fake, seed_dir):
    with pytest.raises(ImportRefused, match="Media files missing"):
        import_seed_module(seed_dir, log=lambda _: None)
    assert fake.tables["strike_modules"] == []


def test_first_import_creates_global_module_draft_version_and_quiz(fake, seed_dir):
    module = touch_all_media(seed_dir)
    result = import_seed_module(seed_dir, log=lambda _: None)

    [row] = fake.tables["strike_modules"]
    assert row["library_scope"] == "global" and row["tenant_id"] is None
    assert row["status"] == "in_review" and row["slug"] == module["slug"]
    [version] = fake.tables["strike_module_versions"]
    assert version["status"] == "draft" and version["version_number"] == 1
    assert version["validity_days"] == 365 and version["locale"] == "en"
    first_image = version["content"]["blocks"][0]["image"]["path"]
    assert first_image == f"{module['media_prefix']}/scene-01-why.png"
    assert first_image in fake.uploads
    assert result.created_module and result.created_version
    assert len(fake.tables["strike_quiz_questions"]) == 10
    assert all(q["graded"] for q in fake.tables["strike_quiz_questions"])
    correct = [a for a in fake.tables["strike_quiz_answers"] if a["is_correct"]]
    assert len(correct) >= 10


def test_reimport_updates_the_same_draft_and_replaces_the_quiz(fake, seed_dir):
    touch_all_media(seed_dir)
    first = import_seed_module(seed_dir, log=lambda _: None)
    second = import_seed_module(seed_dir, log=lambda _: None)
    assert second.version_id == first.version_id
    assert not second.created_module and not second.created_version
    assert len(fake.tables["strike_module_versions"]) == 1
    assert len(fake.tables["strike_quiz_questions"]) == 10


def test_never_overwrites_a_published_version(fake, seed_dir):
    touch_all_media(seed_dir)
    slug = json.loads((seed_dir / "module.json").read_text())["slug"]
    module, version = fake.add_module(status="published", version_status="published",
                                      content={"blocks": ["original"]})
    module["slug"] = slug
    with pytest.raises(ImportRefused, match="Version 1 of .* is published"):
        import_seed_module(seed_dir, log=lambda _: None)
    assert version["content"] == {"blocks": ["original"]}
    assert fake.uploads == {}


def test_command_wraps_refusals_and_records_a_failed_job(fake, seed_dir, db):
    with pytest.raises(CommandError, match="Media files missing"):
        call_command("import_seed_module", str(seed_dir))
    job = MediaJob.objects.get()
    assert job.kind == "import" and job.status == "failed"


def test_command_allow_missing_imports_and_records_success(fake, seed_dir, db):
    call_command("import_seed_module", str(seed_dir), "--allow-missing")
    job = MediaJob.objects.get()
    assert job.status == "succeeded" and job.version_number == 1
