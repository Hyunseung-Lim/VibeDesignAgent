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
    python3 scripts/wipe_users.py --all-participants               # dry run all users with app data
    python3 scripts/wipe_users.py --all-participants --write       # delete all users with app data
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
    "profile_memories",
    "memoryReviewFeedback",
    "referenceSourceAnalyses",
    "memoryRetrievalLogs",
    "memoryClusters",
]
SESSION_SUBCOLLECTIONS = ["memoryDrafts", "reviewTurns"]
ADMIN_EMAILS = {"03leesun@gmail.com", "charlie9807@gmail.com"}

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


def auth_email_for_uid(uid: str) -> str:
    try:
        return auth.get_user(uid).email or uid
    except Exception:
        profile = db.collection("users").document(uid).get()
        if profile.exists:
            email = (profile.to_dict() or {}).get("email")
            if isinstance(email, str) and email:
                return email
        return uid


def resolve_all_participants() -> list[tuple[str, str]]:
    """Users with session, profile/memory, or mission participant data."""
    uids: set[str] = set()
    for doc in db.collection("sessions").stream():
        uids.add(doc.id)
    for doc in db.collection("users").stream():
        uids.add(doc.id)
    for mission_doc in db.collection("missions").stream():
        for part_doc in mission_doc.reference.collection("participants").stream():
            uids.add(part_doc.id)
    targets = [(uid, auth_email_for_uid(uid)) for uid in sorted(uids)]
    return sorted(targets, key=lambda pair: pair[1].lower())


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
        if sub == "profile_memories":
            continue
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

    # Profile fields live on the users/{uid} document itself. Auth identity is
    # kept, but onboarding and mission order are removed for a clean slate.
    profile = user_root.get()
    profile_data = profile.to_dict() or {} if profile.exists else {}
    had_onboarding_completed = "onboardingCompleted" in profile_data
    had_onboarding_completed_at = "onboardingCompletedAt" in profile_data
    had_mission_order = "missionOrder" in profile_data
    counts["users/onboardingCompleted(delete)"] = 1 if had_onboarding_completed else 0
    counts["users/onboardingCompletedAt(delete)"] = (
        1 if had_onboarding_completed_at else 0
    )
    counts["users/missionOrder(reset)"] = 1 if had_mission_order else 0
    if write and profile.exists:
        user_root.update(
            {
                "missionOrder": firestore.DELETE_FIELD,
                "onboardingCompleted": firestore.DELETE_FIELD,
                "onboardingCompletedAt": firestore.DELETE_FIELD,
            }
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
    all_participants = "--all-participants" in sys.argv
    if not args:
        if not all_participants:
            print("Usage: python3 scripts/wipe_users.py <email> [<email> ...] [--write]")
            print("       python3 scripts/wipe_users.py --all-participants [--write]")
            sys.exit(1)

    mode = "DELETE (--write)" if write else "DRY RUN"
    targets: list[tuple[str, str]]
    if all_participants:
        targets = resolve_all_participants()
        print(f"Mode: {mode}\nTargets: all participants with app data ({len(targets)} users)")
    else:
        targets = []
        for email in args:
            try:
                targets.append((auth.get_user_by_email(email).uid, email))
            except Exception as exc:
                print(f"\n  ! {email}: cannot resolve uid ({exc}) — skipped")
        print(f"Mode: {mode}\nTargets: {', '.join(email for _, email in targets)}")

    admin_targets = [email for _, email in targets if email in ADMIN_EMAILS]
    if admin_targets:
        print(f"Admin emails included: {', '.join(admin_targets)}")

    grand = 0
    for uid, email in targets:
        counts = wipe_user(uid, email, write)
        grand += sum(counts.values())

    print(f"\n{'Deleted' if write else 'Would delete'} {grand} documents/files total.")
    if not write:
        print("Dry run only. Re-run with --write to actually delete.")


if __name__ == "__main__":
    main()
