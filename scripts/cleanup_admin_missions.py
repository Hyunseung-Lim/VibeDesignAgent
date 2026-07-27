"""
VibeDesignAgent — Remove non-onboarding mission records for admin accounts,
and drop the leftover profile shell of the duplicate kaithape account.

Onboarding is preserved everywhere: sessions/{uid}/missions/onboarding, its
memories, profile_memories, review feedback, snapshots and logs all stay.

Everything deleted is backed up first to exports/admin-cleanup-<stamp>/.

Usage:
    python3 scripts/cleanup_admin_missions.py            # dry run (default)
    python3 scripts/cleanup_admin_missions.py --write    # back up, then delete
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore, storage

KEY_FILE = "vibedesignagent-key.json"
STORAGE_BUCKET = "vibedesignagent.firebasestorage.app"
KEEP_MISSION = "onboarding"

# Hard allowlist. Any uid not listed here is never touched by this script.
ADMIN_TARGETS = {
    "VNHekxTEvaTWphZ5Yi6jTgLmDCt1": "03leesun@gmail.com",
    "p0jQQQdzsLPnOmhLfC0Wvvg421y1": "charlie9807@gmail.com",
    "PCXC0ogyZddo3FH9dBU3XjyCO282": "vivian@u.sogang.ac.kr",
}
# Duplicate account: only the leftover users/{uid} profile shell remains.
KAITHAPE_UID = "SucP2K6sG5QFSrhulj0UkV1Ekg03"
KAITHAPE_EMAIL = "kaithape@gmail.com"
# Never delete — the real Suyeon Nam account.
PRESERVE_UIDS = {"jJGTO1v5QmYEfdtBfmKpUvwPSBo2"}

WRITE = "--write" in sys.argv

firebase_admin.initialize_app(
    credentials.Certificate(KEY_FILE), {"storageBucket": STORAGE_BUCKET}
)
db = firestore.client()
bucket = storage.bucket()

STAMP = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
BACKUP_DIR = Path("exports") / f"admin-cleanup-{STAMP}"


def mission_of(data: dict, doc_id: str) -> str | None:
    """Mission a document belongs to, via field or mission-id-prefixed doc id."""
    mid = data.get("missionId") or (data.get("source") or {}).get("missionId")
    if mid:
        return mid
    if doc_id == KEEP_MISSION or doc_id.startswith(f"{KEEP_MISSION}_"):
        return KEEP_MISSION
    if doc_id.startswith("mission-"):
        return doc_id.split("_")[0]
    return None


def plan_user(uid: str, email: str) -> dict:
    """Collect every doc/blob that would be deleted, plus a backup payload."""
    assert uid not in PRESERVE_UIDS, f"refusing to touch preserved uid {uid}"
    doomed_docs = []   # (label, DocumentReference, dict payload)
    doomed_blobs = []
    kept = {"missions": [], "memories": 0, "unscoped_memories": 0}

    sroot = db.collection("sessions").document(uid)
    for kind in ("missions", "missionRuns"):
        for doc in sroot.collection(kind).stream():
            if doc.id == KEEP_MISSION:
                kept["missions"].append(doc.id)
                continue
            data = doc.to_dict() or {}
            subs = {}
            for sub in ("memoryDrafts", "reviewTurns"):
                for s in doc.reference.collection(sub).stream():
                    subs.setdefault(sub, []).append({"id": s.id, **(s.to_dict() or {})})
                    doomed_docs.append((f"sessions/{kind}/{doc.id}/{sub}", s.reference, None))
            doomed_docs.append(
                (f"sessions/{kind}", doc.reference, {"id": doc.id, **data, "_subcollections": subs})
            )

    u = db.collection("users").document(uid)

    for doc in u.collection("memories_0_1_2").stream():
        data = doc.to_dict() or {}
        mid = (data.get("source") or {}).get("missionId")
        if mid == KEEP_MISSION:
            kept["memories"] += 1
            continue
        if not mid:
            kept["unscoped_memories"] += 1  # no mission attribution -> keep, report
            continue
        doomed_docs.append(("users/memories_0_1_2", doc.reference, {"id": doc.id, **data}))

    for doc in u.collection("profile_memories").stream():
        if doc.id == KEEP_MISSION:
            continue
        for rev in doc.reference.collection("revisions").stream():
            doomed_docs.append(("users/profile_memories/revisions", rev.reference, {"id": rev.id, **(rev.to_dict() or {})}))
        doomed_docs.append(("users/profile_memories", doc.reference, {"id": doc.id, **(doc.to_dict() or {})}))

    for col in ("memoryReviewFeedback", "memoryClusterSnapshots", "memoryRetrievalLogs", "memoryActivationLogs"):
        for doc in u.collection(col).stream():
            data = doc.to_dict() or {}
            if mission_of(data, doc.id) == KEEP_MISSION:
                continue
            doomed_docs.append((f"users/{col}", doc.reference, {"id": doc.id, **data}))

    # Cluster cache is keyed by item signature, not mission: drop it all so the
    # next view regenerates from the surviving onboarding-only memory set.
    for doc in u.collection("memoryClusters").stream():
        doomed_docs.append(("users/memoryClusters(cache)", doc.reference, {"id": doc.id}))

    for mdoc in db.collection("missions").stream():
        if mdoc.id == KEEP_MISSION:
            continue
        ref = mdoc.reference.collection("participants").document(uid)
        snap = ref.get()
        if snap.exists:
            doomed_docs.append(("missions/*/participants", ref, {"id": f"{mdoc.id}/{uid}", **(snap.to_dict() or {})}))

    for blob in bucket.list_blobs(prefix=f"chatImages/{uid}/"):
        parts = blob.name.split("/")
        if len(parts) > 2 and parts[2] == KEEP_MISSION:
            continue
        doomed_blobs.append(blob)

    return {"uid": uid, "email": email, "docs": doomed_docs, "blobs": doomed_blobs, "kept": kept}


def report(plan: dict):
    from collections import Counter
    c = Counter(label for label, _, _ in plan["docs"])
    print(f"\n{'=' * 92}\n{plan['email']}  ({plan['uid']})\n{'=' * 92}")
    for label, n in sorted(c.items()):
        print(f"  {'DELETE' if WRITE else 'would delete'} {n:>5}  {label}")
    if plan["blobs"]:
        print(f"  {'DELETE' if WRITE else 'would delete'} {len(plan['blobs']):>5}  storage/chatImages")
    k = plan["kept"]
    print(f"  KEEP: onboarding session={k['missions']}  onboarding memories={k['memories']}"
          + (f"  unscoped memories kept={k['unscoped_memories']}" if k["unscoped_memories"] else ""))
    print(f"  KEEP: users/{{uid}} profile doc, referenceSourceAnalyses cache")
    return sum(c.values()) + len(plan["blobs"])


def main():
    print(f"Mode: {'WRITE (backup then delete)' if WRITE else 'DRY RUN'}")
    print(f"Preserved uids (never touched): {sorted(PRESERVE_UIDS)}")

    plans = [plan_user(uid, email) for uid, email in ADMIN_TARGETS.items()]
    total = sum(report(p) for p in plans)

    kai = db.collection("users").document(KAITHAPE_UID)
    kai_snap = kai.get()
    print(f"\n{'=' * 92}\n{KAITHAPE_EMAIL}  ({KAITHAPE_UID})  — duplicate account\n{'=' * 92}")
    print(f"  {'DELETE' if WRITE else 'would delete'} {1 if kai_snap.exists else 0:>5}  users/{{uid}} profile doc")
    print("  NOTE: Firebase Auth identity is left intact; a fresh login recreates this doc.")
    total += 1 if kai_snap.exists else 0

    print(f"\n{'-' * 92}\nTotal: {total} documents/files")

    if not WRITE:
        print("Dry run only. Re-run with --write to back up and delete.")
        return

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    for p in plans:
        payload = {
            "uid": p["uid"], "email": p["email"], "exportedAt": STAMP,
            "deletedDocs": [
                {"label": label, "path": ref.path, "data": data}
                for label, ref, data in p["docs"] if data is not None
            ],
            "deletedBlobs": [{"name": b.name, "size": b.size} for b in p["blobs"]],
            "kept": p["kept"],
        }
        out = BACKUP_DIR / f"{p['email'].replace('@', '_at_')}.json"
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        print(f"  backup written: {out}  ({out.stat().st_size / 1e6:.1f}MB)")

    if kai_snap.exists:
        out = BACKUP_DIR / "kaithape_at_gmail.com.json"
        out.write_text(json.dumps(
            {"uid": KAITHAPE_UID, "email": KAITHAPE_EMAIL, "profile": kai_snap.to_dict()},
            ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        print(f"  backup written: {out}")

    print("\nDeleting...")
    for p in plans:
        for _, ref, _ in p["docs"]:
            ref.delete()
        for b in p["blobs"]:
            b.delete()
        print(f"  {p['email']}: {len(p['docs'])} docs, {len(p['blobs'])} blobs deleted")
    if kai_snap.exists:
        kai.delete()
        print(f"  {KAITHAPE_EMAIL}: profile doc deleted")

    print(f"\nDone. Backup: {BACKUP_DIR}")


if __name__ == "__main__":
    main()
