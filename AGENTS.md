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

# 커밋 / Git 규칙

- **커밋은 사용자가 항상 직접 한다.** 에이전트는 `git commit`을 실행하지 말고, 커밋 메시지 텍스트만 제안한다.
- **메시지 언어**: 첫 줄(제목)은 영어, 나머지 본문은 한국어로 쓴다.
- **금지 문자**: 커밋 메시지 전체에서 작은따옴표, 백틱, 큰따옴표 세 문자를 쓰지 않는다 (셸 인용 문제 방지). 코드 식별자도 따옴표 없이 평문으로 표기한다 — 예: "닫는 대괄호", "CREATE_NOTE".

# Codex를 위한 Notion MCP 사용 규칙

- 이 프로젝트는 Codex 전역 설정의 `mcp_servers.notionApi`로 로컬 Notion MCP가 등록되어 있다.
- 서버 명령은 `bash /Users/sunmyeong/Documents/VibeDesignAgent/scripts/notion_mcp.sh` 이다.
- Notion 문서나 데이터베이스를 읽을 때 기본 Notion 앱 커넥터보다 먼저 `mcp__notionApi` 도구를 확인한다.
- Notion 링크 ID가 페이지가 아닐 수 있다. page 조회가 `validation_error`로 database라고 말하면 retrieve database API를 사용한다.
