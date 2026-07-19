"""
VibeDesignAgent — Session Data Exporter
Usage:
    pip install firebase-admin
    python scripts/export_sessions.py
Env:
    EXPORT_OUTPUT_DIR    — output directory (default: exports)
    EXPORT_SKIP_ASSETS=1 — skip presentation images + Stitch HTML (Firestore JSON only)
Output:
    exports/sessions.json                          — all participant session data
    exports/memories.json                          — confirmed memories + review feedback + cluster snapshots
    exports/presentations/{email}/{missionTitle}/  — pitch deck slides per participant
    exports/stitch-html/                           — Stitch-backed artboard HTML snapshots
"""

import json
import re
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore, storage, auth

# ── Config ────────────────────────────────────────────────────────────────────
KEY_FILE = "vibedesignagent-key.json"
STORAGE_BUCKET = "vibedesignagent.firebasestorage.app"
OUTPUT_DIR = Path(os.environ.get("EXPORT_OUTPUT_DIR", "exports"))
SKIP_ASSETS = os.environ.get("EXPORT_SKIP_ASSETS") == "1"
MEMORY_SCHEMA_VERSION = "0.1.0"

# ── Init ──────────────────────────────────────────────────────────────────────
cred = credentials.Certificate(KEY_FILE)
firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})

db = firestore.client()
bucket = storage.bucket()

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
(OUTPUT_DIR / "presentations").mkdir(parents=True, exist_ok=True)


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


def make_session_export(mission_id: str, data: dict, memory_drafts: list, session_run_id=None):
    """Shape one legacy mission session or versioned run for JSON export."""
    mission_title = data.get("missionTitle") or mission_id
    payload = {
        "missionId": mission_id,
        "missionTitle": mission_title,
        "missionBrief": data.get("missionBrief", ""),
        "updatedAt": data.get("updatedAt"),
        "messageCount": len(data.get("messages", [])),
        "messages": data.get("messages", []),
        "ideas": data.get("ideas", []),
        "artboardCount": len(data.get("artboards", [])),
        "artboards": data.get("artboards", []),
        "activityLog": data.get("activityLog", []),
        "stitchProjectId": data.get("stitchProjectId"),
        "presentationSlides": data.get("presentationSlides", []),
        "presentationHtml": data.get("presentationHtml"),
        "references": data.get("references", []),
        "selectedOptionId": data.get("selectedOptionId"),
        "selectedDevice": data.get("selectedDevice"),
        "timerStartedAt": data.get("timerStartedAt"),
        "startedAt": data.get("startedAt"),
        "endedAt": data.get("endedAt"),
        "status": data.get("status"),
        "memoryDraftCount": len(memory_drafts),
        "memoryDrafts": memory_drafts,
    }
    if session_run_id:
        payload["sessionRunId"] = session_run_id
        payload["sessionKind"] = data.get("sessionKind") or "missionRun"
    else:
        payload["sessionKind"] = data.get("sessionKind") or "legacyMissionSession"
    return payload


def export_collection_documents(collection_ref):
    """Export Firestore documents with their document ids preserved."""
    docs = []
    for doc in collection_ref.stream():
        docs.append({
            "id": doc.id,
            **(doc.to_dict() or {}),
        })
    return docs


