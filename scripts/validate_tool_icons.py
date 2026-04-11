from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "assets" / "tool-icons"
MANIFEST_PATH = ICON_DIR / "manifest.json"

VALID_SIGNATURES = {
    ".png": [b"\x89PNG\r\n\x1a\n"],
    ".ico": [b"\x00\x00\x01\x00", b"\x00\x00\x02\x00"],
    ".svg": [b"<svg", b"<?xml", b"<!DOCTYPE svg", b"<!doctype svg"],
    ".jpg": [b"\xff\xd8\xff"],
    ".jpeg": [b"\xff\xd8\xff"],
    ".webp": [b"RIFF"],
}

CONTENT_TYPES = {
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def read_manifest() -> dict[str, dict[str, str]]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def looks_like_html(payload: bytes) -> bool:
    head = payload[:128].lstrip().lower()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html")


def file_is_valid(path: Path) -> bool:
    if not path.exists() or not path.is_file():
        return False
    data = path.read_bytes()
    if not data or looks_like_html(data):
        return False
    suffix = path.suffix.lower()
    signatures = VALID_SIGNATURES.get(suffix)
    if not signatures:
        return True
    return any(data.startswith(signature) for signature in signatures)


def local_url(filename: str) -> str:
    return f"local://assets/tool-icons/{filename}"


def repair_entry(tool_id: str, entry: dict[str, str]) -> bool:
    changed = False
    primary_name = entry.get("file")
    fallback_name = entry.get("fallback")

    primary_path = ICON_DIR / primary_name if primary_name else None
    fallback_path = ICON_DIR / fallback_name if fallback_name else None

    primary_valid = bool(primary_path and file_is_valid(primary_path))
    fallback_valid = bool(fallback_path and file_is_valid(fallback_path))

    if primary_valid:
        expected_type = CONTENT_TYPES.get(primary_path.suffix.lower())
        if expected_type and entry.get("content_type") != expected_type:
            entry["content_type"] = expected_type
            changed = True
        return changed

    if fallback_valid and fallback_name:
        expected_type = CONTENT_TYPES.get(fallback_path.suffix.lower(), "image/svg+xml")
        if entry.get("file") != fallback_name:
            entry["file"] = fallback_name
            changed = True
        if entry.get("content_type") != expected_type:
            entry["content_type"] = expected_type
            changed = True
        if entry.get("source") != "local-fallback":
            entry["source"] = "local-fallback"
            changed = True
        expected_url = local_url(fallback_name)
        if entry.get("url") != expected_url:
            entry["url"] = expected_url
            changed = True
        return changed

    if "content_type" in entry:
        del entry["content_type"]
        changed = True
    if "file" in entry:
        del entry["file"]
        changed = True
    if entry.get("source") != "missing":
        entry["source"] = "missing"
        changed = True
    if entry.get("url") != "local://missing":
        entry["url"] = "local://missing"
        changed = True
    return changed


def main() -> None:
    manifest = read_manifest()
    changed_ids: list[str] = []
    for tool_id, entry in manifest.items():
        if repair_entry(tool_id, entry):
            changed_ids.append(tool_id)

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Validated {len(manifest)} icon entries.")
    if changed_ids:
        print("Repaired entries:")
        for tool_id in changed_ids:
            print(f" - {tool_id}")
    else:
        print("No repairs needed.")


if __name__ == "__main__":
    main()
