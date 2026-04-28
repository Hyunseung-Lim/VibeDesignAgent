"""
VibeDesignAgent — Session Data Exporter
Usage:
    pip install firebase-admin
    python scripts/export_sessions.py
Output:
    exports/sessions.json                          — all participant session data
    exports/presentations/{email}/{missionTitle}/  — pitch deck slides per participant
"""

import json
import re
import os
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore, storage, auth

# ── Config ────────────────────────────────────────────────────────────────────
KEY_FILE = "vibedesignagent-key.json"
STORAGE_BUCKET = "vibedesignagent.firebasestorage.app"
OUTPUT_DIR = Path("exports")

# ── Init ──────────────────────────────────────────────────────────────────────
cred = credentials.Certificate(KEY_FILE)
firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})

db = firestore.client()
bucket = storage.bucket()

OUTPUT_DIR.mkdir(exist_ok=True)
(OUTPUT_DIR / "presentations").mkdir(exist_ok=True)


def safe_name(s: str, fallback: str) -> str:
    """Convert a string to a filesystem-safe folder name."""
    s = s.strip()
    if not s:
        return fallback
    # Replace characters that are problematic on filesystems
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", s)
    return s[:80]  # cap length


def get_email(uid: str) -> str:
    try:
        return auth.get_user(uid).email or uid
    except Exception:
        return uid


def get_mission_title(mission_id: str, session_data: dict) -> str:
    title = session_data.get("missionTitle", "").strip()
    return title if title else mission_id


def export_sessions():
    """Export all participant session data from Firestore."""
    print("Fetching sessions from Firestore...")
    sessions_data = {}
    uid_to_email = {}

    users_ref = db.collection("sessions")
    for user_doc in users_ref.stream():
        uid = user_doc.id
        email = get_email(uid)
        uid_to_email[uid] = email
        sessions_data[email] = {}

        missions_ref = users_ref.document(uid).collection("missions")
        for mission_doc in missions_ref.stream():
            mission_id = mission_doc.id
            data = mission_doc.to_dict()
            mission_title = data.get("missionTitle") or mission_id
            sessions_data[email][mission_title] = {
                "missionId": mission_id,
                "missionTitle": mission_title,
                "missionBrief": data.get("missionBrief", ""),
                "updatedAt": data.get("updatedAt"),
                "messageCount": len(data.get("messages", [])),
                "messages": data.get("messages", []),
                "ideas": data.get("ideas", []),
                "artboardCount": len(data.get("artboards", [])),
                "presentationSlides": data.get("presentationSlides", []),
                "references": data.get("references", []),
            }
            print(f"  ✓ {email} / {mission_title} — {len(data.get('messages', []))} messages, {len(data.get('ideas', []))} ideas")

    out_path = OUTPUT_DIR / "sessions.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(sessions_data, f, ensure_ascii=False, indent=2, default=str)
    print(f"\nSaved: {out_path} ({len(sessions_data)} users)")
    return sessions_data, uid_to_email


def export_presentation_images(uid_to_email: dict):
    """Download all pitch deck slide images from Firebase Storage."""
    print("\nFetching presentation images from Storage...")

    # Fetch mission titles for path mapping
    mission_titles = {}
    for m_doc in db.collection("missions").stream():
        mission_titles[m_doc.id] = m_doc.to_dict().get("title") or m_doc.id

    blobs = list(bucket.list_blobs(prefix="presentations/"))
    if not blobs:
        print("  No images found.")
        return

    for blob in blobs:
        # presentations/{uid}/{missionId}/slide-N.png
        parts = blob.name.split("/")
        if len(parts) < 4:
            continue
        uid, mission_id, filename = parts[1], parts[2], parts[3]

        email = uid_to_email.get(uid) or get_email(uid)
        mission_title = mission_titles.get(mission_id, mission_id)

        dest_dir = OUTPUT_DIR / "presentations" / safe_name(email, uid) / safe_name(mission_title, mission_id)
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / filename
        blob.download_to_filename(str(dest_path))
        print(f"  ✓ {dest_path}")

    print(f"Downloaded {len(blobs)} images.")


def summarize(sessions_data: dict):
    total_users = len(sessions_data)
    total_sessions = sum(len(m) for m in sessions_data.values())
    total_messages = sum(
        s.get("messageCount", 0)
        for missions in sessions_data.values()
        for s in missions.values()
    )
    total_ideas = sum(
        len(s.get("ideas", []))
        for missions in sessions_data.values()
        for s in missions.values()
    )
    print(f"\n{'='*40}")
    print(f"Participants : {total_users}")
    print(f"Sessions     : {total_sessions}")
    print(f"Messages     : {total_messages}")
    print(f"Ideas saved  : {total_ideas}")
    print(f"{'='*40}")


if __name__ == "__main__":
    sessions, uid_to_email = export_sessions()
    export_presentation_images(uid_to_email)
    summarize(sessions)
    print("\nDone. Check the exports/ folder.")
