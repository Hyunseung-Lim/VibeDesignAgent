"""
Delete a versioned memory subcollection for all users.

Usage:
    python3 scripts/delete_memory_collection.py
    python3 scripts/delete_memory_collection.py --collection memories_0_1_2 --write

Default mode is a dry run. Use --write to actually delete documents.
"""

import argparse

import firebase_admin
from firebase_admin import auth, credentials, firestore


KEY_FILE = "vibedesignagent-key.json"
DEFAULT_COLLECTION = "memories_0_1_2"


def init_firestore():
    if not firebase_admin._apps:
        cred = credentials.Certificate(KEY_FILE)
        firebase_admin.initialize_app(cred)
    return firestore.client()


def list_auth_uids():
    uids = []
    page = auth.list_users()
    while page:
        uids.extend(user.uid for user in page.users)
        page = page.get_next_page()
    return uids


def candidate_uids(db):
    uids = set()
    for collection_name in ("users", "sessions"):
        for doc in db.collection(collection_name).stream():
            uids.add(doc.id)
    try:
        uids.update(list_auth_uids())
    except Exception as exc:
        print(f"Auth user listing skipped: {exc}")
    return sorted(uids)


def delete_collection(args):
    db = init_firestore()
    total = 0
    deleted = 0
    for uid in candidate_uids(db):
        docs = list(
            db.collection("users")
            .document(uid)
            .collection(args.collection)
            .stream()
        )
        if not docs:
            continue
        total += len(docs)
        print(f"{uid}: {len(docs)} docs")
        if args.write:
            for doc in docs:
                doc.reference.delete()
                deleted += 1

    if args.write:
        print(f"\nDeleted {deleted} docs from users/*/{args.collection}.")
    else:
        print(f"\nDry run. Found {total} docs in users/*/{args.collection}.")
        print("Pass --write to delete them.")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection", default=DEFAULT_COLLECTION)
    parser.add_argument("--write", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    delete_collection(parse_args())
