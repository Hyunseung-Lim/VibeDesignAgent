<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# dev_document.md 유지보수 규칙

`dev_document.md`는 두 영역으로 나뉜다: **1~9장(Current Snapshot)** = 현재 동작의 source of truth, **10장 이후(Decision Log)** = 시간순 결정/구현 기록(append-only). 이 문서는 통째로 읽히지 않고 일부만 발췌되어 컨텍스트에 들어가므로, 아래를 지킨다.

1. **모순은 같은 커밋에 동기화한다.** 1~9장이 서술하는 동작을 바꾸는 구현은, 1~9장을 갱신(또는 stale 마킹)하기 전까지 완료가 아니다. 10장 이후에 로그를 append하는 것만으로는 부족하다 — 그게 drift의 원인이다.
2. **stale은 발췌 청크 안에서 드러나야 한다.** 대체·변경된 1~9장 항목은 삭제하거나, 인라인 마커로 표시한다: `` `[stale YYYY-MM-DD → 15.NN: 무엇이 어떻게 바뀌었나]` ``. 발췌 한 조각만 봐도 옛 사실임을 알 수 있어야 한다.
3. **코드에서 도출 가능한 사실은 복사하지 말고 가리킨다.** 줄 수, route 전체 목록, 파일 위치, 컴포넌트 인벤토리, 버전 개수 등은 코드가 source of truth다. 1~9장에는 코드가 말해줄 수 없는 것(결정, 근거, 계약/불변식, "왜")만 담고, 나머지는 "`src/...`를 직접 확인" 식으로 포인터를 둔다.
4. **점검 트리거는 달력이 아니다.** 정합성 전수 점검(1~9장 vs 코드)은 마일스톤 종료 시, Decision Log가 ~10개 누적됐을 때, 또는 1~9장에 의존하는 새 작업 시작 직전에 수행한다.
