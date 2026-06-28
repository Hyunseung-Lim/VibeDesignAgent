"""
VibeDesignAgent — Complete local backup for specific users (by email)

Captures EVERYTHING for the given users so the data can be fully inspected
later, then deleted safely:
  - sessions/{uid}/missions/{mid}        (+ memoryDrafts, reviewTurns subcollections)
  - sessions/{uid}/missionRuns/{rid}     (+ memoryDrafts, reviewTurns)
  - users/{uid}/memories_0_1_2           (current long-term memory)
  - users/{uid}/memories_0_1_1, episodicMemories, semanticMemories (legacy)
  - users/{uid}/profile_memories/{mid}   (+ revisions subcollection)
  - users/{uid}/memoryReviewFeedback
  - users/{uid}/referenceSourceAnalyses
  - users/{uid}/memoryRetrievalLogs
  - users/{uid}/memoryClusters
  - users/{uid} root profile document
  - Storage: presentations/{uid}/*       (+ file metadata in firestore.json)
  - Stitch mockup HTML (re-fetched from Stitch, which session docs do NOT store)

Usage:
    python3 scripts/backup_users.py <email> [<email> ...]

Output:
    exports/full-backup/{timestamp}/{email}/firestore.json
    exports/full-backup/{timestamp}/{email}/presentations/*
    exports/full-backup/{timestamp}/{email}/stitch-html/*
    exports/full-backup/{timestamp}/sessions.json   (feeds the Stitch HTML export)
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import firebase_admin
from firebase_admin import auth, credentials, firestore, storage

KEY_FILE = "vibedesignagent-key.json"
STORAGE_BUCKET = "vibedesignagent.firebasestorage.app"
ROOT_DIR = Path.cwd()

cred = credentials.Certificate(KEY_FILE)
firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})
db = firestore.client()
bucket = storage.bucket()


def safe_name(value: str, fallback: str) -> str:
    value = (value or "").strip() or fallback
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value)[:80]


def dump_collection(collection_ref) -> list:
    return [{"id": doc.id, **(doc.to_dict() or {})} for doc in collection_ref.stream()]


def dump_session_docs(uid: str, kind: str) -> dict:
    """missions or missionRuns, each with memoryDrafts + reviewTurns subcollections."""
    out = {}
    root = db.collection("sessions").document(uid).collection(kind)
    for doc in root.stream():
        out[doc.id] = {
            **(doc.to_dict() or {}),
            "memoryDrafts": dump_collection(doc.reference.collection("memoryDrafts")),
            "reviewTurns": dump_collection(doc.reference.collection("reviewTurns")),
        }
    return out


def dump_profile_memories(uid: str) -> dict:
    out = {}
    root = db.collection("users").document(uid).collection("profile_memories")
    for doc in root.stream():
        out[doc.id] = {
            **(doc.to_dict() or {}),
            "revisions": dump_collection(doc.reference.collection("revisions")),
        }
    return out


def session_export_for_html(missions: dict, runs: dict) -> dict:
    """Shape sessions in the export_sessions.py format the HTML exporter expects."""
    out = {}
    for mid, data in {**missions, **runs}.items():
        title = data.get("missionTitle") or mid
        out[title] = {
            "missionId": data.get("missionId") or mid,
            "missionTitle": title,
            "stitchProjectId": data.get("stitchProjectId"),
            "artboards": data.get("artboards", []),
        }
    return out


def backup_user(uid: str, email: str, base_dir: Path) -> dict:
    user_dir = base_dir / safe_name(email, uid)
    user_dir.mkdir(parents=True, exist_ok=True)
    user_ref = db.collection("users").document(uid)

    missions = dump_session_docs(uid, "missions")
    runs = dump_session_docs(uid, "missionRuns")
    user_profile = user_ref.get().to_dict() or {}

    payload = {
        "uid": uid,
        "email": email,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "userProfile": user_profile,
        "sessions": {"missions": missions, "missionRuns": runs},
        "memories": {
            "memories_0_1_2": dump_collection(user_ref.collection("memories_0_1_2")),
            "memories_0_1_1": dump_collection(user_ref.collection("memories_0_1_1")),
            "episodicMemories": dump_collection(user_ref.collection("episodicMemories")),
            "semanticMemories": dump_collection(user_ref.collection("semanticMemories")),
        },
        "profile_memories": dump_profile_memories(uid),
        "memoryReviewFeedback": dump_collection(
            user_ref.collection("memoryReviewFeedback")
        ),
        "referenceSourceAnalyses": dump_collection(
            user_ref.collection("referenceSourceAnalyses")
        ),
        "memoryRetrievalLogs": dump_collection(user_ref.collection("memoryRetrievalLogs")),
        "memoryClusters": dump_collection(user_ref.collection("memoryClusters")),
        "storageFiles": [],
    }

    # Storage: presentation slides
    pres_dir = user_dir / "presentations"
    for blob in bucket.list_blobs(prefix=f"presentations/{uid}/"):
        rel = blob.name.removeprefix(f"presentations/{uid}/")
        if not rel:
            continue
        dest = pres_dir / safe_name(rel.replace("/", "__"), blob.name)
        dest.parent.mkdir(parents=True, exist_ok=True)
        blob.download_to_filename(str(dest))
        payload["storageFiles"].append(
            {
                "name": blob.name,
                "backupPath": str(dest.relative_to(user_dir)),
                "size": blob.size,
                "contentType": blob.content_type,
                "updated": blob.updated.isoformat() if blob.updated else None,
            }
        )

    with open(user_dir / "firestore.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)

    counts = {
        "missions": len(missions),
        "missionRuns": len(runs),
        "memories_0_1_2": len(payload["memories"]["memories_0_1_2"]),
        "profile_memories": len(payload["profile_memories"]),
        "reviewFeedback": len(payload["memoryReviewFeedback"]),
        "referenceAnalyses": len(payload["referenceSourceAnalyses"]),
        "retrievalLogs": len(payload["memoryRetrievalLogs"]),
        "clusters": len(payload["memoryClusters"]),
        "presentationFiles": len(payload["storageFiles"]),
    }
    print(f"  {email}: " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    return {"email": email, "missions": missions, "runs": runs}


def main():
    emails = sys.argv[1:]
    if not emails:
        print("Usage: python3 scripts/backup_users.py <email> [<email> ...]")
        sys.exit(1)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base_dir = ROOT_DIR / "exports" / "full-backup" / timestamp
    base_dir.mkdir(parents=True, exist_ok=True)
    print(f"Complete backup → {base_dir}\n")

    sessions_for_html = {}
    for email in emails:
        try:
            uid = auth.get_user_by_email(email).uid
        except Exception as exc:
            print(f"  ! {email}: cannot resolve uid ({exc}) — skipped")
            continue
        result = backup_user(uid, email, base_dir)
        sessions_for_html[email] = session_export_for_html(
            result["missions"],
            result["runs"],
        )

    # Write a scoped sessions.json and fetch Stitch HTML into this backup dir.
    sessions_path = base_dir / "sessions.json"
    with open(sessions_path, "w", encoding="utf-8") as f:
        json.dump(sessions_for_html, f, ensure_ascii=False, indent=2, default=str)

    print("\nFetching Stitch HTML...")
    env = {
        **os.environ,
        "STITCH_SESSIONS_PATH": str(sessions_path),
        "STITCH_HTML_OUT": str(base_dir / "stitch-html"),
    }
    subprocess.run(["node", "scripts/export_stitch_html.mjs"], env=env, check=False)

    print(f"\nDone. Backup at: {base_dir}")


if __name__ == "__main__":
    main()