def export_sessions():
    """Export all participant session data from Firestore."""
    print("Fetching sessions from Firestore...")
    sessions_data = {}
    uid_to_email = {}

    candidate_uids = set()
    for user_doc in db.collection("sessions").stream():
        candidate_uids.add(user_doc.id)
    for user_doc in db.collection("users").stream():
        candidate_uids.add(user_doc.id)
    try:
        candidate_uids.update(list_auth_uids())
    except Exception as exc:
        print(f"  Auth user listing skipped: {exc}")

    users_ref = db.collection("sessions")
    for uid in sorted(candidate_uids):
        email = get_email(uid)
        uid_to_email[uid] = email

        missions_ref = users_ref.document(uid).collection("missions")
        user_sessions = {}
        for mission_doc in missions_ref.stream():
            mission_id = mission_doc.id
            data = mission_doc.to_dict()
            mission_title = data.get("missionTitle") or mission_id
            memory_drafts = export_collection_documents(
                mission_doc.reference.collection("memoryDrafts")
            )
            user_sessions[mission_title] = make_session_export(
                mission_id,
                data,
                memory_drafts,
            )
            print(f"  ✓ {email} / {mission_title} — {len(data.get('messages', []))} messages, {len(data.get('ideas', []))} ideas")

        runs_ref = users_ref.document(uid).collection("missionRuns")
        for run_doc in runs_ref.stream():
            run_id = run_doc.id
            data = run_doc.to_dict()
            mission_id = data.get("missionId") or run_id
            mission_title = data.get("missionTitle") or mission_id
            memory_drafts = export_collection_documents(
                run_doc.reference.collection("memoryDrafts")
            )
            export_key = f"{mission_title} / {run_id}"
            user_sessions[export_key] = make_session_export(
                mission_id,
                data,
                memory_drafts,
                session_run_id=run_id,
            )
            print(f"  ✓ {email} / {mission_title} / {run_id} — {len(data.get('messages', []))} messages, {len(data.get('ideas', []))} ideas")

        if user_sessions:
            sessions_data[email] = user_sessions

    out_path = OUTPUT_DIR / "sessions.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(sessions_data, f, ensure_ascii=False, indent=2, default=str)
    print(f"\nSaved: {out_path} ({len(sessions_data)} users)")
    return sessions_data, uid_to_email


def list_auth_uids():
    """List Firebase Auth users so memories are not missed when no session doc exists."""
    uids = []
    page = auth.list_users()
    while page:
        uids.extend(user.uid for user in page.users)
        page = page.get_next_page()
    return uids


def export_memories(uid_to_email: dict):
    """Export confirmed long-term memory collections from users/{uid}."""
    print("\nFetching confirmed memories from Firestore...")
    memories_data = {}
    candidate_uids = set(uid_to_email)

    for user_doc in db.collection("users").stream():
        candidate_uids.add(user_doc.id)

    try:
        candidate_uids.update(list_auth_uids())
    except Exception as exc:
        print(f"  Auth user listing skipped: {exc}")

    for uid in sorted(candidate_uids):
        email = uid_to_email.get(uid) or get_email(uid)
        user_ref = db.collection("users").document(uid)
        episodic = export_collection_documents(user_ref.collection("episodicMemories"))
        semantic = export_collection_documents(user_ref.collection("semanticMemories"))
        # Current confirmed memory items live in versioned collections
        # (src/lib/server/memoryItems.ts MEMORY_COLLECTION) — the legacy
        # episodic/semantic collections above are kept for old exports only.
        confirmed = export_collection_documents(user_ref.collection("memories_0_1_2"))
        confirmed_prev = export_collection_documents(
            user_ref.collection("memories_0_1_1")
        )
        review_feedback = export_collection_documents(
            user_ref.collection("memoryReviewFeedback")
        )
        cluster_snapshots = export_collection_documents(
            user_ref.collection("memoryClusterSnapshots")
        )
        cluster_caches = export_collection_documents(
            user_ref.collection("memoryClusters")
        )
        activation_logs = export_collection_documents(
            user_ref.collection("memoryActivationLogs")
        )
        if not (
            episodic
            or semantic
            or confirmed
            or confirmed_prev
            or review_feedback
            or cluster_snapshots
            or cluster_caches
            or activation_logs
        ):
            continue
        memories_data[email] = {
            "uid": uid,
            "schemaVersion": MEMORY_SCHEMA_VERSION,
            "episodicMemories": episodic,
            "semanticMemories": semantic,
            "memories_0_1_2": confirmed,
            "memories_0_1_1": confirmed_prev,
            "memoryReviewFeedback": review_feedback,
            "memoryClusterSnapshots": cluster_snapshots,
            "memoryClusters": cluster_caches,
            "memoryActivationLogs": activation_logs,
        }
        print(
            f"  ✓ {email} — {len(confirmed)} confirmed (0_1_2), "
            f"{len(confirmed_prev)} prev (0_1_1), "
            f"{len(episodic)} episodic, {len(semantic)} semantic, "
            f"{len(review_feedback)} review feedback, "
            f"{len(cluster_snapshots)} cluster snapshots, "
            f"{len(cluster_caches)} cluster caches, "
            f"{len(activation_logs)} activation logs"
        )

    export_payload = {
        "_meta": {
            "kind": "memory-export",
            "schemaVersion": MEMORY_SCHEMA_VERSION,
            "sourceCollections": [
                "episodicMemories",
                "semanticMemories",
                "memories_0_1_2",
                "memories_0_1_1",
                "memoryReviewFeedback",
                "memoryClusterSnapshots",
                "memoryClusters",
                "memoryActivationLogs",
            ],
            "exportedAt": datetime.now(timezone.utc).isoformat(),
        },
        "users": memories_data,
    }

    out_path = OUTPUT_DIR / "memories.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(export_payload, f, ensure_ascii=False, indent=2, default=str)
    print(f"\nSaved: {out_path} ({len(memories_data)} users)")
    return memories_data


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


