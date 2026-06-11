"""
VibeDesignAgent — Delete all per-user data for the given users (by email).

Deletes (Auth accounts are NOT touched, only their data):
  - sessions/{uid}/missions/{mid}     (+ memoryDrafts, reviewTurns) and the doc
  - sessions/{uid}/missionRuns/{rid}  (+ memoryDrafts, reviewTurns) and the doc
  - sessions/{uid}                    (the session root doc)
  - users/{uid}/memories_0_1_2, memories_0_1_1, episodicMemories, semanticMemories
  - users/{uid}/profile_memories/{mid} (+ revisions)
  - users/{uid}/memoryRetrievalLogs
  - users/{uid}/memoryClusters
  - Storage: presentations/{uid}/*

Usage:
    python3 scripts/wipe_users.py <email> [<email> ...]            # dry run (counts only)
    python3 scripts/wipe_users.py <email> [<email> ...] --write    # actually delete
"""

import sys

import firebase_admin
from firebase_admin import auth, credentials, firestore, storage

KEY_FILE = "vibedesignagent-key.json"
STORAGE_BUCKET = "vibedesignagent.firebasestorage.app"

USER_SUBCOLLECTIONS = [
    "memories_0_1_2",
    "memories_0_1_1",
    "episodicMemories",
    "semanticMemories",
    "memoryRetrievalLogs",
    "memoryClusters",
]
SESSION_SUBCOLLECTIONS = ["memoryDrafts", "reviewTurns"]

firebase_admin.initialize_app(
    credentials.Certificate(KEY_FILE), {"storageBucket": STORAGE_BUCKET}
)
db = firestore.client()
bucket = storage.bucket()


def count_or_delete_collection(collection_ref, write: bool) -> int:
    n = 0
    for doc in collection_ref.stream():
        n += 1
        if write:
            doc.reference.delete()
    return n


def wipe_user(uid: str, email: str, write: bool) -> dict:
    counts = {}

    # sessions: missions + missionRuns, each with subcollections, then the docs
    session_root = db.collection("sessions").document(uid)
    for kind in ("missions", "missionRuns"):
        kind_total = 0
        sub_total = 0
        for doc in session_root.collection(kind).stream():
            kind_total += 1
            for sub in SESSION_SUBCOLLECTIONS:
                sub_total += count_or_delete_collection(
                    doc.reference.collection(sub), write
                )
            if write:
                doc.reference.delete()
        counts[f"sessions/{kind}"] = kind_total
        counts[f"sessions/{kind}/*subdocs"] = sub_total
    if write:
        session_root.delete()

    # users subcollections
    user_root = db.collection("users").document(uid)
    for sub in USER_SUBCOLLECTIONS:
        counts[f"users/{sub}"] = count_or_delete_collection(
            user_root.collection(sub), write
        )

    # profile_memories + their revisions
    pm_total = 0
    rev_total = 0
    for doc in user_root.collection("profile_memories").stream():
        pm_total += 1
        rev_total += count_or_delete_collection(
            doc.reference.collection("revisions"), write
        )
        if write:
            doc.reference.delete()
    counts["users/profile_memories"] = pm_total
    counts["users/profile_memories/*revisions"] = rev_total

    # onboarding completion flag lives on the users/{uid} profile doc itself.
    # We keep account identity (displayName/email/photoURL) but reset onboarding
    # so the user is treated as never-onboarded (clean slate), matching the
    # app's own "reset onboarding" behavior.
    profile = user_root.get()
    onboarded = bool((profile.to_dict() or {}).get("onboardingCompleted")) if profile.exists else False
    counts["users/onboardingCompleted(reset)"] = 1 if onboarded else 0
    if write and onboarded:
        user_root.update(
            {"onboardingCompleted": False, "onboardingCompletedAt": None}
        )

    # mission participation records: missions/{missionId}/participants/{uid}
    # (drives the admin user/mission list; lives outside sessions/ and users/)
    participant_total = 0
    for mission_doc in db.collection("missions").stream():
        part_ref = mission_doc.reference.collection("participants").document(uid)
        if part_ref.get().exists:
            participant_total += 1
            if write:
                part_ref.delete()
    counts["missions/*/participants"] = participant_total

    # storage presentations
    blobs = list(bucket.list_blobs(prefix=f"presentations/{uid}/"))
    counts["storage/presentations"] = len(blobs)
    if write:
        for blob in blobs:
            blob.delete()

    print(f"\n{email} ({uid}):")
    for k, v in counts.items():
        if v:
            print(f"  {'deleted' if write else 'would delete'} {v:>4}  {k}")
    return counts


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    if not args:
        print("Usage: python3 scripts/wipe_users.py <email> [<email> ...] [--write]")
        sys.exit(1)

    mode = "DELETE (--write)" if write else "DRY RUN"
    print(f"Mode: {mode}\nTargets: {', '.join(args)}")

    grand = 0
    for email in args:
        try:
            uid = auth.get_user_by_email(email).uid
        except Exception as exc:
            print(f"\n  ! {email}: cannot resolve uid ({exc}) — skipped")
            continue
        counts = wipe_user(uid, email, write)
        grand += sum(counts.values())

    print(f"\n{'Deleted' if write else 'Would delete'} {grand} documents/files total.")
    if not write:
        print("Dry run only. Re-run with --write to actually delete.")


if __name__ == "__main__":
    main()
