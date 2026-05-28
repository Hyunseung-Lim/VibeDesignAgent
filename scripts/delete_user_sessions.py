"""
VibeDesignAgent — Backup, then delete all sessions for a specific user
Usage:
    python3 scripts/delete_user_sessions.py <userId>
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import firebase_admin
from firebase_admin import auth, credentials, firestore, storage

KEY_FILE = "vibedesignagent-key.json"
STORAGE_BUCKET = "vibedesignagent.firebasestorage.app"
EXPORT_ROOT = Path("exports") / "deleted-users"

cred = credentials.Certificate(KEY_FILE)
firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})

db = firestore.client()
bucket = storage.bucket()


def safe_name(value: str, fallback: str) -> str:
    value = value.strip() or fallback
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value)
    return value[:100]


def get_email(uid: str) -> str:
    try:
        return auth.get_user(uid).email or uid
    except Exception:
        return uid


def export_collection_documents(collection_ref):
    docs = []
    for doc in collection_ref.stream():
        docs.append({
            "id": doc.id,
            **(doc.to_dict() or {}),
        })
    return docs


def backup_user_data(uid: str) -> Path:
    email = get_email(uid)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_dir = EXPORT_ROOT / f"{timestamp}-{safe_name(email, uid)}"
    backup_dir.mkdir(parents=True, exist_ok=False)

    sessions = {
        "legacyMissionSessions": {},
        "missionRuns": {},
    }
    missions_ref = db.collection("sessions").document(uid).collection("missions")
    for mission_doc in missions_ref.stream():
        data = mission_doc.to_dict() or {}
        sessions["legacyMissionSessions"][mission_doc.id] = {
            "id": mission_doc.id,
            **data,
            "memoryDrafts": export_collection_documents(
                mission_doc.reference.collection("memoryDrafts")
            ),
        }
    runs_ref = db.collection("sessions").document(uid).collection("missionRuns")
    for run_doc in runs_ref.stream():
        data = run_doc.to_dict() or {}
        sessions["missionRuns"][run_doc.id] = {
            "id": run_doc.id,
            **data,
            "memoryDrafts": export_collection_documents(
                run_doc.reference.collection("memoryDrafts")
            ),
        }

    user_ref = db.collection("users").document(uid)
    memories = {
        "episodicMemories": export_collection_documents(user_ref.collection("episodicMemories")),
        "semanticMemories": export_collection_documents(user_ref.collection("semanticMemories")),
        "memories_0_1_1": export_collection_documents(user_ref.collection("memories_0_1_1")),
        "memories_0_1_2": export_collection_documents(user_ref.collection("memories_0_1_2")),
    }

    storage_dir = backup_dir / "presentations"
    storage_dir.mkdir(exist_ok=True)
    storage_files = []
    for blob in bucket.list_blobs(prefix=f"presentations/{uid}/"):
        relative_path = blob.name.removeprefix(f"presentations/{uid}/")
        if not relative_path:
            continue
        dest = storage_dir / safe_name(relative_path.replace("/", "__"), blob.name)
        blob.download_to_filename(str(dest))
        storage_files.append({
            "name": blob.name,
            "backupPath": str(dest.relative_to(backup_dir)),
            "size": blob.size,
            "updated": blob.updated.isoformat() if blob.updated else None,
        })

    payload = {
        "uid": uid,
        "email": email,
        "exportedAt": timestamp,
        "sessions": sessions,
        "memories": memories,
        "storageFiles": storage_files,
    }
    with open(backup_dir / "backup.json", "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2, default=str)

    print(f"Backup saved: {backup_dir}")
    print(
        "  Sessions: "
        f"{len(sessions['legacyMissionSessions'])} legacy, "
        f"{len(sessions['missionRuns'])} runs"
    )
    print(
        "  Memories: "
        f"{len(memories['episodicMemories'])} episodic, "
        f"{len(memories['semanticMemories'])} semantic, "
        f"{len(memories['memories_0_1_1'])} v0.1.1, "
        f"{len(memories['memories_0_1_2'])} v0.1.2"
    )
    print(f"  Storage files: {len(storage_files)}")
    return backup_dir


def delete_firestore_sessions(uid: str):
    session_root = db.collection("sessions").document(uid)
    session_refs = [
        *list(session_root.collection("missions").stream()),
        *list(session_root.collection("missionRuns").stream()),
    ]
    for session_doc in session_refs:
        drafts = list(session_doc.reference.collection("memoryDrafts").stream())
        for draft in drafts:
            draft.reference.delete()
            print(f"  Firestore deleted: {session_doc.reference.path}/memoryDrafts/{draft.id}")
        session_doc.reference.delete()
        print(f"  Firestore deleted: {session_doc.reference.path}")
    session_root.delete()
    print(f"  Firestore deleted: sessions/{uid}")


def delete_storage_files(uid: str):
    blobs = list(bucket.list_blobs(prefix=f"presentations/{uid}/"))
    for blob in blobs:
        blob.delete()
        print(f"  Storage deleted: {blob.name}")
    if not blobs:
        print(f"  Storage: no files found for {uid}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/delete_user_sessions.py <userId>")
        sys.exit(1)

    uid = sys.argv[1]
    print(f"Backing up, then deleting session data for user: {uid}\n")
    backup_dir = backup_user_data(uid)

    confirm = input(f"Backup completed at {backup_dir}. Delete sessions/storage now? (yes/no): ")
    if confirm.lower() != "yes":
        print("Cancelled.")
        sys.exit(0)

    delete_firestore_sessions(uid)
    delete_storage_files(uid)
    print("\nDone.")
