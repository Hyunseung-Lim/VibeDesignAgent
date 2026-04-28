"""
VibeDesignAgent — Delete all sessions for a specific user
Usage:
    python scripts/delete_user_sessions.py <userId>
"""

import sys
import firebase_admin
from firebase_admin import credentials, firestore, storage

KEY_FILE = "vibedesignagent-key.json"
STORAGE_BUCKET = "vibedesignagent.firebasestorage.app"

cred = credentials.Certificate(KEY_FILE)
firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})

db = firestore.client()
bucket = storage.bucket()


def delete_firestore_sessions(uid: str):
    missions_ref = db.collection("sessions").document(uid).collection("missions")
    missions = list(missions_ref.stream())
    for m in missions:
        m.reference.delete()
        print(f"  Firestore deleted: sessions/{uid}/missions/{m.id}")
    db.collection("sessions").document(uid).delete()
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
    print(f"Deleting all data for user: {uid}\n")

    confirm = input("Are you sure? (yes/no): ")
    if confirm.lower() != "yes":
        print("Cancelled.")
        sys.exit(0)

    delete_firestore_sessions(uid)
    delete_storage_files(uid)
    print("\nDone.")
