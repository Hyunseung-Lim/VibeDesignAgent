"""
VibeDesignAgent — Split each option-based mission into standalone missions.

Reads the 3 existing option missions and creates 9 standalone missions, one per
option. Each new mission:
  - title = "{parent title} · {option title}"   (과제 · 브랜드)
  - description = parent mission description (task brief shown in lobby)
  - device / durationMinutes = inherited from parent
  - options = [the single original option]       (kept so existing content
              plumbing works; the selection screen auto-skips for 1 option)

Mission ordering is per-user (randomized elsewhere), so ids do NOT encode order.
Fixed ids → re-running overwrites instead of duplicating.

Usage:
    python3 scripts/create_split_missions.py            # dry run
    python3 scripts/create_split_missions.py --write
"""

import sys
import time

import firebase_admin
from firebase_admin import credentials, firestore

KEY_FILE = "vibedesignagent-key.json"

# Parent option-missions to split, in a stable order for readable ids only.
PARENT_IDS = [
    "mission-20260502-192521",  # 스타트업 랜딩페이지 디자인 (desktop)
    "mission-20260502-202536",  # 포트폴리오 히어로 섹션 디자인 (desktop)
    "mission-20260502-202642",  # 이커머스 제품 리스팅 페이지 디자인 (mobile)
]
ID_PREFIX = "mission-20260611"  # new standalone missions


def main():
    write = "--write" in sys.argv
    firebase_admin.initialize_app(credentials.Certificate(KEY_FILE))
    db = firestore.client()

    base_created = int(time.time() * 1000)
    new_missions = []
    seq = 0
    for group, parent_id in enumerate(PARENT_IDS, start=1):
        snap = db.collection("missions").document(parent_id).get()
        if not snap.exists:
            print(f"  ! parent {parent_id} not found — skipped")
            continue
        parent = snap.to_dict() or {}
        parent_title = parent.get("title") or parent_id
        options = parent.get("options") or []
        for idx, opt in enumerate(options, start=1):
            seq += 1
            new_id = f"{ID_PREFIX}-{group}{idx:02d}001"
            mission = {
                "title": f"{parent_title} · {opt.get('title', '').strip()}".strip(" ·"),
                "description": parent.get("description", ""),
                "device": parent.get("device", "desktop"),
                "durationMinutes": parent.get("durationMinutes"),
                "options": [opt],  # single option kept; selection screen auto-skips
                "createdAt": base_created + seq,
                "splitFrom": parent_id,
            }
            new_missions.append((new_id, mission))

    print(f"{'WRITE' if write else 'DRY RUN'} — {len(new_missions)} standalone missions:\n")
    for new_id, m in new_missions:
        print(f"  {new_id}  [{m['device']}]  {m['title']}")
        if write:
            db.collection("missions").document(new_id).set(m)

    if write:
        print(f"\nCreated/overwrote {len(new_missions)} missions.")
    else:
        print(f"\nDry run. Re-run with --write to create them.")
    # Emit the new ids so the per-user order assignment can reference them.
    print("\nNEW_MISSION_IDS=" + ",".join(i for i, _ in new_missions))


if __name__ == "__main__":
    main()
