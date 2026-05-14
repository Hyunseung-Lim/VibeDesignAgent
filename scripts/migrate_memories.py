"""
VibeDesignAgent - Memory schema migrator

Usage:
    python3 scripts/migrate_memories.py
    python3 scripts/migrate_memories.py --write

Default mode is a dry run. With --write, this reads exports/memories.json,
transforms memory documents from v0.1.0 to v0.1.1, and writes them to
users/{uid}/memories_0_1_1/interaction-{missionId}-{draftId}. Existing target documents are
skipped unless --overwrite is provided.
"""

import argparse
import json
import time
from pathlib import Path


KEY_FILE = "vibedesignagent-key.json"
DEFAULT_FROM_VERSION = "0.1.0"
DEFAULT_TO_VERSION = "0.1.1"
DEFAULT_INPUT = Path("exports/memories.json")
DEFAULT_COLLECTION = "memories_0_1_1"


def init_firestore():
    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        cred = credentials.Certificate(KEY_FILE)
        firebase_admin.initialize_app(cred)
    return firestore.client()


def parse_json_array(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if not isinstance(value, str):
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item).strip() for item in parsed if str(item).strip()]


def compact_text(value):
    return str(value or "").strip()


def unique_strings(values):
    seen = set()
    result = []
    for value in values:
        text = compact_text(value)
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def memory_key(doc):
    mission_id = compact_text(doc.get("sourceMissionId"))
    draft_id = compact_text(doc.get("sourceDraftId"))
    legacy_id = compact_text(doc.get("id"))
    return mission_id, draft_id, legacy_id


def group_legacy_memories(user_data):
    groups = {}
    for collection_name in ("episodicMemories", "semanticMemories"):
        for legacy_doc in user_data.get(collection_name, []):
            mission_id, draft_id, legacy_id = memory_key(legacy_doc)
            if not legacy_id:
                continue
            group_key = (mission_id, draft_id or legacy_id)
            group = groups.setdefault(
                group_key,
                {
                    "missionId": mission_id,
                    "draftId": draft_id,
                    "legacyIds": [],
                    "input": "",
                    "output": "",
                    "episode": "",
                    "semantic": [],
                    "keywords": [],
                    "timestamp": None,
                    "createdAt": None,
                },
            )
            group["legacyIds"].append(legacy_id)
            group["input"] = group["input"] or compact_text(legacy_doc.get("input"))
            group["output"] = group["output"] or compact_text(legacy_doc.get("output"))
            group["keywords"].extend(parse_json_array(legacy_doc.get("keywordsJson")))
            group["timestamp"] = group["timestamp"] or legacy_doc.get("timestamp")
            group["createdAt"] = group["createdAt"] or legacy_doc.get("createdAt")
            if collection_name == "episodicMemories":
                group["episode"] = group["episode"] or compact_text(legacy_doc.get("episode"))
            else:
                semantic = compact_text(legacy_doc.get("semantic"))
                if semantic:
                    group["semantic"].append(semantic)
    return groups


def build_memory_0_1_1(uid, group, migrated_at, from_version, to_version):
    return {
        "schemaVersion": to_version,
        "sourceSchemaVersion": from_version,
        "type": "interaction",
        "content": group["episode"],
        "keywords": unique_strings(group["keywords"])[:10],
        "semantic": unique_strings(group["semantic"])[:6],
        "input": group["input"],
        "output": group["output"],
        "timestamp": group["timestamp"] or group["createdAt"],
        "source": {
            "missionId": group["missionId"],
            "draftId": group["draftId"],
            "legacyIds": unique_strings(group["legacyIds"]),
        },
        "createdAt": group["createdAt"],
        "migratedAt": migrated_at,
        "ownerUid": uid,
    }


def iter_migrated_memories(export_data, migrated_at, from_version, to_version):
    for email, user_data in export_data.items():
        uid = compact_text(user_data.get("uid"))
        if not uid:
            continue
        for (_mission_id, _draft_key), group in group_legacy_memories(user_data).items():
            doc_id = f"interaction-{group['missionId']}-{group['draftId'] or group['legacyIds'][0]}"
            yield email, uid, doc_id, build_memory_0_1_1(
                uid,
                group,
                migrated_at,
                from_version,
                to_version,
            )


def load_export(path):
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    if isinstance(payload, dict) and isinstance(payload.get("users"), dict):
        meta = payload.get("_meta") or {}
        schema_version = meta.get("schemaVersion")
        if schema_version:
            print(f"Loaded memory export schema v{schema_version} from {path}")
        return payload["users"]
    return payload


def migrate(args):
    export_data = load_export(args.input)
    migrated_at = int(time.time() * 1000)
    rows = list(
        iter_migrated_memories(
            export_data,
            migrated_at,
            args.from_version,
            args.to_version,
        )
    )

    if args.user:
        needle = args.user.lower()
        rows = [
            row
            for row in rows
            if row[0].lower() == needle or row[1].lower() == needle
        ]

    if args.limit:
        rows = rows[: args.limit]

    print(
        f"Prepared {len(rows)} memories for {args.from_version} -> {args.to_version} "
        f"in collection '{args.collection}'."
    )

    if not args.write:
        by_user = {}
        semantic_count = 0
        for email, _uid, _doc_id, data in rows:
            by_user[email] = by_user.get(email, 0) + 1
            semantic_count += len(data["semantic"])
        print("Dry run only. Pass --write to write to Firestore.")
        print(f"Users: {len(by_user)}")
        print(f"Interactions: {len(rows)}")
        print(f"Semantic inferences: {semantic_count}")
        for email, count in sorted(by_user.items()):
            print(f"  {email}: {count}")
        return

    db = init_firestore()
    written = 0
    skipped = 0
    for email, uid, doc_id, data in rows:
        ref = (
            db.collection("users")
            .document(uid)
            .collection(args.collection)
            .document(doc_id)
        )
        snapshot = ref.get()
        if snapshot.exists and not args.overwrite:
            skipped += 1
            continue
        ref.set(data)
        written += 1
        print(f"  wrote {email} / {doc_id}")

    print(f"\nDone. Written: {written}, skipped existing: {skipped}")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--collection", default=DEFAULT_COLLECTION)
    parser.add_argument("--from-version", default=DEFAULT_FROM_VERSION)
    parser.add_argument("--to-version", default=DEFAULT_TO_VERSION)
    parser.add_argument("--user", help="Only migrate one email or uid")
    parser.add_argument("--limit", type=int, help="Only migrate the first N rows")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    migrate(parse_args())
