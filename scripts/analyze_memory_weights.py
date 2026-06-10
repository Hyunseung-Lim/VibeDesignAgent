"""
VibeDesignAgent - Memory weight analyzer (READ ONLY)

Usage:
    python3 scripts/analyze_memory_weights.py
    python3 scripts/analyze_memory_weights.py --uid <uid>

Reads users/{uid}/memories_0_1_2 weights and users/{uid}/memoryRetrievalLogs
scoreDeltas to show how memory weight is actually moving in production. Writes
nothing. Helps decide whether "weight only increases, never decreases" is real.
"""

import argparse
from collections import Counter

KEY_FILE = "vibedesignagent-key.json"
MEMORY_COLLECTION = "memories_0_1_2"
RETRIEVAL_LOG_COLLECTION = "memoryRetrievalLogs"
DEFAULT_WEIGHT = 0.5


def init_firestore():
    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        cred = credentials.Certificate(KEY_FILE)
        firebase_admin.initialize_app(cred)
    return firestore.client()


def bucket(weight):
    if weight is None:
        return "none"
    if weight < 0.1 + 1e-9:
        return "<=0.1 (floor)"
    if weight < 0.5 - 1e-9:
        return "0.1-0.5 (below default)"
    if abs(weight - DEFAULT_WEIGHT) < 1e-9:
        return "==0.5 (default/untouched)"
    if weight < 1.0 - 1e-9:
        return "0.5-1.0 (raised)"
    return "==1.0 (ceiling)"


def analyze_user(db, uid):
    mem_docs = list(db.collection(f"users/{uid}/{MEMORY_COLLECTION}").stream())
    if not mem_docs:
        return None

    weights = []
    retrieved_counts = []
    for d in mem_docs:
        data = d.to_dict() or {}
        w = data.get("weight")
        weights.append(w if isinstance(w, (int, float)) else None)
        rc = data.get("retrievedCount")
        retrieved_counts.append(rc if isinstance(rc, (int, float)) else 0)

    buckets = Counter(bucket(w) for w in weights)
    valid = [w for w in weights if isinstance(w, (int, float))]

    # Retrieval logs: count increase vs decrease events from scoreDeltas + nearMissDeltas
    inc = dec = zero = 0
    inc_sum = dec_sum = 0.0
    log_docs = list(db.collection(f"users/{uid}/{RETRIEVAL_LOG_COLLECTION}").stream())
    for d in log_docs:
        data = d.to_dict() or {}
        for key in ("scoreDeltas", "nearMissDeltas"):
            for item in data.get(key) or []:
                wd = item.get("weightDelta")
                if not isinstance(wd, (int, float)):
                    continue
                if wd > 0:
                    inc += 1
                    inc_sum += wd
                elif wd < 0:
                    dec += 1
                    dec_sum += wd
                else:
                    zero += 1

    return {
        "uid": uid,
        "memCount": len(mem_docs),
        "buckets": buckets,
        "weightMin": min(valid) if valid else None,
        "weightMax": max(valid) if valid else None,
        "weightMean": round(sum(valid) / len(valid), 4) if valid else None,
        "everRetrieved": sum(1 for rc in retrieved_counts if rc and rc > 0),
        "logCount": len(log_docs),
        "incEvents": inc,
        "decEvents": dec,
        "zeroEvents": zero,
        "incSum": round(inc_sum, 4),
        "decSum": round(dec_sum, 4),
    }


def print_report(r):
    print(f"\n=== uid={r['uid']} ===")
    print(f"memories: {r['memCount']}  (ever retrieved: {r['everRetrieved']})")
    print(f"weight  min/mean/max: {r['weightMin']} / {r['weightMean']} / {r['weightMax']}")
    print("weight distribution:")
    for label in [
        "<=0.1 (floor)",
        "0.1-0.5 (below default)",
        "==0.5 (default/untouched)",
        "0.5-1.0 (raised)",
        "==1.0 (ceiling)",
        "none",
    ]:
        if r["buckets"].get(label):
            print(f"  {label:32s} {r['buckets'][label]}")
    print(f"retrieval logs: {r['logCount']}")
    print(
        f"  weightDelta events  +{r['incEvents']} (sum {r['incSum']})  "
        f"-{r['decEvents']} (sum {r['decSum']})  0:{r['zeroEvents']}"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--uid", default=None, help="analyze a single uid")
    parser.add_argument("--top", type=int, default=10, help="max users to report")
    args = parser.parse_args()

    db = init_firestore()

    if args.uid:
        r = analyze_user(db, args.uid)
        if r:
            print_report(r)
        else:
            print(f"no memories for uid={args.uid}")
        return

    reports = []
    for user in db.collection("users").stream():
        r = analyze_user(db, user.id)
        if r:
            reports.append(r)
    reports.sort(key=lambda x: x["memCount"], reverse=True)

    # Global aggregate
    total_mem = sum(r["memCount"] for r in reports)
    total_inc = sum(r["incEvents"] for r in reports)
    total_dec = sum(r["decEvents"] for r in reports)
    glob = Counter()
    for r in reports:
        glob.update(r["buckets"])
    print("=== GLOBAL ===")
    print(f"users with memories: {len(reports)}  total memories: {total_mem}")
    print(f"weightDelta events total  +{total_inc}  -{total_dec}")
    print("weight distribution (all users):")
    for label, n in glob.most_common():
        print(f"  {label:32s} {n}")

    for r in reports[: args.top]:
        print_report(r)


if __name__ == "__main__":
    main()