def export_stitch_html_snapshots():
    """Fetch Stitch-backed artboard HTML into local export files."""
    print("\nFetching Stitch HTML snapshots...")
    script_path = Path("scripts/export_stitch_html.mjs")
    if not script_path.exists():
        print("  Stitch HTML export skipped: script not found.")
        return

    env = os.environ.copy()
    env.setdefault("STITCH_SESSIONS_PATH", str((OUTPUT_DIR / "sessions.json").resolve()))
    env.setdefault("STITCH_HTML_OUT", str((OUTPUT_DIR / "stitch-html").resolve()))
    result = subprocess.run(
        ["node", str(script_path)],
        check=False,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        print(f"  Stitch HTML export failed with exit code {result.returncode}.")


def summarize(sessions_data: dict, memories_data: dict):
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
    total_memory_drafts = sum(
        s.get("memoryDraftCount", 0)
        for missions in sessions_data.values()
        for s in missions.values()
    )
    total_episodic = sum(
        len(user.get("episodicMemories", []))
        for user in memories_data.values()
    )
    total_semantic = sum(
        len(user.get("semanticMemories", []))
        for user in memories_data.values()
    )
    total_confirmed = sum(
        len(user.get("memories_0_1_2", []))
        for user in memories_data.values()
    )
    total_review_feedback = sum(
        len(user.get("memoryReviewFeedback", []))
        for user in memories_data.values()
    )
    total_cluster_snapshots = sum(
        len(user.get("memoryClusterSnapshots", []))
        for user in memories_data.values()
    )
    print(f"\n{'='*40}")
    print(f"Participants : {total_users}")
    print(f"Sessions     : {total_sessions}")
    print(f"Messages     : {total_messages}")
    print(f"Ideas saved  : {total_ideas}")
    print(f"Memory drafts: {total_memory_drafts}")
    print(f"Episodic mem.: {total_episodic}")
    print(f"Semantic mem.: {total_semantic}")
    print(f"Confirmed mem: {total_confirmed}")
    print(f"Review feedbk: {total_review_feedback}")
    print(f"Cluster snaps: {total_cluster_snapshots}")
    print(f"{'='*40}")


if __name__ == "__main__":
    sessions, uid_to_email = export_sessions()
    memories = export_memories(uid_to_email)
    if SKIP_ASSETS:
        print("\nSkipping presentation images + Stitch HTML (EXPORT_SKIP_ASSETS=1).")
    else:
        export_presentation_images(uid_to_email)
        export_stitch_html_snapshots()
    summarize(sessions, memories)
    print(f"\nDone. Check the {OUTPUT_DIR}/ folder.")
