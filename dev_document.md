# VibeDesign Agent 개발 문서

## 문서 사용 기준

이 문서는 한 파일 안에서 두 가지 역할을 가진다.

- **1-9장: Current Snapshot** — 현재 구현과 운영 기준을 빠르게 확인하기 위한 source of truth. 새로운 결정이 구현되면 이 영역에 반영한다.
- **10장 이후: Decision / Implementation Log** — 시간순 의사결정, 실행 계획, 구현 흔적을 보존하기 위한 기록. 현재 기준과 충돌할 수 있으므로, 실제 동작 기준은 1-9장을 우선한다.

의사결정 로그는 삭제하지 않고 복기용으로 남긴다. 단, 이후 구현으로 대체된 내용은 `[superseded]`, 완료되어 현재 스펙에 반영된 내용은 `[implemented]`, 아직 보류 중인 내용은 `[deferred]`처럼 상태를 명시한다.

**유지보수 규칙은 `AGENTS.md`의 "dev_document.md 유지보수 규칙"에 있다.** 요약: ① 1~9장과 모순되는 구현은 같은 커밋에 1~9장을 동기화(또는 stale 마킹)한다. ② 변경된 1~9장 항목은 발췌 청크만 봐도 알 수 있게 인라인 마커 `` `[stale YYYY-MM-DD → 15.NN: 설명]` ``로 표시한다. ③ 코드에서 도출 가능한 사실(줄 수, route 목록, 파일 위치 등)은 복사하지 말고 코드를 가리킨다. ④ 정합성 전수 점검은 달력이 아니라 마일스톤/로그 누적/새 작업 시작을 트리거로 한다.

---

## 1. 서비스 개요

- **목표**: UI/UX 디자이너가 AI 에이전트와의 대화만으로 디자인 과업을 진행할 수 있게 해주는 협업 연구 도구.
- **핵심 경험**: 사용자는 과업 브리핑 및 피드백을 텍스트 대화로 전달하면 에이전트가 레퍼런스 탐색 → 아이디어 기록 → 목업 생성 → 최종 디자인 선택까지 수행.
- **연구 목적**: HCI 연구 맥락에서 AI-인간 협업 시 공유 멘탈 모델(shared mental model) 형성 과정 연구.

---

## 2. 기술 스택

| 영역            | 기술                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- |
| 프레임워크      | Next.js (App Router), TypeScript                                                      |
| 스타일링        | Tailwind CSS v4, @phosphor-icons/react                                                |
| 인증            | Firebase Authentication (Google OAuth)                                                |
| 데이터베이스    | Firebase Firestore                                                                    |
| AI 채팅         | OpenAI Responses API (기본 `gpt-5.4`) / Anthropic Claude 선택 + web_search_preview 툴 |
| 목업 생성       | Google Stitch SDK                                                                     |
| 레퍼런스 검색   | OpenAI web_search_preview (style·product 공용)                                        |
| 마크다운 렌더링 | react-markdown                                                                        |

---

## 3. 페이지 구조

### `/` — 로그인

- Firebase Google OAuth 로그인
- 인증 후 `/lobby`로 이동

### `/lobby` — 미션 로비

- Firestore `missions` 컬렉션에서 미션 목록 로드
- 미션 카드: 제목, 설명, 기간, 디바이스 타입 표시
- 미션 클릭 → `/main/[missionId]`로 이동 `[stale 2026-06-12 → 15.65: 순차 잠금 도입. 잠긴 미션은 이동하지 않고 lockReason toast만 표시(onLockedClick). 첫 미완료 1개만 해제, 완료 미션은 review만]`
- 미션 정렬은 `/api/users/me`의 `missionOrder`(유저별 랜덤, 온보딩은 항상 맨 앞) 기준 `[추가됨 2026-06-12 → 15.64]`

### `/admin` — 관리자 페이지

- 어드민 이메일 화이트리스트로 접근 제한
- 미션 탭 없음 — 유저 목록 단일 화면 `[stale 2026-07-17 → 15.291/15.292: 생성·수정 제거(15.291)에 이어 미션 탭 전체(목록/삭제/온보딩 제한시간 설정 UI/미션별 참여자 모달) 제거(15.292)]`
- 미션 콘텐츠는 Firestore `missions/{id}.options[0]`에 저장(제목/설명/마크다운 content). 옵션에는 어드민이 올린 콘텐츠 이미지 `assetImages[{url, path, note}]`도 담긴다. 이 이미지의 업로드/편집 UI는 제거되었고 저장된 데이터만 사용한다 `[stale 2026-07-17 → 15.291: /admin/new와 카드 편집 UI 삭제]`. main 세션의 Mission 섹션에서 썸네일로 바로 확인할 수 있다. Mission 섹션에서 이미지 본문을 클릭하면 채팅 입력에 이미지 인용 attachment로 추가되고, 원본 확대는 카드 하단의 `확대보기` 버튼으로 연다. `/api/mission-assets`는 Storage 이미지를 buffer로 받아 응답하고 짧은 in-memory cache/promise dedupe를 사용하며, Mission grid 이미지는 로드 실패 시 cache-bust retry 후 placeholder를 표시한다. 저장된 URL/path는 목업 생성 시 asset-led 경로로 그대로 주입된다(위 "콘텐츠 자산 주도 생성" 참고) `[현행 2026-07-03 → 15.96/15.179/15.180]`
- 미션 ID: `mission-YYYYMMDD-HHmmss` 형식 (사람이 읽기 쉬운 구조)
- 세션 열람(읽기 전용 view-as)은 유저 카드의 미션 행 링크로만 진입 `[stale 2026-07-17 → 15.292: 미션별 참여자 모달 제거]`
- `[stale 2026-07-17 → 15.292: 참여자 모달 삭제로 참여자 카드 X(개별 미션 기록 삭제) 진입점 제거. deleteUserData 로직도 함께 삭제]`
- 사용자 카드의 `세션 백업 후 삭제`는 세션/참여 기록/Storage 파일/장기 메모리(`memories_0_1_2`)/클러스터 캐시(`memoryClusters`)/세션 클러스터 snapshot(`memoryClusterSnapshots`)/retrieval logs를 백업 후 삭제한다 `[현행 2026-07-10 → 15.94/15.197]`
- 사용자 카드는 1열 전체 폭으로 배치한다. 카드의 미션 영역은 온보딩을 첫 행에 두고 `missionOrder` 순서를 기준으로 참여/세션 미션을 보완한 단일 진행 목록이다. Lobby와 같은 session snapshot 판정으로 `대기`/`준비중`/`진행중`/`시간 초과`/`완료`를 표시하고, 온보딩 미션도 Lobby처럼 실제 세션 진행을 반영하되 완료 판정만 onboarding profile flag로 한다. Lobby의 순차 잠금 규칙(온보딩→`missionOrder` 순서, 첫 미완료가 `현재`, 그 이후는 `잠김`)도 같은 판정으로 계산해 `현재`/`잠김` 배지와 흐릿 처리로 표시한다(관리/조회용이라 잠금은 표시만 하고 링크는 막지 않음). 각 행의 미션 제목 링크는 `/main/{id}?viewAs={uid}`로 해당 세션을 읽기 전용 view-as로 연다. admin viewAs 세션의 헤더 뒤로가기 버튼은 `/admin`으로 돌아가며, read-only banner 안의 별도 `어드민으로 돌아가기` 링크는 두지 않는다(별도 리뷰 링크는 제거 — admin viewAs는 이미 읽기 전용+리뷰 탭 노출이라 `review=1`은 초기 탭만 바꿔 중복이었다) `[현행 2026-07-04 → 15.122/15.123/15.124/15.125/15.127/15.181]`
- `[stale 2026-07-17 → 15.292: 참여자 모달과 개별 미션 기록 삭제 기능 제거(구 15.94/15.197 동작)]`
- 유저 카드의 `메모리 보기`는 모달을 열지 않고 `/admin/users/[uid]/memory` 전용 페이지로 이동한다. 이 페이지는 `/agent`와 같은 `MemoryClusterPage`를 렌더링해 헤더, 세션 누적 필터, 좁은 cluster list, 좌측 cluster detail panel, similarity graph, empty/loading state를 동일하게 유지한다 `[현행 2026-06-27 → 15.130]`
- Admin 대상 메모리 목록과 clustering API는 self `/agent` 경로와 같은 normalization 및 clustering helper를 사용한다. 같은 uid와 item signature에는 양쪽 화면이 같은 memory item, cache document, cluster membership/label을 읽는다 `[현행 2026-06-22 → 15.107]`

### `/main/[missionId]` — 메인 디자인 세션

- 좌측 패널 (스크롤 가능): Mission → Reference → 아이디어 탭 (Idea/Mockup)
- 우측 패널 (고정): AI 에이전트 채팅
- 완료 세션 리뷰 우측 패널은 `세션 이전`/`채팅` 탭만 제공한다. 사용자용 `리뷰 보기`/`메모리 리뷰하기` CTA는 먼저 backdrop 없는 Part 1 패널을 열어 오늘 세션 이해도, memory 도움도, 앞으로 기억할 내용을 받는다. Part 1의 1~7점 척도는 숫자 버튼과 함께 `1 전혀 아니다`/`4 보통`/`7 매우 그렇다` 지표를 표시하고, 1번/2번 Likert 문항은 왼쪽 열에 세로로 쌓으며 3번 자유응답은 오른쪽 열의 긴 입력 영역으로 배치한다. 이 패널은 왼쪽 작업/리뷰 영역과 오른쪽 채팅을 덮지 않도록 header 아래 전체폭 strip으로 표시하고, 열 때는 채팅 탭으로 전환한다. Part 1에는 닫기 X를 두지 않고 `다음`으로만 Part 2에 진입한다. `다음`을 누르면 Part 1 답변을 `users/{uid}/memoryReviewFeedback/{missionId}.answers`에 draft 저장한 뒤 cluster list → detail panel → memory graph → Part 2 review panel 순서의 full-screen memory overlay를 연다. Part 2 review panel header는 Part 1의 3번 자유응답 실제 텍스트를 따옴표로 넣어 `‘답변’와 관련해, 에이전트는 지금 이렇게 기억하고 있어요.`라고 표시하고, 본문은 바로 4번 문항부터 시작한다. Part 2 질문 원문과 순서는 `src/components/memory/memory-review-panel.tsx`의 `REVIEW_QUESTIONS`가 source of truth다. memory 상태 확인 문항은 8번(rating 문항 직전)에 위치하고 `[변경 2026-07-17 → 15.287]`, detail card에서 활성 memory를 사유 입력 후 비활성화하거나 inactive memory를 weight 0.5로 재활성화할 수 있다. 재활성화 시 historical before snapshot은 유지하고 after snapshot만 현재 active memory로 다시 생성한 뒤 새 소속 cluster를 자동 선택한다. Overlay의 `세션 이전`/`세션 이후` 토글은 같은 최신 cluster cache를 node filter로 재사용하지 않고, `users/{uid}/memoryClusterSnapshots/{missionId}_{before|after}`에 저장된 phase별 cluster snapshot을 우선 사용한다. Snapshot이 없는 과거 세션은 기존 latest cache fallback으로 표시한다. `세션 이전` 탭의 `원래 입력한 내용`은 현재 미션의 `profile_memories/{missionId}` 원문만 표시하며, 누적 before-session graph memory의 과거 raw input을 현재 미션 입력처럼 대체 표시하지 않는다. Part 2 리뷰 입력창에서 `@`를 입력하면 별도 dropdown 없이 메모리뷰 자체가 선택 모드가 되며, cluster list/detail panel/graph에서 cluster나 memory를 클릭해 답변 본문에 inline mention을 삽입한다. 삽입된 mention은 굵게 표시되고 클릭하면 해당 cluster나 memory로 focus된다. 답변은 Part 1 3개와 Part 2 7개 문항별 plain text와 structured mentions로 draft 저장된다. 모든 Part 2 질문을 입력해야 제출할 수 있고, 제출 확인 팝업에서 확정하면 `submittedAt` 저장 후 로비로 이동한다. Admin viewAs는 관측용이므로 Part 1 없이 기존 full-screen overlay를 바로 연다. 로비 완료 미션 카드, admin 유저 카드의 완료 미션 row, admin 참여자 row는 `submittedAt` 여부에 따라 `리뷰 필요` 또는 `리뷰 완료`를 표시한다 `[현행 2026-07-16 → 15.131/15.134/15.155/15.156/15.165/15.166/15.167/15.183/15.186/15.197/15.242/15.260/15.270/15.277/15.278]`
- 작업 화면에는 실제 화면 영역을 하이라이트하는 제품 투어가 있다. 온보딩 미션에서는 작업 화면 진입 시 자동으로 열리고, 일반 미션에서는 헤더의 `튜토리얼` 버튼을 눌러야 열린다. 튜토리얼은 미션 설명 공간, 채팅 공간, 레퍼런스 섹션, 시안을 여러 개 만들 수 있다는 점, 각 시안이 Design Brief/디자인 스타일/Mockup으로 구성된다는 점, 목업 편집 버튼 사용, Final Design 선택, 타이머와 세션 종료 버튼을 안내한 뒤 마지막에 튜토리얼 버튼 위치를 다시 안내한다 `[현행 2026-06-16 → 15.88]`
- 제품 투어가 `mission-brief` 단계를 표시할 때는 선택된 옵션 토글을 강제로 접어 미션 설명 본문이 먼저 보이게 한다 `[현행 2026-06-16 → 15.88]`

### `/agent` — Agent Manage

- 에이전트 메모리/상태 관리 뷰
- memory cluster graph, 좁은 cluster list, 그래프 좌측 detail panel, included memory items 표시. 공용 graph node hover label은 canvas 텍스트 라벨 대신 `MemoryClusterSidePanel` item 카드 형태의 tooltip으로 보여주며, mission label도 side panel과 같은 formatter를 사용한다. Graph 상단 count badge는 두지 않고 좌측 cluster list 제목 아래에 node/edge 수를 표시한다. `/agent`의 edge 수와 graph edge는 현재 세션 필터의 visible node 기준으로 필터링된다. Cluster list 하단에는 세션 리뷰와 같은 비활성 메모리 보조 행을 항상 표시하며, 행 선택은 read-only detail panel을 열고 eye icon은 graph node만 표시하거나 숨긴다. `/agent`와 admin의 사용자 전용 memory page에서는 활성화/비활성화 command를 제공하지 않는다 `[현행 2026-07-16 → 15.130/15.182/15.184/15.286]`

---

## 4. 핵심 기능 상세

### 4.1 미션 (Mission)

- 현재 미션 모델: 온보딩 제외 9개 단독 미션, 각 미션 옵션 1개. 유저별 랜덤 순서로 순차 진행(잠금). `[현행 2026-06-12 → 15.64/15.65]`
- 관리자가 설정한 제목/브리핑/기간/디바이스가 읽기 전용으로 표시
- 수정은 어드민 페이지에서만 가능
- 옵션이 1개뿐인 미션은 세션 로드 시 해당 옵션을 자동 선택하고 `selectedOptionId`, `missionTitle`, `missionBrief`, `selectedDevice`를 세션 문서에 저장. 다중 옵션 선택 화면은 `options.length > 1`일 때만 노출되며 현재 미션엔 해당 없음
- 일반 미션의 세션 시작 전 setup은 단일 스크롤 페이지다. 미션 요약 카드(`전체 미션 설명` → `제한 시간` → `해당 옵션 brief` → `제공 이미지/설명(assetImages[].note)`) 아래에 `사전 정보 입력` 카드를 같이 노출하고, 미션 요약 뒤의 `다음: 사전 정보 입력` pill은 그 카드로 스크롤한다. 하단 고정 버튼은 `세션 시작하기`다. 온보딩은 before-session memory를 만들지 않으므로 사전 정보 입력 카드를 숨기고 미션 요약 + 시작 버튼만 표시한다. 옵션이 여러 개인 미션은 옵션 선택 화면을 거쳐 이 페이지로 오고 `옵션 다시 선택`으로 되돌아간다 `[현행 2026-06-21 → 15.102]`
- 실제 세션 시작은 사용자가 `세션 시작하기` 버튼을 누를 때 발생하며, 이때 `timerStartedAt`을 세팅
- 세션 종료 버튼은 `timerStartedAt` 또는 복구 가능한 세션 데이터(messages/ideas/artboards/references/activityLog)가 생기기 전에는 비활성화되고, 세션 종료 완료 후에는 `status: completed` 기준으로 비활성화

### 4.2 레퍼런스 (Reference)

- 채팅에서 "레퍼런스 찾아줘" → `[FETCH_REFERENCES: {query}]` 블록 → OpenAI `web_search_preview`로 웹 검색 `[현행 2026-06-30 → 15.172]`
- 레퍼런스 검색 턴에 사용자가 스타일 이미지를 첨부하면 클라이언트가 `/api/references`에 이미지 data URL을 함께 보내고, 서버가 vision 분석으로 검색용 스타일 단서를 만든 뒤 검색 context와 query builder 입력에 합친다. 생성된 단서는 해당 assistant chat bubble의 `이미지 스타일 검색 기준` 섹션에도 표시한다. 분석 실패 또는 이미지 형식/크기 제한 초과 시 기존 텍스트 기반 검색으로 폴백한다 `[현행 2026-07-04 → 15.185]`
- 검색당 3개씩 누적 표시 (삭제 가능, confirm 팝업)
- 검색 중에는 해당 assistant chat bubble 안에 작은 로딩 pill을 표시한다
- 중복 제외/빈 결과/검색 실패 메시지는 Reference 섹션이 아니라 해당 assistant chat bubble의 "레퍼런스 검색 결과"로 표시한다
- 레퍼런스 선택(인용) 후 메시지 전송 시 이미지를 base64로 서버에서 변환해 chat provider에 전달
- 인용된 레퍼런스 URL도 시스템 컨텍스트로 전달. OpenAI provider에서는 웹 검색으로 방문 가능
- **검색 모드 분기**: `inferReferenceMode(query)`로 "style" vs "product" 모드를 분류한 뒤, 두 모드 모두 `searchWebReferences(mode, ...)` 단일 OpenAI `web_search_preview` 경로로 검색한다. 모드는 시스템 프롬프트(style: `referenceStyleSearchPrompt`, product: `referenceProductSearchPrompt`)와 저품질 필터만 다르게 고른다 `[현행 2026-06-30 → 15.172]`
  - 썸네일은 `hydrateReferenceMetadata()`가 검색 모드별 전략으로 확보한다. product 모드는 실제 페이지 구조를 보여주도록 Microlink desktop screenshot URL을 우선하고 검증된 페이지 이미지로 폴백한다. style 모드는 검색 결과 `imageUrl`, 페이지 메타(og/twitter/link/json-ld), HTML 이미지 후보를 서버에서 검증해 우선하고 screenshot으로 폴백한다(전용 이미지 검색 없음). 모든 카드의 `searchProvider`는 `openai-web` `[현행 2026-07-16 → 15.272]`
  - style 필터는 갤러리/포트폴리오를 허용하고 stock·소셜·검색/태그 인덱스만 제외, product 필터는 추가로 소셜 포스트와 collection/board 인덱스도 제외
- 레퍼런스 카드에는 provider/source 정보만 표시하고, 내부 `style/product` 검색 모드는 중복 배지로 노출하지 않는다
- `withConcurrency(tasks, limit)` 함수로 병렬 fetch 수를 제한해 외부 API 과부하 방지
- `sanitizeInput()` 로 LLM 입력 검증 및 prompt injection 방지

### 4.3 아이디어 (Idea)

- 사용자가 직접 마크다운으로 작성하거나 AI가 `[CREATE_NOTE: ...]` / `[UPDATE_NOTE: ...]` 태그로 생성·수정
- 아이디어 탭별 독립적인 Mockup 보유
- 탭 추가/편집/삭제 가능
- 편집 모드: 제목 input + 마크다운 textarea
- 뷰 모드: ReactMarkdown으로 렌더링

### 4.4 목업 (Mockup)

- **생성 조건**: 아이디어가 1개 이상 저장된 경우에만 생성 가능
- **생성 흐름**: 채팅 모델이 `[GENERATE_MOCKUP: {prompt}]` 출력 → Google Stitch API 호출 → HTML 반환 → 캔버스에 표시
- **채팅 컨텍스트**: 미션 제목/브리핑, 현재 아이디어 내용, 기존 목업 HTML, 선택된 UI 요소, 인용 레퍼런스, 대화 히스토리. 텍스트 인용은 client가 state/ref를 동기화해 선택 직후 전송한 turn에도 포함시키고, `/api/chat`이 raw excerpt를 truncate해 넘기며 `chatCitedTextsPrompt`가 `[인용 N]` 라벨을 한 번만 붙인다. 사용자가 명시적으로 붙인 `citedTexts`는 planner pruning보다 우선해 presence 기반으로 raw prompt에 포함한다. `/레퍼런스검색` memory는 15.199 결정대로 별도 before-session 우회 없이 기존 reference relevance filter를 탄다 `[현행 2026-07-11 → 15.199/15.203/15.205]`
- **missionBrief 보완 주입**: 신규 목업 생성 시 아이디어 내용이 300자 미만으로 빈약하면 `missionBrief`를 `buildMockupPrompt`에 직접 주입해 제품 데이터가 Stitch에 전달되도록 보장 (수정 시에는 주입 안 함)
- **이미지 주도 생성**: 사용자가 참고 이미지를 첨부/붙여넣거나(Phase 1) 신규 목업 요청에 URL을 주면(Phase 2 — 채팅 메시지 내 URL 또는 인용 레퍼런스의 URL), 텍스트 design.md 단계 없이 그 화면을 Stitch에 `upload`→`edit`로 재구성해 목업을 만들고 결과에서 design.md를 역추출·저장한다. URL은 서버가 스크린샷(Microlink 무키, `captureScreenshot` 추상화)으로 캡처하며 첨부 이미지가 우선. 모바일 목업이면 URL 캡처도 390×844 모바일 viewport, 데스크톱이면 1280×900 viewport로 찍는다. 이미지/URL이 있으면 "디자인 스타일 필수" 게이트를 우회한다. 직접 첨부 이미지는 user chat bubble에 표시되고, URL 캡처 이미지는 assistant bubble에 작은 preview로 표시된다. 두 이미지는 공용 `ImagePreviewDialog`로 크게 볼 수 있다. `/api/chat`에는 이미지 data URL을 보내지 않고 `styleImageContext`(첨부 여부와 파일명)만 보내 planner/action prompt가 "레퍼런스 없음"으로 되묻지 않게 한다. 서버는 이 메타 수신 여부를 `[api/chat] attached style image context`로 남기고, Stitch 업로드 직후 reference screen id, sha256 hash, byte length, mime을 로그와 `/api/stitch` 응답의 `styleReferenceInput`에 남긴다. `src/app/api/stitch/route.ts`의 `isImageLed` 분기 참고 `[현행 2026-07-16 → 15.275/15.276]`
- **콘텐츠 자산 주도 생성(asset-led)**: 미션 옵션에 어드민이 등록한 콘텐츠 이미지(`assetImages`, 실제 상품 사진·UI 캡쳐)가 있으면 신규 목업 생성 시 그 Storage `path`/URL과 설명(`note`)을 `/api/stitch`로 넘긴다. 서버는 Stitch `upload`→`edit_screens`를 신규 목업 생성의 기본 경로로 쓰지 않고, asset URL과 note manifest를 `generate_screen_from_text` prompt에 직접 넣어 first DESIGN screen을 만든다. 이는 Stitch SDK의 `upload(filePath)`가 이미지를 UI 생성 입력으로 전달하는 API가 아니라 이미지 파일 자체를 `IMAGE` screen canvas로 만드는 API이고, 그 IMAGE screen을 첫 design 없이 `edit_screens` 대상으로 넘기면 `invalid argument`가 반복되기 때문이다. URL text generation이 인증 실패하면 API key 클라이언트로 새 Stitch project를 만들어 한 번 더 재시도한다. URL text generation 자체가 `invalid argument`로 거부되거나 API key 텍스트 생성까지 인증/invalid-argument 실패하면 OpenAI standalone HTML fallback으로 내려간다. 이때 모델에는 긴 asset URL 대신 `{{ASSET_N}}` placeholder를 `img src`에 쓰게 하고, 서버가 응답 HTML에서 placeholder를 실제 asset URL로 치환한 뒤 coverage를 검사한다. 치환은 모델이 token을 URL-encode(`%7B%7BASSET_N%7D%7D`)하거나 공백을 넣은 변형도 허용한다. Stitch URL text generation이 성공해도 반환 HTML에 모든 mission asset의 URL/path가 포함되지 않으면, 생성된 DESIGN screen을 `edit_screens` 대상으로 한 번 더 보정한다. 보정 edit이 design screen 없이 `sessionEvent.dom_operations`만 반환하면 그 patch를 현재 HTML에 적용해 보정 결과로 쓴다(위 편집 모드의 harvest 계약과 동일). 보정 HTML도 coverage를 통과하지 못하거나 edit이 실패할 때만 OpenAI HTML fallback으로 내려간다. 모든 coverage 실패 지점은 생성 HTML의 실제 img src 목록, 기대 needle, 잔여 placeholder token을 진단 로그로 남긴다. OpenAI HTML fallback도 동일한 asset coverage 검사를 통과해야 하며, 모델이 일부 asset token을 누락하면 누락 token 목록을 피드백으로 넣어 한 번 재시도한 뒤에만 실패로 처리한다(15.262). asset URL이 공개적으로 도달 불가능하면(상대경로, localhost, 사설망 호스트 — dev 환경 기본) coverage가 구조적으로 통과 불가능하므로 Stitch 생성을 아예 건너뛰고(프로젝트 생성/디자인 시스템 적용 포함) 바로 OpenAI direct HTML fallback을 반환한다. first DESIGN screen의 coverage가 0/N이면 repair edit도 생략하고 바로 fallback으로 간다 — 0 coverage에서 repair는 관측상 항상 0/N으로 돌아와 가장 느린 호출만 낭비하기 때문이다(15.262). 이 direct HTML 결과는 공식 Stitch screen이 아니므로 `projectId` 연결 없이 저장하고, `screenId`는 로그/클라이언트 식별용 `openai-asset-fallback-*` synthetic id를 쓴다. 클라이언트는 synthetic id를 이후 Stitch edit 대상으로 보내지 않는다. 이미지 주도 생성과 달리 이미지를 스타일로 재구성하지 않고 콘텐츠 자산으로 보존하며, 레이아웃·스타일은 brief와 디자인 시스템을 따른다. 그래서 디자인 스타일을 미리 적용하고 결과 기반 design.md 역추출은 하지 않는다. 사용자가 그 턴에 스타일 이미지/URL을 첨부하면 그쪽(isImageLed)이 우선. `src/app/api/stitch/route.ts`의 `isAssetLed` 분기 참고 `[현행 2026-07-14 → 15.89/15.93/15.216/15.217/15.218/15.219/15.220/15.248/15.262]`
- **Stitch 인증 계약**: 배포 앱에서 사용자의 Google 로그인 계정은 Stitch credential로 쓰지 않는다. 인증된 앱 사용자를 `users/{uid}.stitchApiGroup` A/B에 고정 배정하고, `/api/stitch`와 `/api/stitch/html`이 각각 서버 전용 `STITCH_API_KEY_A` 또는 `STITCH_API_KEY_B`를 사용한다. 저장된 배정이 없으면 UID 해시로 안정적인 50:50 기본 그룹을 계산해 최초 Stitch 요청 때 프로필에 저장한다. 생성, 편집, asset-led API-key 재시도, HTML 재조회는 모두 해당 사용자 그룹을 유지하며 관리자의 viewAs 요청만 대상 사용자 UID를 지정할 수 있다. 두 route는 Firebase ID token을 필수로 검증하고 키 원문은 응답이나 로그에 남기지 않는다. 관리자는 사용자 카드와 미션 참여자 목록의 Stitch A/B badge로 배정을 확인한다. `STITCH_API_KEY`와 OAuth 설정은 명시적 그룹 키를 넘기지 않는 진단/레거시 호출용으로만 남아 있다. Stitch quota/project id는 Firebase와 분리해 `STITCH_GOOGLE_CLOUD_PROJECT`를 사용한다. 서비스 계정 OAuth는 MCP 연결/프로젝트 조회에는 성공해도 edit 계열 내부 호출에서 인증 누락으로 실패하는 것이 확인되어 Stitch edit 계열 인증 후보로 쓰지 않는다 `[현행 2026-07-16 → 15.247/15.251/15.285]`
- **액션/화면 완료 보장**: `CREATE_DESIGN_SPEC`/`EDIT_DESIGN_SPEC`는 JSON 뒤 닫는 대괄호가 빠지거나 일반 마크다운 payload로 와도 균형 스캔과 loose parser로 복구하며, 복구 불가능하면 영구적인 작성 중 상태 대신 명시적 실패로 표시한다. `GENERATE_MOCKUP`/`EDIT_MOCKUP`/`FETCH_REFERENCES`도 payload 안의 XPath나 CSS arbitrary class처럼 `]`가 들어갈 수 있으므로 bracket-balanced scanner로 표시와 실행 payload를 추출한다. 한국어 별칭(`[목업 수정: ...]`, `[수정 요청: ...]`, `[레퍼런스 검색: ...]` 등)을 canonical tag로 정규화할 때도 같은 균형 스캔을 사용해 별칭 payload가 첫 `]`에서 잘리지 않는다. 단, assistant가 `원하시면...` 같은 조건부 제안 문맥에서 design spec action을 예시/미리보기처럼 출력한 경우에는 실행 명령으로 저장하지 않고 화면에서도 제거한다. Action chip 치환 후 단독 또는 본문 앞에 붙은 `}`/`]` delimiter 잔여 텍스트는 사용자 메시지 본문에 노출하지 않는다. Stitch가 screen metadata만 먼저 반환하면 HTML을 재조회한 뒤 아트보드를 확정하고, 저장된 screen의 HTML 복원 중에는 빈 iframe 대신 로딩/실패 상태를 표시한다. `src/lib/session/chat-content.ts`와 `src/app/main/[missionId]/page.tsx`를 직접 확인 `[현행 2026-07-14 → 15.97/15.192/15.213/15.243/15.246/15.254]`
- **Stitch 일시 실패 복구**: `edit_screens`, Stitch 이미지 업로드(`screens:batchCreate`), style source URL 캡처가 `service unavailable`, timeout, 429/5xx 등 일시 오류를 반환하면 `/api/stitch`가 짧은 backoff로 재시도한다. 업로드 기반 이미지 주도 생성은 SDK의 `screen.edit()` 대신 동일한 `editScreen` 복구 경로를 타며, 업로드된 reference screen을 최종 결과 후보로 오인하지 않도록 업로드 screen id를 recovery 기준에 포함한다. asset-led는 더 이상 Storage 다운로드나 Stitch 이미지 업로드를 기본 경로로 쓰지 않는다 `[현행 2026-07-13 → 15.216/15.217]`
- **캔버스**: 드래그 패닝, 휠 줌, Fit 버튼, 확대(fullscreen) 모드. 선택 스크립트는 iframe HTML에 항상 주입하고, 편집 모드 토글은 pointer event와 선택 해제 메시지로 제어해 iframe `srcDoc` reload를 피한다. 동적 문서 높이를 측정할 때 원본 `html/body` height를 덮어쓰지 않고, viewport 단위와 `h-screen` 계열만 artboard device 크기에 고정해 원본/Final Design과 같은 첫 화면 레이아웃을 보존한다. 또한 iframe이 아직 device 높이일 때(= 첫 높이 보고 전에) vh를 쓰는 요소(예: 컨테이너 h-[80vh])와 모든 이미지의 box를 인라인 px(!important)로 고정한다. vh 치환 regex는 `srcdoc` 템플릿 리터럴 안에서도 `\d`가 보존되도록 이중 이스케이프하고, box pinning은 `height`와 `min-height`를 함께 고정한다. 인라인 선언이 클래스 규칙을 specificity로 이기므로 Tailwind Play CDN의 스타일시트 재생성과 무관하게 유지되고, iframe이 전체 문서 높이로 커져도 full-bleed 이미지가 늘어나거나 vh/min-vh 컨테이너가 부풀어 높이가 발산하는 피드백 루프가 생기지 않는다(box와 iframe 높이를 분리). Artboard HTML은 세션 snapshot에 보존해 새로고침/viewAs가 Stitch HTML 재조회에만 의존하지 않게 하며, `/api/stitch/html`은 일시적 getHtml/HTML URL fetch 실패를 500이 아니라 `htmlPending`으로 반환해 polling을 이어간다. 단, `get_screen` permission denied는 기다려도 풀리지 않는 credential/project ownership 문제이므로 403으로 즉시 반환한다. `src/lib/session/mockup-html.ts`의 `injectHeightReporter` 참고 `[현행 2026-07-13 → 15.78/15.113/15.121/15.232/15.233]`
- **편집 모드**: 특정 UI 요소 클릭 선택 → `[EDIT_MOCKUP: {prompt}]`로 수정. shift/cmd 클릭으로 같은 artboard 안에서 여러 요소를 토글 다중 선택할 수 있다(다른 artboard를 shift 클릭하면 선택이 그 artboard로 교체된다). 다중 선택 시 chat 컨텍스트/Stitch edit prompt/local edit 요청 모두 선택 요소 배열 전체를 target block으로 받는다 — Stitch `edit_screens`에는 element 파라미터가 없으므로 이는 전부 prompt 주입이다. deterministic patch는 모든 선택 요소가 패치 가능할 때만 로컬 적용(all-or-nothing)하고, `/api/mockup/local-edit`는 `elements` 배열 입력 시 요소별 병렬 LLM 호출로 `replacements` 배열을 반환하며 최소 1개 요소가 실제로 바뀌어야 성공으로 본다. 메시지의 인용은 `citedElement`(첫 요소, 하위 호환) + `citedElements`(전체)로 저장한다 `[15.261]`. 선택 요소가 있는 상태에서 "크게/색/문구/삭제/꽉 차게" 등 짧은 타깃 편집 요청이 오면 planner 판단과 무관하게 현재 목업 HTML과 선택 요소 컨텍스트를 함께 주입한다. assistant가 실수로 `[GENERATE_MOCKUP]`을 내도 사용자가 새 시안/새 화면을 명시하지 않았고 선택된 artboard가 있으면 클라이언트가 edit으로 강제해 기존 screenId를 보낸다. 선택 대상이 `img`이거나 이미지를 포함하면 이미지 교체 요청이 없는 한 기존 `img src`를 보존하고 object-fit/크기/overflow 같은 레이아웃 CSS만 바꾸도록 Stitch prompt에 명시한다. 선택 요소 편집은 모델이 재작성한 영어 action뿐 아니라 사용자 원문 요청, selector, XPath, 선택 HTML을 Stitch prompt에 함께 넣는다. 원문이 삭제/제거/없애기 계열이면 선택된 HTML element 자체를 제거하라는 지시를 추가해 의미 추론으로 decorative child만 제거하는 식의 약화를 막는다. edit 호출에는 active design brief 본문을 다시 붙이지 않아 기존 brief가 국소 수정 지시를 희석하지 않게 한다. Stitch screen edit은 각 artboard에 저장된 `stitchProjectId`를 우선 사용하고, 없을 때만 session-level projectId로 fallback한다. 따라서 여러 Stitch project에서 만들어진 artboard가 한 세션에 섞여도 screenId와 projectId가 어긋나 `Requested entity was not found`가 나는 경로를 줄인다. 신규 생성은 기존 session-level projectId 재사용 중 `generate_screen_from_text`가 not found를 반환하면 stale project로 보고 새 Stitch project를 만든 뒤 design system을 다시 적용해 한 번 재시도한다. `STITCH_EDIT_PROMPT_MODE=compact` 실험 플래그를 켜면 raw HTML 위주의 prompt 대신 원문 요청, selector, XPath, visible text 중심의 짧은 prompt와 `GEMINI_3_1_PRO` modelId로 `edit_screens`를 호출한다. `STITCH_EDIT_TARGET_MODE=screen-instance` 실험 플래그를 켜면 edit 전에 `get_project`의 `screenInstances`에서 현재 screen을 가리키는 instance를 찾아 `selectedScreenInstances`도 함께 보내고, 서버가 `invalid argument`로 거부하면 기존 `selectedScreenIds` 호출로 fallback한다. 선택 요소 삭제/제거, 흰색/검정 텍스트 색, sans/serif 폰트, 이미지 cover/contain처럼 의미가 deterministic한 요청은 Stitch 호출 전에 클라이언트가 현재 artboard HTML을 직접 패치하고 `local-edit-fallback-*` synthetic screen id로 전환한다. deterministic 패치가 못 잡는 나머지 선택 요소 편집은 `/api/mockup/local-edit`가 기본 경로다: 선택 요소의 outerHTML과 사용자 원문/영어 edit 지시문을 OpenAI에 보내 교체 outerHTML만 받고, 클라이언트가 XPath/selector 매칭으로 해당 node만 치환한 뒤 같은 synthetic id 계약을 따른다. 이 경로는 artboard가 synthetic이든 실제 Stitch screen이든 동일하게 동작하며 Stitch edit persistence에 의존하지 않는다. local edit이 실패하면 실제 Stitch screen은 기존 Stitch edit 경로로 내려가고, synthetic artboard는 신규 생성으로 둔갑하지 않도록 `/api/stitch`를 호출하지 않고 실패로 표시한다. 선택 요소 없이 synthetic artboard 전체를 수정하는 요청은 같은 route의 document 모드(`html` 입력, 전체 문서 반환)로 처리하며, 성공/실패와 무관하게 `/api/stitch`로 내려가지 않는다. 따라서 synthetic artboard 편집은 어떤 형태든 Stitch 신규 생성으로 둔갑하지 않고, Stitch progress 표시는 실제 Stitch 호출 중에만 동작한다. 모든 목업 편집(로컬 4경로 + Stitch edit 적용)은 activityLog `mockup/update` 이벤트에 편집 직전 HTML을 `previousHtml`로 남긴다 — 편집 후 버전은 다음 편집 이벤트의 previousHtml 또는 artboard 현재 html로 복원한다(분석용, undo UI 없음). 세션 문서 1MiB 한도 보호를 위해 저장 시 `trimActivityLogHtmlForSave`가 히스토리 총량이 budget을 넘으면 오래된 이벤트부터 previousHtml을 제거하고 `previousHtmlTrimmed`로 표시한다. CSV export에는 previous_html 컬럼으로 나간다. Stitch edit raw response가 design screen을 반환하지 않으면, 서버는 `sessionEvent.eventPayload.dom_operations`(replace_element 등 DOM patch 목록)를 현재 screen HTML에 cheerio로 직접 적용해 그 결과를 edit 결과 HTML로 반환한다 — 현행 Stitch edit 백엔드는 편집을 screen 리소스에 persist하지 않고 이 patch 스트림으로만 전달하기 때문이다. ops 적용에 성공하면 stale 재조회(`waitForChangedScreenHtml`)를 건너뛴다. 그 외(ops도 없고) Stitch edit 후 재조회 HTML hash가 기존 artboard HTML hash와 끝까지 같으면 성공으로 저장하지 않고 `stitch-edit-unchanged` 실패로 처리하며, no-op 추적을 위해 서버 로그에 edit prompt mode/modelId/sample, edit target mode/instance lookup, `edit_screens` raw response summary(있으면 `sessionEvent` payload 일부 포함), 2분/5분 지연 재조회 hash 비교를 남긴다. `STITCH_LOG_TOOL_SCHEMAS=1`이면 edit 요청 때 live `edit_screens`/`list_screens`/`generate_screen_from_text` tool schema도 한 번 덤프해 SDK와 서버 schema drift를 확인한다. `list_screens` 실패는 projectId와 raw error summary를 함께 기록해 recovery 실패 원인을 추적한다. Stitch가 text-only no-op 또는 screen not found를 반환한 deterministic edit도 같은 local patch 경로로 처리하고, synthetic id는 이후 Stitch 원본 screen을 다시 edit 대상으로 보내지 않는다 `[현행 2026-07-14 → 15.77/15.223/15.224/15.225/15.226/15.227/15.244/15.245/15.248/15.249/15.250/15.252/15.253/15.255/15.257]`
- Stitch edit가 기존 screen을 mutate하지 않고 새 screen을 만들면 기존 artboard를 덮어쓰지 않고 새 artboard로 추가한 뒤 active로 전환한다 `[현행 2026-06-15 → 15.79]`
- 선택 요소를 인용해 chat에 전송하면 해당 turn의 `citedElement`에는 포함하되, 입력 UI와 iframe outline에서는 즉시 선택 해제한다 `[현행 2026-06-15 → 15.80]`
- 현재 시안에 디자인 스타일이 이미 있을 때 사용자가 다른 스타일/무드/레퍼런스 방향으로 다시 만들라고 요청하면 기존 디자인 스타일을 덮어쓰지 않고 새 시안으로 fork한다. 새 시안은 기존 brief에서 제품/UX 요구사항만 유지하고 기존 시각 스타일·레이아웃·무드 제약은 제거하며, 인용 레퍼런스/URL/첨부 이미지를 새 디자인 스타일 근거로 기록한다. Stitch 이미지 주도 생성에서는 제품 brief와 스크린샷이 충돌할 때 스크린샷의 레이아웃·밀도·배경·타입·무드가 우선한다 `[현행 2026-06-15 → 15.82/15.85]`
- 아이디어 탭 전환 시 해당 아이디어의 목업만 표시
- HTML Export 지원
- Stitch 프로젝트 ID는 session-level fallback과 artboard-level source projectId를 함께 Firestore에 저장해, 여러 project에서 만들어진 목업을 같은 세션에서 수정해도 해당 screen이 속한 project로 edit/HTML 재조회한다.

### 4.5 최종 디자인 (Final Design)

- 세션 종료 전 생성된 목업 중 하나를 최종 디자인으로 선택
- 최종 디자인은 mission session의 `finalArtboardId`로 저장
- 선택을 바꾸는 중간 클릭은 memory draft를 만들지 않는다. 세션 종료 직전에 현재 `finalArtboardId` 하나만 final-design memory로 기록하며, 종료 API도 과거 방식으로 누적된 선택 draft 중 현재 최종안 하나만 승격한다 `[현행 2026-06-23 → 15.112]`
- final-design memory의 input은 라벨만이 아니라, 세션 종료 시 비교 대상 목업 전체와 세션 채팅을 서버 enrichment LLM 패스에 보내 만든다. 패스는 각 board HTML을 직접 조사해 문구/구조/UI 스타일을 정리하고(디자인 스타일 메타데이터는 무시), 후보 비교와 채팅에서 드러난 선호를 사실 위주로 기록한다. semantic 생성 프롬프트는 그대로 두고 input만 보강하는 방식이다. 구현은 `src/lib/server/finalDesignMemoryInput.ts`와 `src/app/api/memory/drafts/route.ts`를 직접 확인한다 `[현행 2026-06-25 → 15.128]`
- 최종 디자인 미선택 상태로 세션 종료 시 확인 경고를 표시
- 세션 종료 처리 중에는 메모리 저장, 클러스터 분석, 리뷰 준비 단계를 진행 모달로 표시한다. 진행 중 상태 문구는 shimmer text로 강조하고, 완료 상태 문구는 정적 텍스트로 유지한다 `[현행 2026-06-30 → 15.161]`

### 4.6 AI 채팅

- **구조화 composer 문법**: `/`는 산출물 명령(`/새시안추가`, `/디자인브리프작성`, `/디자인스타일작성`, `/목업생성`, `/레퍼런스검색`), `@`는 현재 세션에 이미 존재하는 시안/Design Brief/Design Style/Mockup 언급이다. `/새시안추가`는 빈 새 시안을 로컬로 추가하는 내부 `create_blank_idea` command이고, `/디자인브리프작성`은 현재 활성 시안의 Design Brief를 작성하는 내부 `create_idea` command이며, `/디자인스타일작성`은 현재 활성 시안의 Design Style을 작성하는 내부 `create_design_style` command다. 디자인 스타일만 먼저 작성된 빈 시안에서는 `/디자인브리프작성`이 새 시안을 만들지 않고 해당 시안의 Brief를 채운다. 대상이 없으면 현재 활성 시안을 사용하고, `@디자인스타일` 같은 검색은 dropdown에서 `시안 N · 디자인 스타일` 실제 대상을 확인한 뒤 ID 기반 metadata로 고정한다. 자동완성 선택값은 별도 상단 chip이 아니라 Lexical composer 안에 `/디자인브리프작성`, `@시안 1 · 디자인 브리프` 같은 inline token으로 삽입되고, token 구간은 Lexical TextNode style로 bold/color highlight된다. 레퍼런스 카드·미션 이미지·텍스트 하이라이트·목업 요소는 기존 전용 선택/인용 UI를 유지하며 `@`에 중복 노출하지 않는다. 선택 요소, 텍스트 인용, 레퍼런스 인용, 미션 이미지 인용, 스타일 이미지는 composer 위 attachment tray에 동일한 Attachment-style item으로 표시한다. 명령/언급은 raw token 파싱이 아니라 구조화 metadata로 `/api/chat`에 전달되고 명시적 `/` 명령이 planner 추론보다 우선한다. memory draft input에는 command/mention 메타 라인을 붙이지 않고 사용자가 본 실제 입력문만 저장한다. `src/lib/session/chat-composer.ts`, `src/components/session/chat-input.tsx`, `src/app/api/chat/route.ts`를 직접 확인 `[현행 2026-07-13 → 15.108/15.157/15.164/15.177/15.179/15.215]`
- **응답 생성 provider**: 기본 OpenAI `gpt-5.4` (Responses API). `CHAT_RESPONSE_PROVIDER=anthropic` 또는 `LLM_PROVIDER=anthropic`이면 최종 chat 응답 생성만 Claude Messages API로 전환
- **Provider 범위**: planner, embedding, memory retrieval/encoding, clustering label은 기존 OpenAI 경로 유지. `/api/chat`의 최종 assistant response streaming만 provider switch 대상. Admin UI에서는 메인 채팅 헤더의 LLM selector로 turn별 provider override 가능
- **웹 검색**: OpenAI provider일 때 `web_search_preview` 툴 활성화, 레퍼런스 URL 인용 시 `tool_choice: "required"`로 강제. Anthropic provider일 때는 prompt에 포함된 reference title/url context를 사용하고 web search tool은 호출하지 않음
- **스트리밍**: SSE 방식으로 실시간 토큰 출력
- **웹 검색 표시**: 검색 발생 시 `[WEB_SEARCHED]` 마커 → "웹 검색 완료" 배지 표시
- **인용 링크**: 웹 검색 출처 `(domain.com)` 자동으로 클릭 가능한 마크다운 링크로 변환
- **채팅 bubble UI**: user message는 어두운 filled bubble, assistant message는 기본적으로 ghost bubble(배경/테두리 없이 본문 중심)로 표시한다. user bubble에 hover/focus하면 버블 아래에 보낸 시간이 `Jul 21, 09:32 AM` 형식으로 나타난다. 선택된 assistant turn과 error turn만 별도 surface를 갖고, 진행 상태와 tool action marker는 bubble 안의 Marker-style row로 낮은 위계에서 표시한다. `[WEB_SEARCHED]` 같은 marker row는 클릭하면 원문 marker 세부 내용을 펼친다 `[현행 2026-07-16 → 15.273]`
- **특수 블록 처리**:
  - `[CREATE_NOTE: ...]` → 새 아이디어(시안) 생성. 저장 payload는 목표/대상 사용자, 핵심 경험, 화면 구조, 미션 필수 콘텐츠, 제약을 포함한 독립적인 Design Brief여야 한다. 모델이 한 줄 작업 지시문을 반환하면 클라이언트가 먼저 assistant 응답 본문에서 실질 브리프를 복구하고, 없을 때 미션 맥락과 현재 사용자 요청으로 시작 가능한 브리프를 복구한다. 단, 현재 시안이 빈 shell이면(디자인 스타일만 먼저 작성된 경우, 또는 세션 시작 시 시드된 빈 디폴트 시안 1: description·designStyle·artboard 모두 없음) 새 시안을 만들지 않고 해당 시안 내용을 채움 `[현행 2026-06-30 → 15.98/15.116/15.153]`
  - 세션은 빈 디폴트 시안 1로 시작한다(read-only/완료 세션 제외). 워크스페이스·탭·Brief/Style/Mockup 구조를 처음부터 노출하고, 첫 brief가 위 shell-fill 규칙으로 이 시안을 채운다 `[현행 2026-06-23 → 15.116]`
  - `[UPDATE_NOTE: ...]` → 현재 아이디어 내용 업데이트. 의도적인 짧은 수정은 허용하되, 디자인 브리프 생성/작성 성격의 턴에서 payload가 한 줄 상태문으로 축약되면 assistant 응답 본문 또는 미션 맥락으로 실질 Design Brief를 복구한 뒤 저장한다 `[현행 2026-06-30 → 15.153]`
  - `[CREATE_DESIGN_SPEC: ...]` → 현재 아이디어의 디자인 스타일 최초 정의/교체. Design Brief가 아직 없어도 세션 초반부터 생성할 수 있으며, 현재 아이디어가 없으면 빈 시안을 자동 생성하고 그 시안에 스타일을 저장한다. 이후 첫 Design Brief는 shell-fill 규칙으로 같은 시안을 채운다. 조건부 제안이나 예시 문장 안의 `CREATE_DESIGN_SPEC`는 실행하지 않으며, 과거 대화 컨텍스트로 재투입할 때는 평문형 payload까지 `[디자인 스타일 추가]`로 축약한다 `[현행 2026-07-13 → 15.154/15.192/15.213]`
  - `[EDIT_DESIGN_SPEC: ...]` → 현재 아이디어의 기존 디자인 스타일 일부 수정. 실행 payload는 diff가 아니라 저장될 전체 최신 디자인 스타일이어야 하며, 같은 `designStyle` 슬롯을 갱신하되 UI chip과 memory action은 `design_spec_edit`로 분리한다. 새 스타일 variant나 다른 visual direction은 기존 스타일을 덮어쓰지 않도록 새 시안 방향의 `CREATE_DESIGN_SPEC` 경로를 사용한다 `[현행 2026-07-13 → 15.213]`
  - `[GENERATE_MOCKUP: ...]` → Stitch 목업 생성
  - `[EDIT_MOCKUP: ...]` → 목업 수정
  - `[FETCH_REFERENCES: ...]` → OpenAI web_search_preview 검색
  - `[WEB_SEARCHED]` → 웹 검색 배지

### 4.7 메모리 (Memory)

- **생성 단위**: 세션 중 interaction turn마다 `/api/memory/drafts`에서 keyword, factual episode, semantic을 생성한다. semantic은 사용자 성향/선호/작업 방식에 대한 근거 기반 한 문장 insight이며, `interpretationConfidence`는 생성·저장하지 않는다. `semantic`이 canonical 필드이고 `semanticJson`은 배열 호환용으로 함께 저장한다. before-session profile에서 사용자가 직접 제공한 durable 정보와 기존 memory의 semantic도 계속 읽는다 `[현행 2026-06-28 → 15.135]`
- **Preference signal**: assistant bubble의 좋아요/싫어요는 UI에서 `선호 표시`로 표현한다. optional reason dialog를 열고, 제출 시 기존 `/api/memory/drafts` 경로로 `feedback-{messageId}` draft를 만든다. Toast는 우측 채팅 패널/입력창과 겹치지 않도록 viewport 좌측 하단에 배치한다. input은 vote, reason, 표시 대상 답변의 원래 질문(최대 1000자), output은 표시 대상 assistant answer(최대 6000자)이며 재투표는 같은 draft id를 덮어쓴다. Feedback turn은 `MEMORY_ENCODE_PROMPT`에 전용 addendum을 붙여 답변 요약이 아니라 평가 신호 기반 episode/semantic을 생성한다. `agentActionCategory`는 표시 대상 assistant 답변의 원래 작업 category(`design_spec_create`, `mockup_edit` 등)를 유지하고, 좋아요/싫어요 marker는 `preferenceSignal` metadata로 분리 저장한다. 기존 저장값 `assistant_feedback`/`preference_signal` action은 표시/리뷰 단계에서 legacy preference alias로만 읽는다. 또한 해당 assistant 답변의 `reviewTurns/{messageId}.retrieved` 또는 retrieval log에서 실제 prompt/retrieval에 쓰인 memory id를 찾아 feedback delta를 적용한다. retrieved memory는 답변 생성 전 검색 단계에서 이미 retrieval reward를 받으므로 feedback delta 자체는 좋아요 `+0.04`, 싫어요 `-0.08`을 적용해 검색 reward 포함 최종 효과가 대략 좋아요 `+0.08`, 싫어요 `-0.04`가 되게 한다. 같은 feedback draft를 재저장할 때는 이전 적용분과 새 적용분의 차이만 반영해 중복 누적을 막고, 결과 metadata는 draft의 `assistantFeedbackWeightAdjustment`에 남긴다 `[현행 2026-07-13 → 15.207/15.210/15.228/15.229/15.231]`
- **Source normalization**: 채팅 turn의 인용 text, link, 선택 UI result, 첨부 image를 structured source로 draft API에 전달한다. link는 메모리 turn 해석 전에 source 유형별로 lazy 분석해 별도 cache artifact로 저장한다. article/case study와 live product는 실제 URL의 case·기능·포지셔닝·UX 근거를 분리하고, visual curation/style source는 선택 이미지 자체를 vision 분석한다. 이후 user input·agent output과 source evidence를 함께 해석해 이번 interaction의 참고 측면과 적용 범위를 정한다. 세부 구현은 `src/lib/server/referenceSourceAnalysis.ts`와 `src/lib/server/memorySourceNormalization.ts`를 직접 확인한다 `[현행 2026-06-23 → 15.110]`
- **첨부 이미지 시각 선호**: image normalizer는 의도적으로 선호를 추론하지 않으므로, 첨부 이미지가 주도한 목업 생성이 성공해 derivedDesignStyle가 나오면 그 스타일을 `style-image-preference-{turnId}` interactionId(category `style_image_preference`)로 별도 draft에 기록한다. 이번 미션/시안 맥락의 session-scoped evidence로 담고 전역 취향으로 단정하지 않는다 `[현행 2026-06-21 → 15.101]`
- **확정 시점**: 사용자가 `세션 종료` 버튼을 누르면 `/api/memory/complete-session`에서 draft를 통합해 장기 메모리로 저장
- **버전 관리**: admin memory modal에서 v0.1.0 / v0.1.1 / v0.1.2를 분리 조회 `[stale 2026-06-12 → 15.51: legacy fallback 제거로 현재 v0.1.2 단일 버전만 사용(MemoryVersionTab = "0.1.2"). v0.1.0/v0.1.1 분리 조회 없음]`
- **현재 활용**: 각 채팅 turn 직전에 `/api/memory/retrieve`를 호출한다. Current/prior before-session과 during-session memory는 모두 같은 query similarity 후보이며, 별도 current-session boost나 prompt 강제 포함은 없다. 기본 retrieval limit은 top 10이다. 먼저 모든 active memory를 query cosine similarity로 정렬한 뒤, 저장된 cluster membership이 있으면 cluster evidence를 결합한 hybrid score로 재정렬한다. Cluster evidence는 cluster 내 max similarity와 top 3 mean만 사용하며 label/summary나 추가 LLM 호출은 ranking에 사용하지 않는다. Global cosine top 2는 결과에 보존하고, cluster cache가 없거나 유효한 다중-member cluster가 없거나 현재 active 후보의 cluster assignment coverage가 50% 미만이면 기존 global cosine top 10으로 fallback한다. 실제로 retrieved된 active 항목만 prompt에 들어가며 weight/retrievedCount가 업데이트되고, decay 대상은 global 순위 절단이 아니라 최종 retrieved ID를 제외한 나머지다. 응답과 log는 `sourceMissionId`와 `beforeSessionScope`(`current_mission`/`prior_mission`)를 보존한다. 어드민이 `viewAs`로 리뷰 화면을 볼 때 assistant bubble의 `Prompt 보기` 버튼 하나로 통합 모달이 열린다: Prompt 탭은 저장된 raw prompt를 block label(basePrompt/mission/activeIdea/designSpec/mockupHtml/retrievalMemory/citedTexts/selectedElement/citedReferences/referencePreference/mentionedArtifact/requestedCommand/actionInstruction/currentRequest/conversation) 단위 카드로 보여주고(1200자 초과 블록은 기본 접힘), Retrieval 탭은 해당 turn의 retrieval query, retrieved memory, raw retrieval log JSON을 보여준다. label은 서버가 systemMessages 구성 시 붙여 review turn에 저장하며 모델 호출 전에는 strip한다(15.263). label 없는 과거 turn은 role 기준으로 폴백 렌더링한다 `[현행 2026-07-16 → 15.187/15.190/15.193/15.199/15.209/15.211/15.284]`
- **Prompt 주입 방식**: profile input은 `profile_memories`에 source of truth로 보관한 뒤 derived memory로 쪼개 retrieved memory와 같은 chat context 경로로 들어간다. `/api/chat`은 retrieved/filter를 통과한 memory를 before-session/profile과 during-session/interaction으로 다시 나누지 않고 `chatRetrievedMemoryPrompt` 단일 system message로 주입한다. retrieved memory는 `episodic`/`semantic` 두 그룹으로 재그룹화해 nested JSON이 아닌 plaintext bullet 목록으로 주입한다 — Episodic/Semantic 섹션 헤더 아래 `- ...` 줄이며, before-session 항목만 `(before-session {scope}, mission: {id})` 접미로 origin을 보존한다. memory relevance는 background/light/relevant/strong 4단계이며 relevant(기본)만 한 줄 지시를 생략한다(기본 지시문과 중복). planner 입력의 similarity signal도 low/mid-low/mid-high/high 4구간이다(15.268). planner가 memoryDirectives(최대 2개 명령형)를 반환하면 relevance 줄 대신 system 스택 후반부(currentRequest 직전)의 별도 memoryDirectives 블록으로 주입하고 raw bullet은 유지한다(15.266). 액션 턴(브리프/목업/디자인 스타일 계열)은 action tag 직전에 1-2문장의 가시적 근거를 쓰며, 선호가 반영된 경우 메모리라는 표현 없이 자연어로 드러낸다(15.267). Current/prior before-session memory도 top-k에 실제로 retrieved된 경우에만 사용할 수 있으며, memory id/weight/similarity는 prompt에서 제외한다 `[현행 2026-07-15 → 15.187/15.190/15.191/15.199/15.208/15.265]`
- **Legacy**: `GET /api/memory/bootstrap`은 세션 시작 시 memory를 preload하던 구 방식이며, 현재 main client에서는 호출하지 않음
- **Retrieval 쿼리 구성**: `[user text] + Mission: [parentMissionTitle] + Active idea: [description]` — 선택된 옵션 이름(페르소나 등)은 제외해 임베딩 노이즈 방지
- **Admin 관측**: researcher가 `/admin/users/[uid]/memory`에서 `/agent`와 동일한 user별 memory cluster graph/list/detail을 확인 가능. detail panel은 그래프 왼쪽에 있고 cluster list는 요약 없이 색상·제목·개수만 표시한다 `[현행 2026-06-27 → 15.130]` `[stale 2026-06-30 → 15.169: cluster list가 main 세션리뷰와 동일한 review presentation(rounded card + 색상 count rail + 접기 rail)로 통일됨]` Before-session memory의 detail card 제목은 분리된 `source.sourceText`를 우선 표시하고, `Original input`은 별도 강조 없이 전체 `input` rawMarkdown을 표시한다 `[현행 2026-07-07 → 15.195/15.196]`
- **Retrieval MVP**: v0.1.2 memory document에 embedding과 `weight` metadata를 저장하고, retrieve된 memory의 weight를 천천히 올림. retrieval과 clustering은 `memories_0_1_2.embedding`에 저장된 같은 vector를 사용하며, 누락·stale embedding은 공용 `memoryEmbedding` helper가 같은 텍스트 계약으로 재생성해 원본 memory document에 write-back한다. During-session embedding 입력은 keyword + episodic + semantic + link이고, before-session embedding 입력은 source.sourceText + keyword + episodic + semantic + link다. 원문 interaction input/output은 embedding에서 제외한다. 계약이 바뀌면 `embeddingSource` 태그를 올려(`during_session_record_text_v2`, `before_session_unit_text`) 기존 embedding을 stale 처리해 재생성한다 `[현행 2026-07-10 → 15.194/15.201]`
- **Forgetting / inactive memory**: active memory의 기준은 `archivedAt`이 없고 `weight > 0`인 문서다. `archivedAt`이 있거나 `weight <= 0`인 memory는 Firestore에는 남지만 retrieval과 clustering 입력에서 제외된다. `/agent`와 admin의 사용자 전용 memory page는 관측을 위해 명시적으로 inactive/archived 문서도 함께 읽되 실제 similarity cluster membership과 edge에서는 제외하고 `session-inactive` pseudo-group으로만 보여준다. `weight <= 0`은 별도 archive write 없이 inactive로 취급한다. Idle decay는 active soft cap 방식이다: 활성 memory 수가 cap 이하이면 decay가 아예 돌지 않고, cap을 넘으면 retrieve되지 않은 memory가 턴당 `0.006`~`0.012`(초과분 50개에서 포화) 깎여 0(inactive)까지 내려간다. cap은 전체 입력 70개까지 70을 유지하고, 70~100개 구간에서 70→85로 선형 증가하며, 이후에는 100개 지점에서 이어지는 제곱근 곡선으로 완만히 증가한다 — 전체 100개면 85, 200개면 ~114, 300개면 ~133이다. 전체 입력 수는 비활성 포함 문서 수(retrieval 로그의 totalMemoryCount/activeMemoryCap 필드)다. 사용자는 세션 memory review의 detail card에서 직접 memory를 비활성화할 수 있고, 이때 자유 입력 이유를 필수로 받아 `inactiveReason: user_disabled`와 `inactiveReasonDetail`을 저장하며 weight를 0으로 만든다. 재활성화는 archive/manual/weight-zero 원인과 관계없이 `archivedAt`/비활성 marker를 해제하고 weight를 0.5로 복구한다. 세션 리뷰와 `/agent`의 inactive memory는 별도 pseudo-group이라 cluster 수에 포함하지 않는다. cluster list 하단의 보조 행은 inactive memory가 0개여도 유지하며 count 0을 표시한다. 이 행을 누르면 inactive pseudo-group을 선택해 detail panel을 전환하고, memory가 있으면 graph node도 보이게 한다. 행 오른쪽 eye icon은 선택과 별개로 node 표시만 토글하고 0개일 때는 비활성화하며, list를 접으면 group 선택 icon과 eye toggle을 하단에 유지한다. 상태 변경 command는 세션 리뷰의 일반 사용자에게만 제공하고 `/agent`와 admin view에는 제공하지 않는다. Review turn에 이미 저장된 retrieved memory는 리뷰 패널에서 회색 inactive 상태와 이유를 표시한다. Archived/inactive node와 detail card는 phase weight와 무관하게 더 옅은 회색 톤으로 렌더한다. Admin forgetting 후보/수동 archive route와 탭은 제거되었고, admin은 current graph/table/retrieval log 중심으로 관측한다 `[현행 2026-07-16 → 15.202/15.211/15.235/15.241/15.269/15.277/15.279/15.280/15.281/15.282/15.283/15.286]`

#### 메모리 클러스터링

- 경로: 일반 사용자 본인 memory는 `GET/POST /api/memory/clusters`, admin의 타인 memory 진단은 `GET/POST /api/admin/users/[uid]/memory/clusters`
- 입력: clustering vector는 retrieval과 같은 active `memories_0_1_2.embedding` 저장값을 사용한다. `archivedAt`이 있거나 `weight <= 0`인 memory는 현재 graph/clustering 입력에서 제외한다. 저장값이 없거나 `embeddingSource`가 현재 sourceType 계약과 맞지 않으면 keyword/episodic/semantic/link(before-session은 source.sourceText 포함) 텍스트로 재생성해 문서에 write-back한다. 원문 interaction input/output은 clustering embedding에 포함하지 않고, 입력 variant 비교는 제공하지 않는다 `[현행 2026-07-13 → 15.178/15.201/15.202/15.211]`
- 1단계: 저장된 `text-embedding-3-large` memory embedding을 읽고, clustering-time에만 전체 평균 벡터를 뺀 뒤 L2 normalize한 centered vector를 만든다. 저장 embedding 자체는 바꾸지 않고, retrieval과 clustering은 여전히 같은 Firestore embedding source를 공유한다.
- 2단계: centered vector로 cosine similarity graph를 만든다. 강한 유사도 edge와 node별 KNN edge를 함께 쓰되, threshold는 raw embedding 시절의 고정값이 아니라 현재 corpus의 pairwise similarity 분위수에서 계산한다. 기본값은 min p85, strong p97이다.
- 3단계: similarity graph에서 label propagation으로 community를 찾고, community가 너무 많으면 centered vector의 centroid similarity 기준으로 merge한다. merge cap은 node 수에 따라 `max(floor(nodeCount / 5), floor(1.5 * sqrt(nodeCount)))`로 점진 증가하고, 점근 상한은 16개다. 34% giant community 재분할은 아직 적용하지 않고, mean-centering/adaptive-threshold 결과를 먼저 확인한 뒤 필요하면 후속 안전장치로 추가한다.
- 4단계: LLM은 cluster membership을 바꾸지 않고 최종 cluster label/summary만 생성한다. Labeler는 비교 안정성을 위해 `temperature: 0`으로 고정한다. Summary는 작업 목록을 일반적으로 요약하지 않고 Firestore profile의 실제 displayName을 사용해 그 사람의 반복되는 성격, 습관, 작업 방식, 의사결정 패턴과 디자인 취향을 근거와 함께 서술한다. 단일·약한 근거에는 consistently/always 같은 반복 표현을 쓰지 않는다 `[현행 2026-07-10 → 15.99/15.198]`
- `/agent`(self·admin 공용) UI 헤더에는 고정 입력 구성(keyword · episodic · semantic · link)만 표시하고, 입력 variant 토글은 렌더하지 않는다 `[현행 2026-07-03 → 15.178]`
- `/agent` cluster UI는 좌측에서 cluster list → detail panel → graph 순서로 배치한다. cluster list는 main 세션 리뷰와 동일한 `MemoryClusterList` review presentation을 사용한다 — 색상 count rail이 달린 rounded card, cluster label만 표시, 좌측 접기 rail 제공. cluster summary와 선택됨 badge는 숨긴다. Cluster color는 배열 index가 아니라 저장된 `colorIndex`를 우선 사용하며, cluster 재생성 시 이전 cluster와 item overlap이 가장 큰 successor 하나가 기존 색을 계승한다. Graph layout은 현재 edge weight 분포의 p05~p95 범위로 spring strength를 정규화하고, hard boundary clamp 대신 soft boundary force를 사용해 node가 viewport 가장자리에 일렬로 붙는 현상을 줄인다 `[현행 2026-07-13 → 15.169/15.238/15.239]`
- `/agent`의 세션 필터는 유저별 `missionOrder` 기준의 누적 메모리 집합을 사용한다. 예를 들어 세션 2를 선택하면 세션 2까지의 누적 메모리를 보여주고, 세션 2에서 새로 생성된 메모리만 다이아몬드로 표시한다. 세션 리뷰 overlay는 세션 완료 시 생성된 before/after cluster snapshot을 사용해 phase별 cluster label/summary/membership/edge를 분리 표시한다. 기본 그래프 필터는 전체 메모리다 `[현행 2026-07-10 → 15.178/15.197]`
- 캐시 키는 memory version + item signature + clustering method version으로 관리하고, method version에는 고정 입력 이름 `keyword-episodic-semantic-link`가 포함된다. mean-centered adaptive-threshold graph 전환 후 method version은 `similarity-graph-v6-centered-adaptive-threshold`이며, latest fallback 조회도 같은 current method version만 읽어 과거 compact-context/full-context/v3/v4/v5 cache와 섞지 않는다 `[현행 2026-07-13 → 15.178/15.201/15.234/15.237]`
- Self/admin API는 `loadUserMemoryItems`와 `loadClusterInputItems`를 공유하며, admin 전용 cluster route도 `generateAndStoreClusters`를 호출한다. 별도 admin clustering 알고리즘은 두지 않는다 `[현행 2026-06-22 → 15.107]`

---

## 5. 데이터 구조 (Firestore)

### `missions/{missionId}`

```
title, description, startDate, endDate, device, createdAt
```

### `missions/{missionId}/participants/{userId}`

```
displayName, email, photoURL, updatedAt
```

### `sessions/{userId}/missions/{missionId}`

```
messages: Message[]
artboards: Artboard[]          // ideaId 포함, Stitch 아트보드는 html 제거 후 저장
ideas: Idea[]
references: Reference[]
missionTitle, missionBrief
selectedOptionId, selectedDevice
timerStartedAt, startedAt
status                          // completed면 세션 종료 버튼 비활성화
stitchProjectId
updatedAt
```

### `users/{userId}/memoryClusters/{clusterCacheId}`

```
itemSignature
memoryVersion
sourceItemCount
clusters: MemoryCluster[]
graphClusters: MemoryCluster[]
graphEdges: ClusterGraphEdge[]
clusteringInputVariant
clusteringMethodVersion
diagnostics: {
  method
  embeddingModel
  labelModel
  requestedClusterCount
  actualClusterCount
  graph: { minSimilarity, strongSimilarity, knnEdges, nodeCount, edgeCount, meanCentered, ... }
}
generatedAt, generatedBy
```

### `users/{userId}/memoryClusterSnapshots/{missionId}_{before|after}`

```
missionId
phase: "before" | "after"
itemIds
itemSignature
memoryVersion
clusteringInputVariant
clusteringMethodVersion
sourceItemCount
graphClusters: MemoryCluster[]
graphEdges: ClusterGraphEdge[]
graphDiagnostics
generatedAt, generatedBy
```

### 주요 타입

```typescript
type Artboard = {
  id;
  html;
  label;
  x;
  y;
  device;
  stitchScreenId?;
  ideaId;
};
type Idea = {
  id;
  title;
  description; // description은 마크다운 텍스트
};
```

---

## 6. API Routes

> `[부분 목록 2026-06-12]` 아래 표는 일부만 담고 있다. 실제 라우트와 method의 source of truth는 `src/app/api/` 디렉터리를 직접 확인할 것.

| 경로                                              | 설명                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `POST /api/chat`                                  | 채팅 응답 생성 (OpenAI Responses API 기본, Anthropic 선택 가능)         |
| `POST /api/stitch`                                | Google Stitch 목업 생성/편집                                            |
| `GET /api/stitch/html`                            | Stitch 스크린 HTML 재조회                                               |
| `POST /api/references`                            | OpenAI web_search_preview로 style·product 레퍼런스 검색 (3개 반환)      |
| `POST /api/memory/drafts`                         | interaction turn 단위 memory draft 생성                                 |
| `POST /api/memory/complete-session`               | 세션 종료 시 draft를 장기 메모리로 확정                                 |
| `GET /api/memory/bootstrap`                       | Legacy: 세션 시작 시 user memory preload. 현재 main client에서는 미사용 |
| `POST /api/memory/retrieve`                       | query embedding과 cluster evidence 기반 memory top 10 검색 및 weight 업데이트 |
| `POST /api/memory/session-clusters`               | 완료 세션 리뷰용 before/after cluster snapshot 생성                      |
| `GET/POST /api/memory/profile`                    | profile source 저장/조회 및 derived memory 생성                         |
| `GET /api/admin/users/[uid]/memory`               | admin memory/cluster view용 메모리 조회                                 |
| `GET/POST /api/admin/users/[uid]/memory/clusters` | admin memory cluster 캐시 조회/생성                                     |

---

## 7. 프롬프트 관리 (`src/lib/prompts.ts`)

모든 LLM 프롬프트는 `src/lib/prompts.ts` 한 곳에서 관리한다. 각 API route는 이 파일에서 import해서 사용하며, 프롬프트를 직접 route 파일에 인라인으로 작성하지 않는다.

| export                                               | 종류     | 사용처                                                      |
| ---------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `CHAT_AGENT_BASE_PROMPT`                             | const    | `chat/route.ts` — 공통 에이전트 역할/명령 태그 정의         |
| `chatActionInstructionPrompt(intent, includeRouter)` | function | `chat/route.ts` — planner intent에 맞는 행동 규칙만 주입    |
| `chatDevicePrompt(deviceLabel)`                      | function | legacy helper — 현행 `/api/chat`은 target device를 mission block에 통합 `[현행 2026-07-13 → 15.214]` |
| `chatMissionPrompt(title, brief, deviceLabel?)`      | function | `chat/route.ts` — 미션 컨텍스트와 대상 디바이스 주입         |
| `chatRetrievedMemoryPrompt(json)`                    | function | `chat/route.ts` — retrieved memory 단일 주입                |
| `chatDesignSpecPrompt(spec)`                         | function | `chat/route.ts` — 디자인 스타일 가이드 주입                 |
| `chatCitedTextsPrompt(texts)`                        | function | `chat/route.ts` — 인용 텍스트 주입                          |
| `chatActiveIdeaPrompt(title, desc)`                  | function | `chat/route.ts` — 현재 작업 시안 주입                       |
| `chatCurrentRequestPrompt()`                         | function | `chat/route.ts` — 최신 user message가 현재 요청임을 명시    |
| `chatMockupHtmlPrompt(html)`                         | function | `chat/route.ts` — 현재 목업 HTML 주입                       |
| `chatSelectedElementPrompt(sel, html)`               | function | `chat/route.ts` — 선택된 UI 요소 주입                       |
| `chatCitedRefsWithUrlPrompt(titles, urls)`           | function | `chat/route.ts` — URL 있는 레퍼런스                         |
| `chatCitedRefsNoUrlPrompt(titles)`                   | function | `chat/route.ts` — URL 없는 레퍼런스                         |
| `MEMORY_ENCODE_PROMPT`                               | const    | `memory/drafts/route.ts` — interaction → memory 인코딩      |
| `REFERENCE_MODE_CLASSIFY_PROMPT`                     | const    | `references/route.ts` — style vs product 분류               |
| `referenceQueryBuilderPrompt(mode, names)`           | function | `references/route.ts` — 검색 쿼리 생성                      |
| `referenceCandidateRankingPrompt(mode, n)`           | function | `references/route.ts` — 후보 랭킹                           |
| `referenceProductSearchPrompt(names)`                | function | `references/route.ts` — 제품 레퍼런스 검색                  |
| `referenceImageSourcePrompt(title, desc)`            | function | `reference-image/route.ts` — 앱 UI 레퍼런스 페이지 검색     |

---

## 8. 데이터 분석 스크립트 (`scripts/`)

| 스크립트                  | 기능                             |
| ------------------------- | -------------------------------- |
| `export_sessions.py`      | 전체 참가자 세션 데이터 내보내기 |
| `delete_user_sessions.py` | 특정 사용자 세션 전체 삭제       |

- Firebase Admin SDK 사용 (`vibedesignagent-key.json` 서비스 계정 키 필요)
- 출력: `exports/sessions.json`

---

## 9. 환경 변수 (`.env`)

```
STITCH_API_KEY_A # Stitch group A account key from Stitch Settings
STITCH_API_KEY_B # Stitch group B account key from Stitch Settings
STITCH_API_KEY # optional legacy/diagnostic fallback when no user group key is supplied
STITCH_OAUTH_REFRESH_TOKEN # optional Stitch user OAuth refresh token for the server-owned lab account
STITCH_OAUTH_CLIENT_ID
STITCH_OAUTH_CLIENT_SECRET
STITCH_OAUTH_ADC_PATH # optional local path to application_default_credentials.json
STITCH_ACCESS_TOKEN # optional local temporary Stitch user OAuth override
STITCH_GOOGLE_CLOUD_PROJECT # Stitch OAuth quota project, separate from Firebase
GOOGLE_CLOUD_PROJECT # optional fallback for Stitch OAuth quota project
STITCH_AUTH_PREFERENCE # optional: api-key | api-key-only | oauth; api-key-only disables OAuth fallback
STITCH_EDIT_PROMPT_MODE # optional, compact enables short edit prompt + GEMINI_3_1_PRO experiment
STITCH_EDIT_TARGET_MODE # optional: screen-id | screen-instance; screen-instance also sends selectedScreenInstances from get_project
STITCH_LOG_TOOL_SCHEMAS # optional, set 1 to dump live Stitch tool schemas once on edit
OPENAI_API_KEY
OPENAI_STITCH_FALLBACK_MODEL # optional, default gpt-5.4-mini
CHAT_RESPONSE_PROVIDER # optional: openai | anthropic
OPENAI_CHAT_MODEL # optional, default gpt-5.4
ANTHROPIC_API_KEY # required when CHAT_RESPONSE_PROVIDER=anthropic
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_MEASUREMENT_ID
```

---

## 10. Decision / Implementation Log — 최근 구현된 변경 사항 `[implemented]`

이 장은 구현 히스토리 보존용이다. 현재 동작 설명은 1-9장에 반영된 내용을 우선한다.

### 10.1 메모리 클러스터링 개선

- 기존 고정 `K=10` k-means에서 `K=1..12` 실험 기반으로 변경
- Elbow method로 inertia 감소 곡선의 elbow 지점을 계산
- ClusterLLM 논문 아이디어를 반영해 LLM pairwise category 판단으로 최종 K 선택
- 최종 cluster는 LLM K 기준으로 생성하며, Elbow K는 fallback/tie-breaker로 사용
- Admin UI에서 cluster list, selected cluster detail, Elbow/LLM 진단값 표시
- cluster view 좌/우 패널은 modal 내부에서 독립 스크롤되도록 조정

### 10.2 단일 옵션 미션 세션 종료 버튼

- 옵션이 하나뿐인 새 미션에서 `selectedOptionId`가 없어 세션 종료 버튼이 표시되지 않는 문제 수정
- 단일 옵션 미션은 로드 시 자동 선택하고 세션 문서에 선택 상태를 저장
- 세션 시작 버튼을 누르기 전에는 `timerStartedAt`과 복구 가능한 세션 데이터가 없으므로 세션 종료 버튼을 `세션 시작 전` 상태로 비활성화
- 이미 `status: completed`인 세션은 기존처럼 버튼이 비활성화되고 `세션 종료됨`으로 표시

### 10.3 Memory retrieval MVP

- `/api/memory/complete-session`에서 semantic item별 embedding과 score metadata를 저장
- 기존 v0.1.1 memory 중 metadata가 없는 문서는 `/api/memory/retrieve` 호출 시 lazy backfill
- `/api/memory/retrieve`는 LLM 없이 query embedding과 semantic item embedding의 cosine similarity로 top 5를 선택 `[stale 2026-07-13 → 15.209: retrieval top-k는 10으로 조정됨]`
- retrieve된 memory는 `weight`, `retrievedCount`, `lastRetrievedAt`를 업데이트
- top 5에는 들지 못했지만 충분히 가까운 top 6~20 후보에는 작은 weight 감소를 적용해 forgetting 압력을 누적 `[stale 2026-07-13 → 15.209: retrieval top-k 10 이후에는 top 11~20 후보에 forgetting 압력을 누적]`
- retrieval log는 `users/{uid}/memoryRetrievalLogs/{logId}`에 저장
- 메인 채팅 요청 전 현재 user input + mission/idea context를 query로 사용해 retrieve하고, 결과를 해당 turn의 memory context에 주입
- Admin memory modal의 Retrievals 탭에서 query, retrieved memory, similarity, weight delta를 확인 가능

### 10.4 References API 개선

- **성능**: `Promise.all` 대신 `withConcurrency(tasks, 4)`로 병렬 fetch 수 제한
- **안정성**: `extractFirstJsonArray()` — regex 대신 bracket depth counting 파서로 URL 내 `[]` 포함 케이스 처리
- **보안**: `sanitizeInput(value, maxLength)` 함수로 LLM 입력 길이 제한 및 prompt injection 방지
- **검색 모드 분기**: `inferReferenceMode(query)`로 style/product 모드 분기. 두 모드 모두 `searchWebReferences(mode, ...)` 단일 OpenAI web_search_preview 경로로 검색하고, 모드는 시스템 프롬프트와 저품질 필터만 다르게 고른다 `[현행 2026-06-30 → 15.172]`
- **이미지 확보**: 결과 페이지 URL의 og:image를 `hydrateReferenceMetadata()`로 fetch해 썸네일 확보
- ID 생성을 `Date.now()`에서 `crypto.randomUUID()`로 교체

### 10.5 로비 이탈 경고 모달

- 세션 미종료 상태(`!sessionCompleted`)에서 로비로 돌아가기 클릭 시 경고 모달 표시
- "메모리 저장이 되지 않을 수 있습니다. 세션 종료 버튼을 먼저 눌러주세요." 안내
- 그래도 나가기 / 취소 두 가지 선택지 제공

### 10.6 목업 생성 시 missionBrief 보완 주입

- `buildMockupPrompt(basePrompt, idea, style, missionBrief)` 함수에 `missionBrief` 파라미터 추가
- 신규 목업 생성(`[GENERATE_MOCKUP]`) 시에만 적용: 아이디어 내용이 300자 미만이면 missionBrief를 프롬프트 말미에 추가
- 목업 편집(`[EDIT_MOCKUP]`)에는 주입 안 함 — 기존 화면 구조를 유지해야 하므로

### 10.7 Memory retrieval 쿼리 개선

- retrieval 쿼리에서 `effectiveMissionTitle`(`parentTitle - optionName` 형태) 대신 `parentMissionTitle`만 사용
- 페르소나 이름("🎬 Daniel Park" 등) 같은 옵션 타이틀이 임베딩 벡터에 노이즈를 추가하는 문제 제거

### 10.8 Memory forgetting/archive MVP `[stale 2026-07-13 → 15.211/15.241: admin forgetting 후보/수동 archive route와 탭 제거, weight 0 inactive 방식으로 전환]`

- `GET /api/admin/users/[uid]/memory/forgetting`에서 archive candidate를 산출하고 자동 soft archive `[stale 2026-07-13 → 15.241: route 제거]`
- 후보 기준:
  - v0.1.2 memory `weight < 0.28`
  - memory embedding cosine similarity가 `0.92` 이상인 duplicate pair
- duplicate 후보는 weight와 retrievedCount가 낮은 쪽을 archive target으로 제안
- Admin memory modal의 Forgetting 탭에서 이번 호출에 자동 archive된 item을 확인 가능
- Admin memory modal의 Archived 탭에서 archivedAt, archiveReason, weight metadata 확인 가능
- archive된 memory는 retrieval 대상에서 제외됨

### 10.9 Memory schema v0.1.2

- 새 collection: `users/{uid}/memories_0_1_2`
- interaction turn 1개당 episodic memory는 반드시 1개 생성
- semantic memory는 durable insight가 있을 때만 0~1개 생성
- Episodic/Semantic 생성 input field를 aMem 방식에 맞춰 `action`, `keyword`, `episodic`, `semantic`, `input`, `output`, `link`로 통일
- `importanceScore`, `usageScore`, `decayScore`, `retentionScore` 세부 필드를 hMem 방식의 단일 `weight`로 통합
- retrieval은 v0.1.2를 우선 사용하고, 새 데이터가 없으면 v0.1.1 semanticItems를 fallback adapter로 읽음
- semantic이 있으면 semantic text를 embedding하고, 없으면 episodic text를 embedding fallback으로 사용

---

## 11. Decision / Implementation Log — 메모리 Retrieval / Forgetting 개발 계획 `[implemented / partially superseded]`

> **상태**: v0.1.2 기준으로 재정리됨. v0.1.1의 semanticItems/retentionScore 설계는 fallback adapter로만 유지.

### 11.1 목표

- interaction 중 필요한 memory를 vector similarity 기반으로 retrieve
- retrieve 결과를 관측 가능하게 기록해 연구자가 어떤 memory가 사용됐는지 확인
- 사용된 memory는 `weight`를 천천히 강화하고, low-weight 또는 중복 memory는 archive 후보로 낮춤
- 초기에는 hard delete 대신 `archivedAt` 기반 soft archive로 운영

### 11.2 개발 순서

#### 1단계: Memory schema v0.1.2

- interaction memory document마다 아래 필드 저장

```typescript
action: string
keyword: string[]
episodic: string
semantic: string | null
input: string
output: string
link: string | null
weight: number
lastRetrievedAt: number | null
retrievedCount: number
createdAt: number
updatedAt: number
embedding?: number[]
duplicateOf?: string | null
archivedAt?: number | null
archiveReason?: string | null
```

- `episodic`은 항상 생성하고 `semantic`은 clearly supported durable insight가 있을 때만 0~1개 생성

#### 2단계: Memory embedding 저장

- `/api/memory/complete-session`에서 v0.1.2 memory 확정 시 embedding 생성
- semantic이 있으면 semantic, 없으면 episodic을 embedding source로 사용
- 모델은 클러스터링과 동일하게 `text-embedding-3-large`로 시작
- 저장 비용/문서 크기 문제가 커지면 embedding subcollection 분리 검토

#### 3단계: Vector retrieval API 추가

- 구현 경로: `POST /api/memory/retrieve`

```typescript
{
  query: string
  missionId?: string
  limit?: 5 // [stale 2026-07-13 → 15.209: current default/max is 10]
}
```

- LLM 없이 query embedding과 memory embedding의 cosine similarity로 top 5 검색 `[stale 2026-07-13 → 15.209: retrieval top-k는 10으로 조정됨]`
- `archivedAt`이 있는 memory는 기본 제외
- 반환값은 채팅 context에 사용할 compact memory와 admin/debug용 metadata를 분리

#### 4단계: Retrieval log 저장

- 실제 유저에게는 노출하지 않되 admin researcher view에서 확인 가능하게 저장

```typescript
query;
queryEmbeddingModel;
retrievedMemoryIds;
similarities;
scoreDeltas;
idleDecayDeltas;
idleDecayCount;
missionId;
createdAt;
```

- admin memory modal의 Retrievals 탭에서 조회 가능

#### 5단계: 가점/감점 시스템

- retrieve된 memory:

```typescript
weightGain = 0.04 / Math.sqrt(retrievedCount + 1);
weight = min(1, weight + weightGain);
retrievedCount += 1;
lastRetrievedAt = now;
```

- 그 턴에 retrieve되지 않은 memory:

```typescript
weight = max(0, weight - idleDecayWeightLoss(memoryCount))
```

- weight가 너무 빠르게 커지지 않도록 sublinear growth 사용
- idle decay 기본값은 턴당 `0.005`, memory 수가 많으면 multiplier를 적용하되 상한 `0.006`을 넘기지 않음 `[stale 2026-07-13 → 15.241: 기본값 0.006, 상한 0.012, floor 0]`
- 벽시계 시간이 아니라 retrieval 턴 기준으로만 감소시켜 3일 formative 실험의 시간 기반 archive 금지 원칙과 분리

#### 6단계: 망각 후보 산출

- 구현됨: hard delete 없이 archive candidate를 자동 soft archive
- 후보 기준:
  - weight가 threshold 아래
  - 유사 memory가 더 높은 weight로 존재
- soft archive:

```typescript
archivedAt = now;
archiveReason = "low-weight" | "duplicate" | "manual";
```

#### 7단계: 중복 semantic 정리

- 구현됨: cosine similarity가 높은 memory pair를 duplicate candidate로 표시
- 초기 threshold 후보: `similarity > 0.92`
- 남길 memory 기준:
  - weight가 높은 것
  - 최근 retrieve된 것
  - 더 구체적이고 긴 episodic/semantic
  - 여러 session에서 반복된 패턴
- 자동 archive는 researcher 검토 후 feature flag로 켜기

### 11.3 운영 원칙

- hard delete하지 않는다.
- 연구자가 retrieval, score 변화, archive 결과를 확인할 수 있게 만든다.
- formative 실험 기간이 3일이므로 시간 기반 stale 기준은 자동 archive에 사용하지 않는다.
- memory가 사라지는 것보다 "왜 사라졌는지 설명 가능함"을 우선한다.

---

## 12. Active Backlog / Roadmap — 미구현 / 향후 계획 `[active]`

- 반응형/접근성 개선
- E2E 테스트
- Forgetting threshold tuning 및 automatic archive feature flag
- 공통 memory UI 컴포넌트 추출 (`MemoryCard`, `MemorySelector`, `RetrievedMemoryBadge`, `PromptViewer`, `SessionMemoryDiff`)
- 전체 UI polish

---

### 12.1 메모리 리뷰/온보딩 개선 로드맵 `[implemented / active tail]`

이 섹션은 향후 작업을 하나씩 체크하며 진행하기 위한 실행 문서다. 원칙은 **데이터 계약 → 사용자 리뷰 경험 → 온보딩 입력 모델 → 어드민/UI 정리** 순서로 진행한다.

#### 12.1.1 진행 원칙

- 화면부터 만들기보다 memory/retrieval/review에 필요한 데이터 계약을 먼저 고정한다.
- 사용자에게는 "어떤 기억이 참고되었는지"를 설명 가능하게 보여주고, 연구자에게는 prompt/raw context를 더 자세히 확인할 수 있게 한다.
- 직접 입력 메모리와 interaction에서 학습된 메모리는 source/type을 분리한다.
- table view 제거는 대체 관측 UI가 충분히 생긴 뒤 진행한다.

#### 12.1.2 1단계: 리뷰 기능 데이터 계약 정의

- [x] 완료 미션의 리뷰 진입점 정의
  - `/lobby` 완료 미션 카드에 상시 노출되는 `리뷰` 버튼
  - 세션 종료 버튼을 누른 뒤 완료 상태에서 이어서 볼 수 있는 `리뷰` 진입
  - admin 사용자 세션 카드의 `리뷰` 진입
- [x] 리뷰 화면 형태 결정
  - 별도 review page/modal을 새로 만들지 않고 기존 `/main/[missionId]` read-only 흐름을 확장한다.
- [x] 리뷰에 표시할 데이터 범위 정의
  - 채팅 로그
  - assistant bubble별 retrieved memory
  - retrieved memory의 `weight`, `weightDelta`, `similarity`, `source`
  - 해당 turn의 LLM input/prompt compact view
  - 세션 종료 전후 생성/변경/archived memory
- [x] prompt 노출 범위 정의
  - 사용자용: memory/retrieval context 중심
  - 연구자용: raw prompt/input JSON까지 표시 가능
- [x] 리뷰 화면 공유/내보내기 필요 여부
  - 별도 공유/내보내기 기능은 만들지 않는다.
- [x] 일반 사용자와 admin researcher 모드 구분 방식
  - 1차 구현에서는 별도 구분 없이 같은 read-only 확장을 사용한다.
  - 단, 이후 admin-only raw debug view를 추가할 수 있게 데이터/API는 확장 가능하게 둔다.
- [x] assistant bubble별 retrieval/prompt 데이터 저장 위치 결정
  - 기존 session document에 모두 넣지 않고 별도 review/debug subcollection으로 분리한다.
  - 이유: session document는 이미 `messages`, artboards, ideas를 저장해 커지기 쉬우므로 prompt/raw context까지 포함하면 Firestore 문서 크기와 저장 빈도 리스크가 커진다.
  - 권장 경로: `sessions/{uid}/missions/{missionId}/reviewTurns/{turnId}`
  - session `messages[]`에는 필요 시 `reviewTurnId`만 연결 필드로 둔다.
- [x] 필요한 Firestore/API 응답 필드 확정
  - `reviewTurns/{turnId}` 필드:
  - `turnId`는 assistant message id를 사용한다. 즉 assistant bubble id와 `reviewTurns/{turnId}`를 1:1로 연결한다.
  - `turnId`와 `assistantMessageId`는 문서 id와 중복되므로 문서 필드에는 저장하지 않는다.
  - 사용자용 prompt compact view에는 `missionBrief` 전체를 표시한다.
  - `rawPromptActual`과 sanitized `rawPrompt`를 1차 구현부터 저장한다.
  - `rawPrompt` 열람은 admin-only debug view로 분리한다.
  - `rawPromptActual`은 모델에 보낸 실제 prompt이고, `rawPrompt`는 저장 전 sanitize한 비교/안전용 copy다. 제거된 항목의 흔적은 `rawPromptSanitization`에 남긴다.
  - raw prompt sanitize 대상:
    - API key
    - auth token
    - base64 image/data URI
    - HTML 코드 전체
  - HTML은 길이 기준으로 자르지 않고, HTML이 있었다는 흔적만 남긴다. 예: `[html 코드]`
  - `rawResponseMeta`는 request id/model/error와 token usage까지 저장한다.

```typescript
{
  userMessageId: string,
  createdAt: number,
  query: string,
  retrieved: Array<{
    memoryId: string,
    episodic: string,
    semantic: string | null,
    weight: number,
    weightDelta: number | null,
    similarity: number,
    source: { missionId?: string, draftId?: string } | null
  }>,
  promptCompact: {
    missionBrief?: string, // 전체 표시
    activeIdea?: unknown,
    citedTexts?: string[],
    citedReferences?: unknown[]
  },
  rawPromptActual?: unknown, // 모델에 보낸 실제 prompt, admin-only 열람
  rawPrompt?: unknown, // sanitize 후 저장한 비교/안전용 copy
  rawPromptSanitization?: {
    removedApiKeys?: number,
    removedAuthTokens?: number,
    removedBase64Images?: number,
    replacedHtmlBlocks?: number,
    replacedFields?: Array<{
      path: string,
      originalLength: number,
      replacement: string,
      reason: string
    }>
  },
  rawResponseMeta?: {
    requestId?: string,
    model?: string,
    error?: unknown,
    usage?: unknown
  }
}
```

#### 구현 메모

- [x] `POST /api/chat`에서 assistant message id 기반 `reviewTurns/{turnId}` 저장 파이프라인 구현
  - 클라이언트가 `/api/chat`에 Firebase ID token과 `review` metadata를 전달한다.
  - 서버는 인증된 사용자에 한해 `sessions/{uid}/missions/{missionId}/reviewTurns/{assistantMessageId}`에 저장한다.
  - 저장 대상: retrieved memory, `promptCompact`, `rawPromptActual`, sanitized `rawPrompt`, `rawPromptSanitization`, `rawResponseMeta`
  - assistant message에는 `reviewTurnId`를 연결 필드로 둔다.
- rawPrompt admin-only debug view는 1차 사용자 리뷰 구현에서 데이터 저장/API 계약까지만 포함하고, 상세 UI는 별도 admin 개선 단계에서 만든다.
  - 이유: 12.1.3의 핵심은 사용자가 세션과 memory 활용을 이해하는 리뷰 화면이며, rawPrompt debug UI까지 같이 만들면 범위가 커진다.
  - 단, 12.1.3 구현 중 admin이 최소 확인할 수 있도록 JSON/debug placeholder 또는 임시 raw fetch 경로를 남길 수 있다.

#### 12.1.3 2단계: 사용자 리뷰 화면 구현

- [x] 완료 미션 카드에 `리뷰` 버튼 추가
- [x] 리뷰 화면/모달 기본 레이아웃 구현
- [x] 채팅 로그를 read-only로 표시
- [x] assistant bubble에 사용된 retrieved memory badge 표시
- [x] memory badge에서 `weight`, `similarity`, source mission/session 표시
- [x] LLM prompt/context 열람 토글 추가
- [x] archived memory가 있으면 archive reason과 duplicate 근거 표시

구현 메모:

- `/lobby` 완료 미션 카드에 `리뷰 보기` 버튼을 추가하고 `/main/{missionId}?review=1`로 진입한다.
- `/admin` 유저/참여자 세션 카드에도 `리뷰` 진입점을 추가하고 `/main/{missionId}?viewAs={uid}&review=1`로 연다.
- `/main/{missionId}?review=1`은 일반 사용자 세션도 읽기 전용으로 열고, 기존 채팅 로그 위에 저장된 `reviewTurns` 데이터를 연결한다.
- assistant bubble은 `reviewTurnId`/message id로 `reviewTurns/{turnId}`를 찾아 retrieved memory, `weight`, `weightDelta`, `similarity`, source mission을 표시한다.
- assistant bubble의 `프롬프트 컨텍스트` 토글에서 retrieval query, 미션 설명 전체, 활성 아이디어, 인용 텍스트/레퍼런스를 확인할 수 있다.
- admin이 리뷰 화면을 열면 assistant bubble의 `Raw prompt 보기` 버튼으로 모델에 보낸 `rawPromptActual`, sanitized copy, sanitize 내역, response meta를 모달에서 확인할 수 있다. 또한 `Retrieval 보기` 버튼으로 `/api/memory/session-summary`가 반환한 turn별 retrieval log(query, retrieved memory, raw JSON)를 확인할 수 있다 `[현행 2026-07-10 → 15.193/15.200]`
- 리뷰 화면은 `/api/memory/archive-status`로 retrieved memory의 최신 archive 상태를 조회하고, archived memory에는 `archiveReason`, `archivedAt`, duplicate similarity/similarTo 근거를 표시한다.

#### 12.1.4 3단계: 세션 전후 메모리 변화 시각화

- [x] memory view와 session view를 분리
  - memory view: 현재 장기 메모리 중심
  - session view: 특정 세션에서 생성/사용/변경된 메모리 중심
- [x] 세션 시작 전 memory snapshot 기준 정의 — 별도 snapshot 저장 불필요. 참고됨(retrieved) = 세션 전 기존 메모리, 기억됨(promoted) = 세션 중 신규 생성으로 암묵적으로 구분됨
- [x] 세션 중 draft memory 표시
- [x] 세션 종료 후 promoted memory 표시
- [x] duplicate archive 결과 표시
- [x] 직접 입력 memory와 interaction memory를 다른 배지/색으로 구분

구현 메모:

- `/api/memory/session-summary`에서 session `memoryDrafts`와 `source.missionId`가 현재 mission인 promoted memory를 조회한다.
- 리뷰 모드에서 우측 패널 상단에 **채팅 / 메모리 변화** 탭 바를 추가한다. 탭 바는 `showReviewAnnotations`(리뷰 모드 또는 admin 뷰어)일 때만 표시된다. `[stale 2026-06-28 → 15.134: 우측 패널 탭은 세션 이전/채팅만 남기고, 메모리 변화 탭 대신 메모리 리뷰하기 CTA가 full-screen overlay를 바로 연다]`
- **메모리 변화 탭** 섹션 구성: `[stale 2026-06-28 → 15.134: 섹션 자체를 제거하고 overlay에서 graph/review를 직접 본다]`
  - `직접 입력한 정보` (보라색 점): `/api/memory/profile`에서 조회한 해당 미션의 profile items
  - `세션 중 참고됨` (파랑 점): `reviewTurns.retrieved` 기반, profile/profile_input 타입은 보라색으로 구분
  - `세션에서 기억됨` (초록 점): promoted memory. archived 항목은 취소선 + 로즈색 표시
  - `검토 중인 초안` (회색 빈 원): drafts 있을 때만 표시
- `/api/memory/profile` GET에 `targetUid` param 추가 — admin이 다른 사용자의 profile 조회 가능
- 중복 memory는 병합하지 않고 forgetting/archive 방식으로 처리한다. 세션 종료 시 중복 후보는 `archiveReason: auto-duplicate`, `duplicateOf`, `duplicate.similarity`를 남기고 soft archive된다.

#### 12.1.5 4단계: 채팅 스트리밍/스크롤 UX 개선

- [x] auto-scroll 제거 — 스크롤 위치를 사용자에게 완전히 위임
- [x] 맨 아래로 ↓ floating 버튼 추가 — 스크롤 100px 이상 올라가면 표시, aside 기준 absolute 포지션
- [x] 긴 markdown/table/code block 렌더링 중 레이아웃 점프 확인
- [x] 채팅 bubble 텍스트 출력 버벅임 원인 분리
  - SSE chunk 빈도
  - React state update 빈도
  - markdown re-render 비용

구현/점검 메모:

- markdown table은 bubble 내부에서 독립 scroll container로 렌더링하고, table wrapper가 채팅 스크롤 위치를 되돌리지 않도록 처리했다.
- 생성 중 강제 auto-scroll을 제거해 사용자가 위로 올린 위치를 유지한다. 버벅임의 주요 원인은 markdown 재렌더와 auto-scroll 호출이 겹치던 흐름으로 정리했다.
- 남은 개선 후보는 SSE chunk batching/markdown memoization이지만, 12.1.5 범위의 사용자 체감 문제는 auto-scroll 제거와 table scroll 고정으로 닫는다.

#### 12.1.6 5단계: 온보딩/직접 입력 메모리 설계

- [x] 모든 세션 시작 시 "나에 대해 알았으면 하는 정보" 입력 UI 추가
- [x] UI 방식 결정 → **3단계 온보딩 페이지** 채택 (modal 방식에서 변경)
- [x] 직접 입력 메모리 타입 정의
- [x] interaction 학습 메모리와 직접 입력 메모리 구분 처리
- [x] 이전 세션 입력 내용을 불러와 수정하는 upsert 방식 구현
- [x] 직접 입력값 retrieval 활용 방식 설계
- [x] revision log 또는 supersedes 정책 결정 — current items + revisions subcollection

#### 결정 사항

- **UI**: 3단계 온보딩 페이지 (옵션 선택 화면과 동일한 full-page 패턴)
  - 1단계: 미션 선택 (기존 옵션 선택 화면, 버튼 "다음"으로 변경)
  - 2단계: 정보 입력 — 이전 입력 pre-fill, 항목 추가(Enter/버튼)/삭제(X)
  - 3단계: 검토 및 세션 시작 — 미션 내용 + 제한 시간 + 입력 정보 확인 후 "세션 시작하기(N분)"
  - 각 단계에서 step indicator + 뒤로가기 버튼 제공
- **컬렉션**: `users/{uid}/profile_memories/{missionId}` 별도 문서, `items[]` 배열로 관리.
- **필수/선택**: 매 세션 필수(건너뛰기 없음). 항목이 0개여도 3단계에서 세션 시작 가능.
- **미션별**: missionId를 문서 ID로 사용하므로 미션마다 독립적인 profile 데이터.
- **weight**: 초기 설계는 고정 weight/항상 주입이었으나, 14.4 이후 profile derived memory도 공통 memory pipeline의 `weight`와 similarity retrieval을 따른다.
- **길이 제한**: 최대 5개, 항목당 240자. 프론트 입력과 서버 저장/retrieval에서 모두 제한한다.
- **revision 정책**: runtime/retrieval은 최신 `items[]`만 사용하되, 변경 흔적은 `users/{uid}/profile_memories/{missionId}/revisions/{revisionId}`에 남긴다.
- **미션별 history**: profile memory는 missionId별 문서와 revision subcollection을 가지므로, 같은 사용자라도 미션마다 현재 profile과 수정 이력이 다를 수 있다.

구현 메모:

- `GET /api/memory/profile?missionId=...` — 해당 미션의 profile items 조회
- `GET /api/memory/profile?missionId=...&includeRevisions=1` — 현재 items와 revision history 조회
- `POST /api/memory/profile` — 현재 items 배열과 raw markdown source를 upsert하고, 이전/다음 source가 다르면 `revisions/{timestamp}`에 `previousItems`, `nextItems`, raw markdown, count, actor/source metadata 저장. 이후 profile derived memory를 `memories_0_1_2`에 생성
- `POST /api/memory/retrieve` — profile derived memory와 interaction memory를 같은 후보군에서 similarity retrieval
- `profileStep: 2 | 3` state로 2단계/3단계 페이지 전환 관리
- 14.4 이후 profile input 원문은 source of truth로 보관하고, runtime에는 LLM이 쪼갠 profile derived memory가 interaction memory와 같은 cosine similarity top-k retrieval을 탄다.

#### 12.1.7 6단계: 직접 입력 메모리 retrieval 정책

- [x] retrieval quota 정책 결정 — 14.4 이후 profile derived memory와 interaction memory를 같은 top-k 후보군으로 통합
- [x] profile memory retrieval을 similarity 기반으로 변경
- [x] retrieval log에 profile derived memory ID/similarity 요약 유지 (`profileItemIds`, `profileSimilarities`)
- [x] prompt에서 직접 입력 메모리도 retrieved memory system message의 `episodic`/`semantic` 그룹으로 통합

구현 메모:

- `/api/memory/retrieve`: `memories_0_1_2`에서 `type: "interaction"`과 `type: "profile"`을 함께 읽음
- profile item 원문은 `profile_memories`에 보관하고, prompt에는 derived memory의 episodic/semantic 텍스트만 들어감
- retrieval log: profile derived memory 기준 `profileItemIds` 배열 유지
- `/api/chat`: `memoryContextItems(...)`가 `memoryContext.episodic`과 `memoryContext.semantic`을 함께 읽고 중복 제거
  - profile derived memory와 interaction items → retrieved memory system message. prompt compact JSON은 `episodic[].episodic`과 `semantic[].semantic` 텍스트만 전달하고, weight/similarity/source 등 metadata는 review/debug 저장에만 유지
  - 같은 memory document에 episodic/semantic이 모두 있으면 prompt에서는 두 배열에 각각 별도 item으로 들어간다. 모델에게는 같은 memory id에서 왔다는 정보는 전달하지 않는다.

#### 12.1.8 7단계: 어드민 정리

- [x] admin memory modal에서 table view 제거
- [x] memory modal을 cluster view 중심으로 재구성
- [x] raw retrieval/forgetting/archive 관측 UI는 별도 debug drawer 후보로 보류
  - 사용자 기본 리뷰 화면과 admin 기본 memory 화면에서는 raw debug 정보를 노출하지 않는다.
  - raw JSON/export와 retrieval/forgetting/archive 원천 데이터/API는 유지하되, 전용 debug drawer는 미팅 이후 UI 개선 단계에서 필요할 때 재검토한다.

#### 12.1.9 8단계: 메모리 셀렉터 모듈화와 전체 UI 개선

- [ ] 공통 `MemoryCard` 컴포넌트
- [ ] 공통 `MemorySelector` 컴포넌트
- [ ] 공통 `RetrievedMemoryBadge` 컴포넌트
- [ ] 공통 `PromptViewer` 컴포넌트
- [ ] 공통 `SessionMemoryDiff` 컴포넌트
- [ ] 사용자 뷰와 admin 뷰의 용어/색상/상태 표시 통일
- [ ] 전체 UI polish

#### 12.1.10 우선순위 제안

1. 리뷰 기능 데이터 계약 정의
2. 완료 미션 카드 리뷰 버튼 + 기본 리뷰 화면
3. 채팅 auto-scroll/버벅임 해결
4. 세션별 메모리 변화 시각화
5. 직접 입력 메모리 타입/저장 방식 설계
6. 직접 입력 메모리 retrieval 정책
7. admin memory debug drawer 분리 여부 결정
8. 메모리 컴포넌트 모듈화와 전체 UI 개선

---

## 13. Decision / Implementation Log — 0604 14:00 실행 계획 `[mostly implemented]`

이 섹션은 0604 논의 기준의 최신 작업 큐다. 우선순위는 **사용자에게 바로 깨져 보이는 디버깅 → 메모리 뷰 정보 구조 정리 → 메모리 시스템 정책 → 프롬프트/에이전트 구조 → 어드민/컴포넌트 정리 → 데이터 생성/배포** 순서로 둔다.

현재 기준은 1-9장에 반영한다. 이 장은 당시 의사결정의 순서와 맥락을 복기하기 위해 남긴다.

### 13.0 세션 플로우 개편 (추가 작업)

- [x] 프레젠테이션 섹션 제거 → 미션 레벨 Final Design 선택으로 대체
  - 구현: 아트보드 썸네일 그리드(scaled iframe), 시안별 그룹핑, Firestore 저장
  - 구현: 최종 디자인 미선택 상태로 세션 종료 시 확인 경고
- [x] 기존 세션 재진입 시 온보딩 화면으로 돌아가는 버그 수정
  - 구현: messages/ideas/artboards 존재 시 profileModalConfirmed = true 처리
- [x] 세션 데이터 로드 전 옵션·프로필 화면 flash 버그 수정
  - 구현: sessionLoaded 플래그로 모든 사전 단계 화면 게이팅
- [x] 세션 종료 완료 모달 UX 정리
  - 구현: 세션 저장 완료 후 모달 하단에 `리뷰 보기` 버튼 표시
  - 구현: `리뷰 보기` 클릭 시 completion modal state를 닫고 `/main/{missionId}?review=1`로 이동
- [x] 디자인 스타일 선작성 edge case 처리
  - 현재 시안 없이 `[CREATE_DESIGN_SPEC]`가 먼저 나오면 빈 시안을 자동 생성하고 해당 시안에 스타일 저장
  - 이후 `[CREATE_NOTE]`가 나오면 새 시안을 만들지 않고 기존 빈 style shell의 description을 채움
  - 같은 응답에서 바로 목업 생성까지 이어질 때도 방금 채운 시안 내용을 사용

### 13.1 디버깅

- [x] 레퍼런스 추천 시 assistant chat bubble에 선택 이유와 간략 설명 포함
  - 현재 문제: 레퍼런스 섹션에는 카드만 추가되고, assistant 답변 안에는 각 레퍼런스를 왜 가져왔는지/어떤 레퍼런스인지 설명이 없음
  - 목표: `[FETCH_REFERENCES: ...]` 이후 검색된 레퍼런스 카드와 함께, chat bubble에도 "왜 이 레퍼런스가 도움이 되는지"를 짧게 설명
  - 확인 대상: references API가 반환하는 title/url/snippet/description/rationale 필드, client가 references fetch 완료 후 assistant message를 보강하는 흐름
  - 구현: references fetch가 새로 추가된 reference 목록을 반환하고, assistant message 말미에 `레퍼런스 선택 이유` 섹션을 자동 추가
  - 구현: chat bubble chip은 실제 검색 완료가 아니라 query/action 생성 완료를 뜻하므로 `레퍼런스 검색 요청됨`으로 표시
- [x] 첫 목업 생성 로딩 화면을 2번째 생성과 동일하게 통일
  - 목표: 첫 생성도 캔버스를 먼저 보여주고, 생성 위치/상태를 같은 방식으로 표시
  - 구현: 생성 시작 시 mockup 탭으로 전환하고, artboard가 아직 없어도 pending skeleton이 있으면 캔버스를 렌더링

### 13.2 메모리 뷰 개선

- [x] 사용자 뷰를 "뭐가 저장됐는지" 중심으로 재구성
  - 중심 정보: episodic/semantic 저장 내용, 직접 입력 profile memory, 세션에서 새로 기억된 항목
  - 구현: 각 assistant 버블에 "기억 보기" 버튼 추가 → 해당 turn의 episodic/semantic을 사이드 패널로 표시
- [x] retrieval 상세는 어드민 뷰에서만 표시
  - 대상: similarity, query, prompt/raw prompt, retrieval log 중심 정보
  - 구현: similarity bar, weight bar, "세션 중 참고됨" 섹션, "참고 메모리 N개" 버튼을 isViewingAsAdmin 전용으로 제한
- [x] 메모리 상세를 modal/blur가 아닌 오른쪽 패널 왼쪽에 붙는 패널 방식으로 변경
  - 목표: 채팅/메모리 흐름을 가리지 않고 옆에서 비교 가능하게 만들기
  - 구현: retrieved 메모리(어드민)와 generated 메모리(기억 보기) 두 종류의 사이드 패널로 분리
- [x] 리뷰 데이터 계약 정리
  - 클라이언트가 `/api/chat`에 Firebase ID token과 `review` metadata(`missionId`, `turnId`, `userMessageId`, retrieval query)를 전달
  - `/api/chat`은 `sessions/{uid}/missions/{missionId}/reviewTurns/{turnId}`에 retrieved memory, `promptCompact`, `promptPlan`, `selectedContextKeys`, sanitized `rawPrompt`, raw response meta를 저장
  - 사용자 리뷰 화면은 compact/retrieved/generated memory 중심으로 표시하고, admin은 raw prompt/debug 정보를 추가로 열람 가능
- [x] 세션 전후 메모리 변화를 node view로 보여줄지 범위 결정
  - 표현 목표: "이전엔 이랬는데 이 세션 이후엔 이렇게 됐다"
  - 1차 결정: 전체 memory snapshot과 별도 diff event 저장은 보류
  - 범위: 세션에서 실제로 referenced/promoted/archived된 memory만 diff 대상으로 제한
  - weight 변화: `memoryRetrievalLogs.scoreDeltas(previousWeight, weight, weightDelta)`에서 파생
  - turn별 설명: `reviewTurns.retrieved`는 사용자에게 어떤 turn에서 어떤 memory가 쓰였는지 보여주는 용도로 사용하고, 세션 전체 weight diff의 source of truth로는 쓰지 않음
  - promoted/archived 변화: 기존 promoted memory와 archive metadata를 사용
  - 구현: `/api/memory/session-summary`가 전체 memory node와 기존 retrieval log 기반 `referenced` diff를 반환
  - UI: 오른쪽 메모리 변화 패널은 요약/진입점만 표시하고, `전체 메모리 변화 보기` 버튼으로 full-screen overlay를 열어 `세션 이전`/`세션 이후` 전체 노드 변화를 비교
  - Overlay: `변화만/전체/참고/기억됨/보관됨` 필터와 선택 노드 상세를 제공. `보관됨`은 이번 세션에서 referenced/promoted된 memory와 관련된 archive만 표시
  - Overlay node detail의 `Keyword` 영역은 memory document의 실제 `keyword`/`keywords` 값만 표시하고, `weight`/`weightDelta`는 별도 metadata/Weight 영역으로 분리한다.
  - Overlay 단위 memory card는 접힌 상태에서 미션 출처, 생성 시간, 한글 source/action 태그, 실제 사용자 입력만 표시한다. `weight`는 선택 상세에서만 표시하고 `referenced`/`promoted` 같은 리뷰 상태 토큰은 행동 태그로 노출하지 않는다.
  - Cluster: 기존 admin memory cluster cache가 있으면 similarity cluster별로 묶어 표시하고, cache가 없으면 Regenerate 안내와 fallback 배치를 표시
  - 재검토 조건: node view에서 정확한 세션 단위 before/after가 제품적으로 중요해질 때만 touched-memory diff event 저장을 검토

### 13.3 메모리 시스템

- [x] 메모리 전체 크기를 weight decay 계산에 반영
  - 목표: memory 수가 많을수록 idle decay 폭을 아주 조금 증가시켜 전체 memory 크기가 무한히 커지지 않게 함
  - 현재 기준: retrieve되지 않은 memory는 retrieval 턴마다 `weight - 0.006`, multiplier 적용 시 최대 `0.012`, floor `0`
  - 구현: candidate memory count별 idle decay multiplier 적용
    - `< 60`: `1.0x`
    - `60~119`: `1.15x`
    - `120~199`: `1.3x`
    - `>= 200`: `1.5x`
  - 최대 decay 상한: `0.006`
  - retrieval log에 `memoryCount`, `idleDecayDeltas`, `idleDecayCount`, idle target별 `decayMultiplier` 저장

### 13.4 프롬프트 최적화

- [x] 프롬프트 2중 구조 설계
  - 1단계: user input 위주 instruction으로 다음 행동/필요 context 판단
  - 2단계: 결정된 행동에 필요한 context만 주입해 실제 응답 생성
  - 방향: plan agent 방식. 불필요한 mission/mockup/memory context를 매번 전부 넣지 않도록 줄임
  - 현재 문제: `/api/chat`는 조건만 맞으면 mission, profile/interaction memory, designSpec, cited text, active idea, mockup HTML, selected element, cited references를 모두 system message로 주입한다. 특히 `mockupHtml` 최대 12000자, activeIdea 3000자, designSpec 2500자가 매 turn 누적되기 쉬움
  - 1차 목표: 응답 품질을 유지하면서 큰 context(`mockupHtml`, `activeIdea`, `designSpec`, `citedReferences`)를 요청 의도에 맞게 선별 주입
  - 비목표: 첫 구현에서 multi-agent orchestration이나 tool execution 순서를 크게 바꾸지 않는다. 기존 action tag(`[GENERATE_MOCKUP]`, `[EDIT_MOCKUP]`, `[FETCH_REFERENCES]` 등)는 유지
  - Planner 입력:
    - latest user input
    - 최근 message 3개 compact
    - 현재 UI 상태 boolean/count: hasActiveIdea, hasMockupHtml, hasSelectedElement, hasDesignSpec, citedReferenceCount, citedTextCount, retrievedMemoryCount
    - retrieved/filter를 통과한 memoryContext 중 semantic memory 최대 10개. 각 항목은 semantic, similarity, signal(high/mid/low)을 포함한다. signal은 현재 실험값 기준 similarity 0.48 이상 high, 0.39 이하 low, 그 사이는 mid다 `[현행 2026-07-13 → 15.206/15.230]`
    - `[stale 2026-07-11 → 15.206: planner 입력의 userClusterSummaries는 제거하고 retrieved semantic memory 직접 입력으로 대체]`
    - mission title + 짧은 mission summary
  - Planner 출력 schema 초안:

```typescript
type ChatPlan = {
  analysis: string; // JSON 출력에서는 맨 위에 두는 선행 판단 메모
  intent:
    | "answer"
    | "create_design_brief"
    | "edit_design_brief"
    | "create_mockup"
    | "edit_mockup"
    | "fetch_references"
    | "create_design_spec"
    | "edit_design_spec";
  confidence: number; // 0~1
  memoryRelevance: "light" | "medium" | "strong";
  needs: {
    mission: boolean;
    activeIdea: boolean;
    designSpec: boolean;
    mockupHtml: boolean;
    selectedElement: boolean;
    citedTexts: boolean;
    citedReferences: boolean;
    conversationHistory: "minimal" | "recent" | "full";
  };
  reason: string; // 내부/admin 저장용. parser가 analysis를 우선 읽고 legacy reason으로 fallback
};
```

- Context selection rule 초안:
  - prompt block 순서는 OpenAI prompt caching을 고려해 상대적으로 고정적인 context를 위에 두고 turn별로 자주 바뀌는 context를 아래로 둔다. 현행 순서: `CHAT_AGENT_BASE_PROMPT` → mission(+target device) → activeIdea → designSpec → compacted mockupHtml → retrievedMemory → citedTexts/citedReferences/selectedElement/referencePreference → mentionedArtifact → requestedCommand → planner intent별 `chatActionInstructionPrompt(...)` → currentRequest → builtMessages `[현행 2026-07-13 → 15.214]`
  - 항상 포함: `CHAT_AGENT_BASE_PROMPT`, planner intent별 `chatActionInstructionPrompt(...)`, current request. target device는 별도 system block이 아니라 mission context 하위 라인으로 주입한다 `[현행 2026-07-13 → 15.214]`
  - mission: 기본 포함하되 brief는 planner가 `mission=true`일 때만 긴 버전 사용. 아니면 title + 1~2줄 summary만 사용
  - profile input: 14.4 이후 `/api/memory/profile`에서 derived memory로 분해되어 interaction memory와 같은 retrieval/context path를 사용
  - memory: retrieved/filter를 통과해 memoryContext에 들어온 memory는 prompt에 주입한다. planner는 주입 여부 bool 대신 `memoryRelevance`로 light/medium/strong 반영 강도를 고르고, `chatRetrievedMemoryPrompt`가 그 강도에 맞는 instruction을 붙인다. before-session/profile과 during-session/interaction을 별도 prompt로 나누지 않는다 `[현행 2026-07-13 → 15.206/15.208]`
  - activeIdea: Design Brief 생성/수정/mockup/design spec 관련 intent에서만 주입. Planner intent는 `create_design_brief`/`edit_design_brief`/`create_mockup` 이름을 쓰지만, 실행 action tag는 기존 계약 때문에 `[CREATE_NOTE]`/`[UPDATE_NOTE]`/`[GENERATE_MOCKUP]`를 유지한다 `[현행 2026-07-13 → 15.87/15.212/15.213]`
  - designSpec: mockup generate/edit, `edit_design_spec`, 기존 style 기반 variant 생성 intent에서 주입
  - mockupHtml: edit/현재 화면 분석 intent에서만 주입. generate intent에서는 사용자가 기존 mockup 기반 변형을 요구한 경우에만 주입. 모델 prompt 주입 전용으로 HTML 주석, script, base64 image data URI, inline SVG 내부, 과도한 공백을 압축한 뒤 12000자로 truncate한다. `/api/stitch` 편집 경로의 원본 HTML은 건드리지 않는다 `[현행 2026-07-13 → 15.214]`
  - selectedElement: selectedElement가 있으면 우선 주입. 선택 요소가 있는 상태의 타깃 편집 요청은 planner가 놓쳐도 `edit_mockup` intent와 `mockupHtml`/`selectedElement` 컨텍스트를 강제한다 `[현행 2026-06-15 → 15.77]`
  - citedTexts/citedReferences: 사용자가 현재 turn에서 인용했거나 planner가 reference/design inspiration intent로 판단한 경우만 주입
- MVP 구현 순서:
  1. [x] planner prompt/function을 `src/lib/prompts.ts`에 추가
  2. [x] `/api/chat`에서 plan 생성 후 `reviewTurns/{turnId}.promptPlan`에 저장
  3. [x] 실제 context pruning은 `mockupHtml`, `activeIdea`, `designSpec`부터 적용
  4. [x] interaction memory selection 적용 `[stale 2026-07-11 → 15.206: interactionMemory bool 제거. retrieved memory는 주입하고 memoryRelevance로 반영 강도만 조절]`
- 실패/불확실성 처리:
  - planner 실패 시 기존 단일 프롬프트 방식으로 fallback
  - `confidence < 0.55`면 큰 context는 유지하되 `mockupHtml`만 selectedElement/edit 요청이 아닐 때 제외
  - admin raw prompt에는 plan, selected context keys, fallback 여부를 함께 저장
- 구현 메모(0602):
  - `/api/chat`에서 compact planner input을 만들고 `gpt-5.4`로 `ChatPlan`을 생성한다.
  - 기존 단일 system prompt는 제거하고, `CHAT_AGENT_BASE_PROMPT` + intent별 `chatActionInstructionPrompt(...)` 조합으로 분리했다.
  - `promptPlan`, `promptPlanFallback`, `selectedContextKeys`를 reviewTurn top-level과 `promptCompact`에 함께 저장한다.
  - pruning은 `activeIdea`, `designSpec`, `mockupHtml`, `citedTexts`, `citedReferences`에 적용한다. `citedTexts`는 사용자가 명시적으로 붙인 경우 planner pruning보다 우선한다. memory 주입 여부 bool pruning은 제거했고, retrieved memory prompt는 `memoryRelevance` 강도 instruction으로 조절한다 `[현행 2026-07-13 → 15.205/15.206/15.208]`
  - retrieved memory는 prompt에 넣기 직전 `episodic[].episodic`과 `semantic[].semantic`으로 재그룹화한다. 검색은 combined embedding 기준으로 유지하되, 모델에게 전달되는 표현은 이전 맥락/결과와 지속적 선호/패턴 텍스트만 남긴다. before-session/profile과 during-session/interaction은 별도 system message로 분리하지 않는다 `[현행 2026-07-13 → 15.208]`
  - 같은 retrieved memory에 episodic/semantic이 모두 있으면 두 그룹에 각각 포함하고, prompt에는 memory id/source 연결 정보를 넣지 않는다.
  - planner 실패 시 기존 방식으로 fallback한다. `confidence < 0.55`면 대부분 context는 유지하되 `mockupHtml`은 selected/edit/current-screen 계열 요청일 때만 포함한다.
  - client assistant bubble의 `참조한 맥락` 요약은 제거했다. 대신 `/api/chat`이 stream 초반에 `[CHAT_PHASE: ...]` 이벤트를 여러 개 보내고, client는 이를 본문에 저장하지 않는 Codex식 단계 로그로 표시한다. 단계 로그는 `처리 과정 N개` disclosure 안에서 Marker-style status row로 렌더한다 `[현행 2026-06-30 → 15.158]`
- [x] 레퍼런스 추천 선호 scope 정리
  - 원칙: 도메인/UX 패턴/시각 스타일은 미션에 귀속되므로 다른 미션의 전역 사용자 취향으로 직접 적용하지 않는다.
  - 구현: client가 현재 mission session의 `references`, `activityLog`, `messages.citedReferences`만 요약해 `/api/references`의 `referencePreferenceContext`로 전달한다.
  - 신호 강도: 인용한 레퍼런스는 strong positive, 현재 남아 있는 레퍼런스는 weak positive, 삭제한 레퍼런스는 negative로 분리한다.
  - `/api/references`는 이 context를 `same_mission_only`로 compact해 query generation/product search/reranking에만 사용한다.
  - 다른 미션으로 넘어갈 수 있는 것은 "실제 제품 사례를 선호한다" 같은 reference consumption behavior뿐이며, 이번 구현에서는 전역 preference memory로 저장하지 않는다.
- [x] memory graph 인터페이스 통일
  - `/agent`와 세션 리뷰의 "메모리 변화 전체 보기"는 공통 `MemoryClusterGraph`를 사용한다.
  - (15.60에서 개편) 세션 리뷰의 "메모리 변화 전체 보기"는 /agent 페이지와 동일한 3패널(클러스터 목록 + 그래프 + 상세 사이드패널) 전체 화면 구조를 사용한다. `세션 이전/세션 이후` phase 토글은 헤더에 유지하고, `변화만/전체/참고/기억됨/보관됨` 필터 버튼은 제거(필터는 "변화만" 고정).
  - saved cluster cache에 없는 신규/미분류 memory는 fallback cluster로 묶어 표시한다.
- [x] 에이전트가 필요한 참조 대상을 스스로 select하도록 설계
  - 후보: memory, cited references, selected element, active idea, mockup HTML, design spec
  - 우선은 설계 문서화 후 route 분리 여부 결정
  - 참조 대상 선택은 planner의 `needs`를 1차 source of truth로 사용
  - route 분리 초안:
    - `buildChatPlan(input): ChatPlan`
    - `buildChatContext(plan, rawContext): systemMessages`
    - `storeReviewTurn(meta)`는 `promptPlan`, `selectedContextKeys`, `rawPrompt`를 함께 저장
  - 1차 implementation은 `/api/chat` 내부 함수로 시작하고, 안정화 후 `src/lib/server/chatPlanning.ts`로 분리

### 13.5 어드민 정리

- [x] memory modal의 table/retrieval/forgetting/archive 탭 노출 제거
- [x] cluster view를 memory modal의 기본/중심 화면으로 고정
- [x] cluster view에서는 version/date/action/semantic filter만 노출하고, table 정렬 컨트롤은 제거
- [x] 참여자 카드 X 삭제 범위를 특정 미션 세션 + `memoryDrafts`/`reviewTurns` 하위 컬렉션까지로 정리
- [x] 사용자 카드 `세션 백업 후 삭제`와 참여자 X 삭제 범위 구분
  - 참여자 X: 현재 미션 session + `memoryDrafts`/`reviewTurns` + participant record만 삭제, 유저 정보/장기 메모리/다른 미션 기록 유지
  - 세션 백업 후 삭제: 전체 sessions/participant records/storage 파일을 백업 후 삭제, 장기 메모리는 유지 `[stale 2026-06-18 → 15.94: 장기 메모리와 memoryClusters/retrieval logs도 백업 후 삭제]`
- [x] `/agent` 메모리 클러스터 뷰 정리
  - agent page를 cluster graph 중심으로 정리하고 cluster list/detail + Included memory items를 표시
  - `react-force-graph-2d`를 client-only dynamic import로 바꿔 Vercel prerender의 `window is not defined` 오류 해결
  - `/api/memory/all`이 episodic-only가 아니라 semantic/input/output/keywords 기반 memory도 반환하도록 수정해 cluster item 매칭 보정
  - action badge는 admin과 동일하게 raw action id(`note_update`, `agent_response` 등)를 유지
- [x] raw retrieval/forgetting/archive 관측 UI는 별도 debug drawer 후보로 보류
  - 사용자 기본 리뷰 화면과 admin 기본 memory 화면에서는 raw debug 정보를 노출하지 않음
  - retrieval/forgetting/archive 원천 데이터/API는 유지
  - 전용 debug drawer는 오늘 미팅 이후 컴포넌트 모듈화/UI 개선 단계에서 필요할 때 재검토

### 13.6 컴포넌트 모듈화 + UI

- 미팅 이후 진행 예정. 지금까지 만든 memory/review/admin UI를 바로 확장하기보다 공통 컴포넌트로 정리한 뒤 전체 UI를 갈아엎는 방향.
- [ ] 공통 `MemoryCard`
- [ ] 공통 `MemorySelector`
- [ ] 공통 `RetrievedMemoryBadge`
- [ ] 공통 `PromptViewer`
- [ ] 공통 `SessionMemoryDiff`
- [ ] 전체 UI 개선

### 13.7 온보딩

- [x] 3단계 세션 시작 온보딩 및 profile memory 저장 구조
  - 옵션 선택 → 사용자 정보 입력 → 입력 내용 확인 후 세션 시작
  - profile memory는 `users/{uid}/profile_memories/{missionId}`에 mission별 current items로 저장
  - 수정 이력은 `revisions/{revisionId}`에 `previousItems`, `nextItems`, actor/source metadata로 저장
- [x] 온보딩 입력값 retrieval 활용 방식 변경
  - 구현: 14.4 이후 `/api/memory/profile`에서 profile input을 derived memory로 분해하고, `/api/memory/retrieve`에서 interaction memory와 함께 similarity ranking
  - retrieval log에 `profileCandidateCount`, `profileItemCount`, `profileItemIds`, `profileSimilarities` 저장
  - [x] profile input 직접 주입/별도 weight 제거 설계는 14.4에서 공통 memory pipeline 방식으로 대체

### 13.8 데이터 생성/배포

- [x] Claude API 스위칭 연결
  - `/api/chat` 최종 assistant response streaming만 OpenAI/Anthropic provider switch 대상
  - Admin UI의 메인 채팅 헤더 `LLM` selector에서 turn별 OpenAI/Claude override 가능
  - planner, embedding, memory retrieval/encoding, clustering label은 기존 OpenAI 경로 유지
  - 기본 Claude model은 `claude-sonnet-4-6`, API version은 `2023-06-01`
- [x] Vercel/Firebase 배포 대응
  - Firebase client config가 `NEXT_PUBLIC_FIREBASE_*`를 우선 읽고 기존 `FIREBASE_*`를 fallback으로 읽도록 수정
  - Vercel 서버에서는 `vibedesignagent-key.json` 파일 대신 `FIREBASE_SERVICE_ACCOUNT_KEY` env로 Firestore Admin REST 인증
  - Firebase Authorized domains와 Vercel env/redeploy 필요 사항 확인
- [x] Deploy
- [ ] 실제 데이터 최대한 많이 만들기
  - 이미 배포된 서버에서 미팅 이후 다양한 미션/세션/레퍼런스/목업/메모리 케이스를 많이 생성해 UI와 memory 정책을 점검

### 13.9 다음 작업 순서

1. ~~레퍼런스 추천 후 assistant chat bubble에 선택 이유와 간략 설명을 포함~~ ✅
2. ~~첫 목업 생성 로딩 UX를 2번째 생성과 통일~~ ✅
3. ~~사용자 메모리 뷰를 저장 내용 중심으로 재구성~~ ✅
4. ~~retrieval/debug 정보는 admin-only로 분리~~ ✅
5. ~~profile input retrieval 정책 재설계: embedding top-k 선별/weight 제거~~ ✅
6. ~~memory count 기반 near-miss decay multiplier 설계 및 적용~~ ✅
7. ~~Deploy~~ ✅
8. 미팅 이후 실제 데이터 최대한 많이 생성
9. 공통 memory UI 컴포넌트 추출
10. 전체 UI 개선

## 14. Decision / Implementation Log — 0604 TODO / 설계 확인 `[implemented]`

### 14.1 세션 종료 버튼 상태 버그

- [x] 저장하지 않았거나 session timeout이 발생한 뒤, 세션 종료 버튼이 "세션 시작 전" 상태로 표시되는 이슈 수정
  - 기대 동작: 실제 세션/미션 데이터가 이미 생성되어 있으면 저장 여부와 무관하게 세션 종료/리뷰 플로우가 현재 상태를 정확히 반영
  - 범위: 버튼 label/state만 고치지 않고, 세션 자동 복구/자동 저장 플로우까지 함께 점검
  - 방향: local/client state가 날아가도 서버에 남은 session/mission/reviewTurns/drafts 기준으로 현재 세션 상태를 복구할 수 있게 함
  - 구현: session load에서 legacy `startedAt`과 신규 `timerStartedAt`을 모두 읽고, 세션 저장 시 두 필드를 함께 저장
  - 구현: 세션 시작 시 debounce를 기다리지 않고 즉시 snapshot 저장, visibility hidden/세션 종료 직전에도 pending snapshot flush
  - 구현: 종료 버튼 활성 상태는 timer뿐 아니라 messages/ideas/artboards/references/activityLog 같은 복구 가능한 세션 데이터도 함께 기준으로 판단

### 14.2 Retrieved memory 표현 정리

- [x] "Earlier episodic"과 "previous" 표현 병합
  - 문제: 둘 다 사실상 이전 상호작용/이전 에피소드를 뜻하는데 UI/prompt에서 다른 개념처럼 보임
  - 방향: 사용자에게 보이는 label과 prompt context label을 `previous`로 통일
  - 결정: `previous episodic memory`가 이전 turn 요약 역할을 하므로 `previous agent output`은 memory encoding prompt와 신규 저장 metadata에서 제거
  - 추가 결정: chat prompt에 들어가는 retrieved memory는 `previous`가 아니라 `episodic`/`semantic` 두 배열로 전달
  - 추가 결정: 같은 memory document의 episodic/semantic도 prompt에서는 별도 item으로 분리하고, memory id/weight/similarity/source는 제외
  - 기대 효과: episodic/semantic 분류와 시간 표현이 섞여 보이지 않게 함

### 14.3 스타일/노트 생성 출력 길이 줄이기

- [x] 디자인 스타일 생성 prompt를 더 짧고 알짜 중심으로 조정
  - 스타일은 메인 컬러, 브랜드 톤, 타이포그래피를 항상 항목별로 길게 쓰지 않음
  - 현재 미션과 실제 시안 작성에 필요한 방향만 남김
  - 목표: mockup 생성/수정에 바로 쓸 수 있는 짧은 design direction
  - 길이 기준: 고정 문장 수보다 미션 복잡도에 맞춰 조절. 단순한 시안은 2~4문장, 복잡한 제품/플로우는 핵심 section/interaction 중심으로만 확장
- [x] 노트 생성 prompt도 짧게 조정
  - 긴 기획서가 아니라 현재 미션에 맞는 핵심 아이디어/화면 방향만 남김
  - 길이 기준: 현재 미션을 진행하는 데 필요한 핵심만 남기고, 불필요한 배경 설명/목록형 장식은 제거

### 14.4 Profile memory와 semantic/episodic 통합 설계

- [x] profile input과 interaction memory를 같은 memory pipeline으로 합칠지 설계
  - 현재: profile은 `profile_memories`에 별도 저장되고, interaction memory는 `memory` 문서에 episodic/semantic/keyword/action/input/output/link/weight를 저장
  - 목표: profile도 유저 입력을 바탕으로 `keyword`, `episodic`, `semantic` 단위로 쪼개고 embedding/retrieval/clustering에서 함께 다룸
  - 구분 필드 추가: vectorized memory가 profile 기반인지 interaction 기반인지 구분할 수 있는 `sourceType` 또는 `memorySource` 필요
  - profile memory의 clustering input:
    - 포함: `keyword`, `episodic`, `semantic`, 원본 사용자 입력
    - 제외: 생성/수정 시간. 시간 정보는 context extraction에는 쓰되 vector similarity에는 섞지 않음
    - 비움: `agent response`, `action category`
  - 결정: 안전한 방식으로 진행. 기존 `profile_memories/{missionId}`는 source of truth로 유지하고, 여기서 쪼갠 derived memory만 공통 memory pipeline에 넣음
  - 기존 profile 데이터는 삭제 후 새 구조로 시작해도 무방하나, 구현은 destructive migration 없이 새 구조를 지원하는 방향 우선
  - 1차 구현 단계:
    1. [x] `/api/memory/profile` POST에서 markdown/freeform 원문을 revision/source로 보관
    2. [x] profile item별 derived memory를 `keyword`, `episodic`, `semantic` 구조로 생성
    3. [x] derived memory에는 `sourceType: "profile"`/`memorySource: "profile"`을 저장하고, interaction memory에는 `sourceType: "interaction"`을 보강
    4. [x] retrieval input은 profile derived memory도 같은 embedding text builder를 사용하되 `agent response`, `action category`는 빈 값으로 둠
    5. [x] runtime prompt에서는 profile derived memory를 retrieved evidence로 쓰되, 사용자 원문 markdown은 source/revision으로만 유지
  - 구현: `/api/memory/profile`가 raw markdown/source를 저장하고, LLM으로 profile 내용을 0~8개 derived memory로 분해해 `users/{uid}/memories_0_1_2`에 저장
  - 구현: `/api/memory/retrieve`는 `type: "interaction"`과 `type: "profile"` memory를 함께 후보로 읽고 cosine similarity/weight 업데이트를 같은 방식으로 적용
  - 구현: 기존 profile item 직접 주입(`profile_input`)은 제거하고, profile derived memory가 retrieval된 경우 일반 memory처럼 prompt의 `episodic`/`semantic` 텍스트 그룹에 들어감

### 14.5 프로필 메모리 자유 입력 → 단위 분해

- [x] 사용자가 profile memory를 markdown으로 자유롭게 입력하면 시스템이 중요한 정보 단위로 쪼개 저장
  - LLM이 markdown 원문에서 중요한 정보 단위를 추출
  - 각 단위는 `keyword`, `episodic`, `semantic` 구조로 변환
  - 결정: 원문 markdown은 revision/source of truth로 계속 보관
  - runtime/retrieval/clustering에는 LLM이 쪼갠 structured item을 사용
  - 구현: 현재 client는 기존 item UI를 유지하되 저장 시 item 목록을 markdown bullet source로 함께 전송한다. 백엔드는 `rawMarkdown`/`markdown` 입력도 받을 수 있어 추후 UI를 자유 markdown textarea로 교체 가능

### 14.6 레퍼런스 선호 scope 재검토

- [x] 레퍼런스는 "미션에 속하는지 아닌지"를 시스템이 과하게 판단하지 않고 모두 기록하는 방향 검토
  - 현재 구현: 같은 미션 안의 cited/kept/deleted reference만 `same_mission_only` context로 `/api/references` query generation/product search/reranking에 사용
  - 제안 방향: 레퍼런스 상호작용은 모두 memory로 기록하고, retrieval 결과가 자연스럽게 다른 미션에도 영향을 주게 함
  - 주의: 도메인/UX 패턴/시각 스타일이 다른 미션에 과도하게 전이될 수 있으므로, reference memory에는 scope/category/strength 필드가 필요
  - 후보 분류:
    - `reference_consumption_behavior`: 실제 제품 사례 선호, 공식 사이트/케이스스터디 선호 등. 다른 미션 전이 가능
    - `mission_reference_signal`: 특정 도메인/패턴/스타일 선호. 기본은 retrieval similarity에 맡기되 prompt에서 강한 전역 선호로 단정하지 않음
    - `negative_reference_signal`: 삭제/거절한 레퍼런스. 유사도와 현재 미션 relevance가 높을 때만 약하게 회피
  - 결정: consumption behavior만 전역화하고, 삭제/거절 negative는 기본적으로 같은 미션 negative로 둠
  - 구현 방향: 레퍼런스 상호작용은 memory로 기록하되, prompt에서는 "사용자의 전역 취향"으로 단정하지 않고 retrieved evidence로만 약하게 사용
  - 구현: reference delete처럼 독립 UI 행동인 interaction은 memory draft 경로를 통해 `reference_delete` action으로 인코딩한다. reference cite와 reference fetch 결과/rationale은 별도 orphan draft가 아니라 해당 chat turn의 input/output context에 합쳐 인코딩한다
  - 구현: `/api/references`는 `description`(무엇인지)과 `rationale`(왜 이 미션에 골랐는지)을 reference별로 분리해 반환
  - 구현: reference card metadata(title/tag/url/mode/provider/description)에 더해 chat bubble의 `레퍼런스 선택 이유`에 쓰는 `rationale` 텍스트를 memory draft에 함께 넣어 source type/UX pattern/style signal 판단 근거로 사용
  - 구현: `MEMORY_ENCODE_PROMPT`에 reference handling scope 규칙을 추가해 official product/case-study 선호 같은 consumption behavior만 durable하게 보고, 도메인/UX 패턴/시각 스타일/삭제 negative는 현재 미션 evidence로 우선 해석하게 함
  - 구현: profile derived memory와 interaction memory가 같은 retrieval pipeline을 타므로, reference interaction memory도 다른 미션에서 similarity가 충분할 때 retrieved evidence로 약하게 활용됨

### 14.7 Memory timestamp 정책

- [x] timestamp는 context extraction에는 포함하고, vectorization에는 포함하지 않도록 정리
  - 목표: LLM이 "이전/최근/세션 흐름"을 해석할 때는 timestamp를 참고할 수 있게 하되, embedding similarity가 날짜/시간 문자열에 끌려가지 않게 함
  - 적용 범위:
    - memory draft encoding prompt: 현재 interaction timestamp와 직전 draft timestamp를 context로 제공
    - interaction/profile memory embedding text: `keyword`, `episodic`, `semantic`, input/output/action/link 등 의미 정보만 사용하고 timestamp/createdAt/updatedAt은 제외
    - clustering embedding text: similarity 묶음은 의미 기반으로 유지하고 timestamp는 lab
      el/debug metadata로만 사용
  - 저장 정책: memory document에는 `timestamp`, `createdAt`, `updatedAt` metadata를 계속 저장하되 `embeddingSource`는 timestamp 제외 source임을 명확히 표시
  - 구현: memory draft encoding prompt에 current/previous interaction timestamp를 제공하고, `MEMORY_ENCODE_PROMPT`에는 timestamp를 순서/최근성 판단에만 쓰도록 명시
  - 구현: interaction embedding source는 `interaction_record_text`, profile embedding source는 `profile_unit_text`를 사용. 기존 `combined`/`combined_no_timestamp` embedding은 retrieval 호환용으로 허용

### 14.8 세션 시작 버튼 로딩 UX

- [x] profile memory 처리 중 세션 시작 버튼에 로딩 피드백 추가
  - 배경: 세션 시작 클릭 시 `POST /api/memory/profile` → LLM 가공 + vector embedding 생성까지 await하므로 수초 대기 발생
  - 구현: `profileSaving` 상태에서 버튼 텍스트를 "세션 시작하기" → "세션 준비 중…"으로 변경하고 spinner 아이콘 표시
  - 버튼은 처리 완료 후 세션이 시작되므로, 이 로딩이 끝나면 profile memory는 즉시 retrieve 가능 상태

### 14.9 세션 시작 전 profile 입력 UI 개선

- [x] 에이전트가 알아야 할 것들 입력 방식을 리스트 추가 → 자유 입력 textarea로 변경
  - 배경: 기존 UI는 유저가 항목을 하나씩 추가(최대 5개)해야 했으나, 줄글로 자유롭게 쓴 뒤 LLM이 분리하는 방식이 더 자연스러움
  - 구현: `profileItems` / `profileInput` state 제거 → `profileRawMarkdown` (string) 하나로 대체
  - 구현: textarea 입력 → `POST /api/memory/profile`에 `rawMarkdown` 그대로 전송 → 기존 `deriveProfileMemories` LLM 분리 로직 그대로 활용
  - 구현: step 2(정보 입력), step 3(세션 시작 확인) 모두 "입력한 정보 → 미션" 순서로 카드 순서 통일

### 14.10 [CREATE_NOTE:] plain text 파싱 및 실패 칩 UI

- [x] `[CREATE_NOTE:]` 블록이 JSON이 아닌 plain text 형식으로 왔을 때 파싱 실패 버그 수정
  - 배경: LLM이 `[CREATE_NOTE: Title: ...\n...\n]` 형식(JSON 없이)으로 응답하면 `extractJsonActionPayload`가 `{`를 찾지 못해 null 반환 → `turnIdeaOverride`가 null → `[GENERATE_MOCKUP]` 실행 시 아이디어 없음 오류 발생
  - 구현: `extractPlainNoteContent` 함수 추가. JSON payload가 없으면 bracket 전체 내용을 description으로 사용
  - 구현: `BLOCK_RULES`의 CREATE_NOTE, UPDATE_NOTE `complete` 정규식을 JSON 포맷 외 plain text(`\n]`로 끝나는 형식)도 인식하도록 확장
- [x] 노트 작성 실패 시 chat 칩 UI 피드백 추가
  - 구현: `ContentChip`에 `failed?: boolean` 추가
  - 구현: `processMessageContent`에서 `⚠️ 노트를 먼저 저장해야` 메시지가 content에 포함되면 CREATE_NOTE 칩을 실패 상태로 마킹
  - 구현: 실패 칩은 빨간 점(`bg-rose-400`) + "노트 작성 실패" 라벨 표시

### 14.11 Chat 프롬프트 구조 개선

- [x] 현재 유저 요청 중복 제거
  - 배경: `chatCurrentRequestPrompt`가 `latestUserText`를 system 메시지에 삽입하고, 동일 텍스트가 `builtMessages`의 마지막 user 메시지에도 포함되어 LLM이 같은 요청을 두 번 읽는 구조였음
  - 구현: `chatCurrentRequestPrompt`에서 `latestUserText` 파라미터 제거. "The most recent user message is the current request and has the highest priority." framing만 system 메시지로 유지
- [x] `### 레퍼런스 선택 이유` 섹션 과도한 압축 완화
  - 배경: `cleanMessageContentForModel`이 해당 섹션을 단 한 줄로 완전히 대체하여 에이전트가 이전 턴에서 논의한 구조 추천·레퍼런스 분석 내용이 모두 소멸
  - 구현: 600자 이내면 그대로 보존, 초과 시 앞 600자 + `[이하 reference preference context로 압축됨]` 마커로 표시
- [x] reference preference context를 chat 모델에 실제 전달
  - 배경: assistant 메시지에서 "별도 reference preference context에 압축되어 전달됨"이라고 했으나 `/api/chat`에는 해당 context가 전달되지 않았음
  - 구현: `page.tsx`에서 `/api/chat` 호출 시 `referencePreferenceContext` 함께 전송
  - 구현: `chat/route.ts`에서 수신 후 `chatReferencePreferencePrompt`로 시스템 메시지 생성하여 주입 (cited/kept/deleted signal 포함)
- [x] chat phase log 보존 및 toggle 표시
  - 배경: `[CHAT_PHASE: ...]` 로그가 스트리밍 중에만 보이고 완료 후 사라져, 리뷰/복기 시 어떤 context를 읽었는지 확인하기 어려웠음
  - 구현: assistant message에 `chatPhases` 배열을 저장하고, chat bubble 안에서 `처리 과정 N개` toggle로 접고 펼칠 수 있게 표시 `[updated 2026-06-30 → 15.158: 단계 항목 렌더링을 Marker-style status row로 변경]`
- [x] note 작성과 디자인 스타일 규칙 분리 강화
  - 배경: 시안 note 작성 중 `Visual Style Notes` 같은 색/타이포/무드 정보가 note description에 섞이는 케이스가 있었음
  - 구현: `CHAT_NOTE_ACTION_PROMPT` 안에 visual style section 금지 규칙과 `[CREATE_DESIGN_SPEC: {"content":"..."}]` 분리 규칙을 명시
  - 원칙: full `CHAT_DESIGN_SPEC_ACTION_PROMPT`와 `Reading design style rules...` phase는 planner intent가 `create_design_spec`일 때만 사용한다. note/update intent에서 디자인 스타일 prompt를 읽었다고 표시하지 않는다
  - 구현: planner prompt와 `forceIntentFromUserText()`를 강화해 색/컬러/타이포/폰트/무드/톤/UI style/brand tone/avoid-list/visual style notes/레퍼런스 섹션 삽입용 스타일 정리 요청은 `create_design_spec`로 강제

### 14.12 리뷰 타임라인의 UI event memory 표시

- [x] chat bubble에 연결되지 않은 memory-generating UI event를 리뷰 타임라인에 표시
  - 배경: `reference_delete`, `note_delete`, `mockup_delete`, `final_design_select` 등은 `/api/memory/drafts`를 통해 episodic/semantic memory를 만들지만, 현재 `기억 보기` 버튼은 assistant chat bubble 기준으로만 노출된다.
  - 원칙: 사용자가 레퍼런스를 인용하고 텍스트 요청을 함께 보낸 경우(`reference_cite`)는 별도 UI event가 아니라 해당 chat interaction의 입력 맥락으로 본다. `[FETCH_REFERENCES]` 결과와 rationale도 별도 event가 아니라 해당 assistant turn의 결과 맥락으로 합친다.
  - 문제: 레퍼런스 삭제/시안 삭제/목업 삭제/최종 디자인 선택처럼 독립적인 UI 행동의 기억이 생성되어도, 해당 행동 옆에서 바로 검토하기 어렵다. 세션 메모리 변화 패널에는 섞여 보일 수 있지만 시간순 interaction 복기에는 약하다.
  - 결정: 리뷰 모드의 right panel을 단순 chat log가 아니라 `messages + orphan memory event` 타임라인으로 확장한다.
  - 표시 기준: `sessionMemorySummary.drafts`와 `sessionMemorySummary.promoted` 중 message id 또는 assistant `reviewTurnId`와 연결되지 않은 draft/promoted memory를 orphan memory event로 간주한다.
  - UI: chat bubble 사이에 작은 event card를 시간순으로 삽입하고, card 아래에 `기억 보기` 버튼을 제공한다.
  - 시간순 규칙: message `createdAt`과 memory event `timestamp/promotedAt`을 기준으로 하나의 timeline을 만든다. 예를 들어 사용자가 채팅으로 레퍼런스를 받은 뒤 reference card를 삭제하면, 삭제 event card는 해당 chat turn 뒤와 다음 chat turn 사이에 표시된다.
  - 일반 작업 중에는 `activityLog` 기반 optimistic event card를 즉시 표시한다. 리뷰/관리자 관측 모드에서는 저장된 memory draft/promoted memory 기반 event card를 사용해 `기억 보기`를 제공한다.
  - event card label은 `agentActionCategory`/draft id prefix 기반으로 `레퍼런스 삭제`, `시안 삭제`, `목업 삭제`, `최종 디자인 선택` 등으로 매핑한다. `reference_cite`/`references_fetch`는 chat turn memory에 합치고 orphan event card에서는 제외한다.
- [x] 해당 세션에 일어난 UI event가 아닌 것들도 뜨는 문제 수정
  - 원인 1 (세션 전환 stale state): `sessionMemorySummary` fetch가 비동기로 이루어지는 동안, `targetSessionUserId` 또는 `missionId`가 바뀌면 기존 세션의 `sessionMemorySummary`가 즉시 초기화되지 않아 새 세션의 `messages`와 이전 세션의 memory events가 혼재되었다. 특히 admin이 `viewAs`를 전환할 때 발생.
  - 수정 1: `summaryKey`가 변경되면 fetch 시작 전에 즉시 `setSessionMemorySummary(EMPTY_SESSION_MEMORY_SUMMARY)`로 초기화하고, `sessionMemorySummaryKeyRef.current = summaryKey`를 fetch 완료 전에 세팅해 중복 fetch도 방지.
  - 원인 2 (데이터 레벨 오염): `session-summary` API의 `promoted` 배열은 `memories_0_1_2`와 `memories_0_1_1`(레거시)를 모두 포함하며, `source.missionId === missionId`만으로 필터링한다. 레거시 컬렉션이나 과거 버그로 인해 `source.missionId`가 잘못 설정된 메모리가 섞일 수 있다.
  - 수정 2: `promoted` 필터에 세션의 실제 `memoryDrafts` subcollection과 교차 검증 추가. `source.draftId`가 있는 메모리는 반드시 현재 세션의 `draftIdSet`에 포함되어야 한다. `source.draftId`가 없는 메모리(레거시)는 통과.

## 15. Decision / Implementation Plan — 전체 UX/UI 개선 `[implemented 2026-06-12 — 잔여 항목은 후속 과제로 보류]`

> **마무리 요약 (2026-06-12)**: 토큰/primitive/product 컴포넌트 체계, 전 route 재설계 1차, micro-interaction/접근성 pass, desktop-only min-width lock(1024px)까지 완료. lint/build 통과, dev server 시각 검증 완료.
> **후속 과제로 보류**: ① /main(약 6,500줄)·/admin(약 2,400줄) 추가 분해, ② route별 screenshot 기록, ③ concentric radius·색 대비·상태 8종 시각 점검, ④ custom overlay(PromptViewer/SessionMemoryDiff) focus trap.

### 15.1 목표

- 로그인 → 온보딩 → 로비 → 미션 세션 → 에이전트 메모리 → 어드민까지 하나의 제품처럼 느껴지도록 UX/UI를 정리한다.
- 단순한 시각 리스킨이 아니라 정보 구조, 상태 표현, 공통 컴포넌트, 접근성, 반응형 동작, micro-interaction을 함께 개선한다.
- 연구 도구 성격을 유지한다. SaaS/작업도구형 UI처럼 조용하고 밀도 있게 구성하되, 디자인 세션과 목업 캔버스는 창의적 작업 흐름이 잘 드러나게 한다.

### 15.2 도구 선택

- **주 도구**: `shadcn/ui`
  - 이유: Next.js + React + Tailwind 기반 프로젝트와 잘 맞고, 컴포넌트 소스가 프로젝트 안으로 들어와 커스터마이즈/소유가 가능하다.
  - 역할: Button, Input, Textarea, Dialog, Sheet, Tabs, Select, Dropdown Menu, Tooltip, Badge, Card, Skeleton, Table, Scroll Area, Separator, Toast/Sonner 등 공통 UI의 기준점.
- **보조 지침**: `jakubkrehel/make-interfaces-feel-better`
  - 이유: radius, shadow, text wrapping, hover/press state, tabular numbers, icon animation, loading/exit animation 등 UI polish 기준이 구체적이다.
  - 역할: 컴포넌트와 화면 구현 후 마감 체크리스트로 사용.
- **참고/확장**: `emilkowalski/skill`
  - 이유: 디자인 엔지니어링 철학과 상호작용 품질을 점검하는 보조 기준으로 유용하다.
  - 역할: 주요 화면 재설계 리뷰, 컴포넌트 품질 리뷰, 애니메이션/상태 표현 리뷰.
- **비주 도구**: `anthropics/skills`
  - 이유: 특정 UI 개선 도구라기보다 Agent Skill 예시/표준 저장소에 가깝다.
  - 역할: 추후 VibeDesignAgent 전용 `UX/UI skill`을 만들 때 참고.

### 15.3 구현 전 필수 확인

- 이 프로젝트는 `Next.js 16.2.2`, `React 19.2.4`, `Tailwind CSS v4`를 사용한다.
- 코드 작성 전 `AGENTS.md` 규칙에 따라 `node_modules/next/dist/docs/`에서 관련 Next 16 문서를 확인한다.
  - App Router routing/layout 관련 변경
  - Client/Server Component 경계
  - CSS/Tailwind 관련 가이드
  - Metadata/Image/Link/navigation 관련 deprecation
- shadcn CLI 또는 registry 도입 전에 Tailwind v4, React 19, Next 16 호환 방식을 확인한다.
- 네트워크로 패키지를 설치해야 하는 작업은 별도 승인 후 진행한다.

### 15.4 현재 UI 문제 가설

- 로그인/온보딩은 dark glass card 스타일이고, 로비/세션/어드민은 light dashboard 스타일이라 제품 톤이 분리되어 보인다.
- 버튼, 카드, 배지, 탭, 패널, 로딩, 빈 상태가 화면마다 다른 radius/spacing/shadow 규칙을 사용한다.
- 로비는 미션 진행 상태를 보여주지만 다음 행동 우선순위가 약하다.
- 메인 세션은 Mission/Reference/Idea/Mockup/Chat/Memory review가 한 파일에 밀집되어 있어 정보 구조와 컴포넌트 경계가 흐릴 가능성이 높다.
- 어드민은 기능 밀도가 높아 table, filter, modal/sheet, detail panel, debug view의 위계가 더 필요하다.
- mobile viewport에서 작업도구형 화면의 패널 전환, sticky 영역, 긴 텍스트 overflow를 별도로 검증해야 한다.

### 15.5 화면별 UX Audit 체크리스트

#### `/` 로그인

- [x] 첫 화면에서 서비스 정체성과 사용자의 다음 행동이 즉시 보이는지 확인
- [x] Google 로그인 버튼의 loading/disabled/error 상태 정리
- [x] 실패 메시지가 alert role, 색 대비, 재시도 안내를 충족하는지 확인
- [x] dark/light 톤을 전체 제품 토큰과 맞출지 결정

#### `/onboarding`

- [x] 온보딩 설명이 실제 세션 흐름과 일치하는지 확인
- [x] 완료 상태, 저장 중, 실패 상태를 컴포넌트화
- [x] 리스트형 안내를 단계형 progress/stepper로 바꿀지 검토
- [x] 완료 후 로비로 돌아가는 흐름과 "다시 보기" 맥락 분리

#### `/lobby`

- [x] 온보딩 필수 상태와 일반 미션 접근 잠금 상태를 더 명확하게 표현
- [x] 미션 카드의 primary action, review action, status badge 위계 정리
- [x] 관리자/에이전트 메모리 진입점을 topbar 또는 action rail로 재배치할지 검토
- [x] empty/loading/error 상태 추가
- [x] 미션 수, 진행중/완료/대기 미션 요약을 dashboard summary로 제공할지 검토

#### `/main/[missionId]`

- [ ] 좌측 Mission/Reference/Idea/Mockup과 우측 Chat의 정보 위계 재정의 `[deferred: large route redesign]`
- [ ] 세션 시작 전, 진행 중, 종료/리뷰 모드의 layout state를 명시 `[deferred: large route redesign]`
- [ ] Reference card, Idea editor, Mockup canvas, Chat bubble, Memory event card를 공통 컴포넌트로 분리 `[partially implemented: ToolActionChip, MemoryScoreBar extracted]`
- [ ] 목업 캔버스의 zoom/pan/fit/fullscreen controls를 icon button + tooltip 기준으로 정리
- [ ] Chat streaming, tool action chip, web searched badge, memory toggle의 visual language 통일 `[partially implemented: ToolActionChip을 Marker-style clickable row로 정리 2026-06-30 → 15.163]`
- [ ] 세션 종료/최종 디자인 선택 흐름의 confirm/warning state 개선
- [~] 모바일에서는 panel tabs 또는 sheet 기반 전환으로 재설계 `[취소됨: 모바일 화면을 별도로 만들지 않기로 결정. 대신 desktop-only 고정 레이아웃(min-width lock) 적용 — globals.css body min-width: 1024px + layout.tsx viewport.width: 1024]`

#### `/agent`

- [x] 사용자용 메모리 뷰와 admin/debug 뷰의 정보 수준을 분리
- [x] cluster list/detail/graph의 선택 상태와 empty state 정리
- [x] graph를 embedding 2D map + cluster color/area 방식으로 변경
- [x] graph zoom/pan/fit control 추가
- [x] graph node 선택과 오른쪽 detail panel memory row 확장 동기화
- [x] cluster cache signature mismatch로 stale 안내가 반복되는 문제 수정
- [x] "재생성" action의 로딩/성공/실패 피드백 강화
- [ ] graph loading/nonblank/resize 상태를 실제 screenshot으로 확인 `[blocked: existing Next dev lock/PID]`

#### `/admin`

- [ ] 미션 CRUD, 참여자, 세션, 메모리, retrieval/forgetting debug를 task group별로 재구성 `[deferred]`
- [ ] 고밀도 table + detail sheet 패턴 도입 `[deferred]`
- [x] destructive action은 Alert Dialog와 명확한 scope text 사용
- [ ] admin-only debug 정보는 기본 화면에서 숨기고 필요 시 drawer/sheet로 노출 `[deferred]`
- [ ] 긴 메모리/프롬프트/raw JSON은 code viewer 또는 collapsible 영역으로 분리 `[deferred]`

### 15.6 디자인 토큰 계획

- 토큰은 `src/app/globals.css`의 CSS variable과 Tailwind v4 `@theme inline`을 기준으로 관리한다.
- 1차 토큰:
  - color: background, foreground, muted, border, input, ring, primary, secondary, accent, destructive, success, warning
  - surface: page, panel, elevated, overlay
  - radius: xs, sm, md, lg, xl. 기본 card radius는 8px 이하를 우선하되 기존 shadcn preset과 충돌 시 프로젝트 기준을 명시
  - shadow: none, sm, popover, dialog. border만으로 분리하기 어려운 floating UI에 제한적으로 사용
  - typography: page title, section title, panel title, body, caption, mono/debug
  - spacing: page padding, section gap, panel padding, control height
  - focus ring: keyboard focus가 명확하게 보이는 단일 규칙
- 색상 방향:
  - 단일 hue에 과도하게 의존하지 않는다.
  - 현재 slate 중심 UI를 유지하되 action/success/warning/destructive를 명확히 분리한다.
  - 교육/연구 도구 특성상 과한 purple/blue gradient, glassmorphism, 장식성 hero는 피한다.
  - 전역 color mode는 라이트 모드로 고정한다. OS `prefers-color-scheme: dark`에 따라 토큰이 자동 전환되지 않게 한다.

### 15.7 공통 컴포넌트 도입 순서

1. 기반 유틸
   - [x] `cn()` 유틸 추가
   - [x] shadcn component import path, alias, registry 설정 확인
   - [x] `components.json` 도입 여부 결정
2. Primitive UI
   - [x] Button
   - [x] Input / Textarea / Label
   - [x] Badge
   - [x] Tooltip
   - [x] Dialog / Alert Dialog / Sheet
   - [x] Tabs
   - [x] Select / Dropdown Menu
   - [x] Skeleton / Spinner
   - [x] Separator / Scroll Area
   - [x] Toast 또는 Sonner
3. Product Components
   - [x] `AppTopbar`
   - [x] `UserMenu`
   - [x] `MissionCard`
   - [x] `StatusBadge`
   - [x] `LobbySummary`
   - [x] `OnboardingSteps`
   - [x] `ReferenceCard`
   - [x] `IdeaTabs`
   - [x] `IdeaEditor` `[IdeaWorkspace + IdeaNoteSection으로 대체 구현됨 (src/components/session/idea-workspace.tsx, idea-note-section.tsx)]`
   - [x] `MockupCanvasToolbar`
   - [x] `ChatPanel`
   - [x] `ChatBubble`
   - [x] `ToolActionChip`
   - [x] `TimelineActivityEventCard`
   - [x] `TimelineMemoryEventCard`
   - [x] `MemoryScoreBar`
   - [x] `MemoryClusterList`
   - [x] `MemoryClusterEmptyState`
   - [x] `MemoryClusterSidePanel`
   - [x] `MemoryClusterGraph` `[src/components/memory/memory-cluster-graph.tsx로 이동 완료]`
   - [x] `MemoryCard` `[src/components/memory/memory-card.tsx — before-session 메모리 카드에 적용]`
   - [x] `RetrievedMemoryBadge` `[src/components/memory/retrieved-memory-badge.tsx — ChatBubble에 적용]`
   - [x] `SessionMemoryDiff` `[src/components/memory/session-memory-diff.tsx — 메모리 변화 전체 보기 오버레이 shell]`
   - [x] `AdminDataTable` `[src/components/admin/admin-data-table.tsx — /admin 메모리 테이블에 적용. 나머지 admin 목록의 단계적 전환은 선택 과제]`
   - [x] `PromptViewer` `[src/components/admin/prompt-viewer.tsx — raw prompt 모달에 적용]`

### 15.8 주요 화면 재설계 방향

- 로그인/온보딩:
  - 제품 도입부는 간결하게 유지하고, 사용자의 다음 action을 가장 크게 둔다.
  - 설명 텍스트는 기능 홍보가 아니라 실제 진행에 필요한 안내만 둔다.
- 로비:
  - "지금 해야 할 일"과 "전체 미션 목록"을 분리한다.
  - 온보딩 잠금은 막연한 disabled가 아니라 왜 잠겼고 무엇을 누르면 되는지 보여준다.
- 메인 세션:
  - 세션 단계: option/profile/start → active design session → review/complete를 layout state로 분리한다.
  - 작업 영역은 canvas/editor/chat의 3개 핵심 축이 보이게 정리한다.
  - 레퍼런스/아이디어/목업은 "에이전트가 생성한 산출물"이자 "사용자가 선택/편집하는 재료"로 보이게 한다.
- 에이전트/어드민:
  - researcher/admin이 빠르게 비교, 필터링, 원인 추적을 할 수 있도록 밀도 있는 table/detail 패턴을 사용한다.
  - 사용자에게 불필요한 raw debug 정보는 admin-only로 유지한다.

### 15.9 Micro-interaction Polish 체크리스트

- [x] hover state는 색 변화만이 아니라 border/shadow/translate 중 하나를 일관되게 사용 `[primitive는 bg+border, 리스트/카드 버튼은 border+bg 조합 확인. 최종 시각 확인 권장]`
- [x] press state는 `scale(0.98)` 또는 명확한 active state를 짧게 제공 `[Button primitive의 active:translate-y-px]`
- [x] `transition-all` 사용 금지. 필요한 property만 지정 `[button/badge/tabs 3곳을 명시적 property 목록으로 교체 완료]`
- [x] loading은 skeleton/spinner/progress를 상황별로 구분 `[공용 Skeleton은 shimmer sweep, main 세션 pending artboard는 도메인 맞춤 shimmer, spinner(chat/reference/mockup), sonner(작업 피드백) 구분 사용 확인; lobby placeholder도 공용 Skeleton 사용으로 갱신 2026-06-30 → 15.160]`
- [x] 숫자/시간/카운트는 tabular numbers 적용 `[9곳 적용 확인]`
- [x] 긴 제목과 설명은 `text-wrap: balance` 또는 `pretty` 적용 여부 검토 `[로그인/온보딩 h1+설명, 미션 카드 제목, alert-dialog description에 적용]`
- [ ] nested card/button radius는 concentric하게 맞춤 `[시각 확인 필요]`
- [x] icon-only button에는 tooltip과 accessible label 제공 `[size="icon" 및 raw icon button 전수 감사, aria-label 8곳 보강]`
- [x] enter/exit animation은 interruptible CSS transition 우선 `[radix data-state 기반 표준 패턴(100–200ms), 페이지 커스텀 entrance animation 없음]`
- [x] 페이지 첫 로드에서 과한 animation을 실행하지 않음 `[페이지 mount entrance animation 없음 확인. lobby는 낮은 대비 shimmer skeleton만 사용 2026-06-30 → 15.160]`

### 15.10 접근성 / 상태 검증

- 접근성:
  - [x] 모든 interactive element에 keyboard focus 표시 `[globals.css 전역 :focus-visible outline + primitive focus ring]`
  - [x] icon-only button에 `aria-label` `[agent 뒤로가기, admin 미션/참여자/삭제 버튼 등 8곳 보강]`
  - [x] Dialog/Sheet focus trap과 escape close 확인 `[radix 기본 제공. custom overlay(PromptViewer/SessionMemoryDiff)에 ESC close 추가 — focus trap은 미적용, 필요 시 Dialog 전환 검토]`
  - [x] destructive action은 Alert Dialog 사용 `[main 디자인 삭제, admin 미션/유저 데이터 삭제 모두 AlertDialog 확인]`
  - [x] error message는 `role="alert"` 또는 적절한 live region 사용 `[login/lobby 기존 2곳 + admin/new, memory-log-views 추가]`
- 상태:
  - [ ] loading
  - [ ] empty
  - [ ] error
  - [ ] disabled
  - [ ] saving
  - [ ] streaming
  - [ ] success/completed
  - [ ] destructive confirmation

### 15.11 구현 단계

1. UX Audit
   - [x] 각 route의 현재 소스 기반 구조와 주요 user flow 기록
   - [~] 각 route의 현재 screenshot 기록 `[보류: 후속 과제]`
   - [x] 화면별 문제/개선안을 `dev_document.md` 또는 별도 issue에 정리
2. Design Tokens
   - [x] color/radius/spacing/type/focus/shadow 토큰 확정
   - [x] `globals.css` 업데이트
3. shadcn-style Foundation
   - [x] Next 16/Tailwind v4 호환 확인
   - [x] 최소 primitive component부터 도입
   - [x] 기존 Phosphor icon 사용 정책 유지 또는 lucide 전환 범위 결정
4. Product Component Refactor
   - [x] 중복 UI를 product component로 추출
   - [x] 큰 route file의 UI 책임을 단계적으로 분리 `[1차 완료: /main/[missionId] 7,500줄 → 약 6,500줄 (미사용 mockup capture 코드 ~500줄 제거, chat-content/mockup-html 헬퍼를 src/lib/session/으로 분리, PromptViewer/SessionMemoryDiff/MemoryCard 추출). /admin 3,200줄 → 약 2,400줄 (retrievals/forgetting/archived 탭을 memory-log-views로, 유저 카드를 admin-user-card로 추출). 추가 분해(/main의 renderMockupCanvas·renderSessionImpactGraph, /admin missions 탭 폼)는 후속 과제]`
5. Route Redesign
   - [x] `/`
   - [x] `/onboarding`
   - [x] `/lobby`
   - [x] `/main/[missionId]` `[1차 재설계 수용. 추가 개선은 후속 과제]`
   - [x] `/agent`
   - [x] `/admin` `[feedback/destructive flows + memory 탭 분해 완료. 전체 레이아웃 재설계는 후속 과제]`
6. Polish Pass
   - [x] jakubkrehel checklist 적용 `[1차 pass + 15.9 항목별 정적 검증 완료 (concentric radius만 시각 확인 보류)]`
   - [x] emilkowalski 관점으로 주요 화면 리뷰
7. Verification
   - [x] `npm run lint`
   - [x] `npm run build`
   - [x] local dev server에서 desktop 시각 확인 `[stale dev server(목요일 PID) 재시작으로 lock 해소. 리팩터링 화면 + min-width lock 동작 확인 완료. mobile은 desktop-only 정책으로 대상 제외]`
   - [~] auth가 필요한 화면은 mock 불가 시 최소 public route와 static state를 먼저 확인 `[보류: 실제 계정으로 시각 검증했으므로 불필요]`

### 15.12 리스크와 대응

- shadcn/ui 도입이 Tailwind v4/Next 16과 충돌할 수 있다.
  - 대응: 한 번에 대량 설치하지 않고 Button/Badge/Dialog 등 작은 primitive부터 검증한다.
- 기존 route file이 커서 리팩터링 중 회귀가 발생할 수 있다.
  - 대응: 화면 단위가 아니라 공통 컴포넌트 단위로 작게 추출하고, 동작 로직은 가능한 한 그대로 둔다.
- 연구/관리 기능은 정보량이 많아 "예쁘지만 느린 UI"가 될 수 있다.
  - 대응: admin은 card-heavy layout보다 table/detail/sheet 중심으로 유지한다.
- Firebase auth와 외부 API 의존성 때문에 모든 상태를 로컬에서 재현하기 어렵다.
  - 대응: loading/empty/error/readonly review state를 컴포넌트 단위로 먼저 검증한다.
- 디자인 개선 중 memory/retrieval/debug 의미가 흐려질 수 있다.
  - 대응: 사용자용 표현과 admin/debug 표현을 분리하고 raw 데이터는 숨기되 접근 가능하게 둔다.

### 15.13 완료 기준

- 모든 주요 route가 같은 토큰/컴포넌트 규칙을 사용한다.
- 로그인/온보딩/로비/세션/에이전트/어드민의 primary action이 명확하다.
- 공통 버튼, 입력, 배지, 탭, 다이얼로그, 시트, 툴팁, 로딩/빈/오류 상태가 일관된다.
- ~~모바일에서 주요 화면이 깨지지 않고, 작업 화면은 패널 전환이 가능하다.~~ `[기준 변경: 모바일 화면 미지원. desktop-only min-width lock(1024px)으로 대체]`
- keyboard focus와 dialog 접근성이 기본 기준을 충족한다.
- `npm run lint`와 `npm run build`가 통과한다.
- 구현 후 이 문서의 `[active]` 항목을 `[implemented]` 또는 `[partially implemented]`로 갱신한다.

### 15.14 UX Audit — 1차 소스 기반 점검 `[completed 2026-06-08]`

#### Next 16 / Tailwind 사전 확인

- 로컬 문서 확인:
  - `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
  - `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`
  - `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`
- 확인한 기준:
  - App Router page/layout 파일 구조는 현재 `src/app` 구조와 일치한다.
  - `use client` 파일은 import tree 전체가 client bundle에 들어가므로, 공통 UI를 추출할 때 interactive component와 static component 경계를 작게 잡는다.
  - Tailwind v4는 현재처럼 `@import "tailwindcss"`를 global CSS에서 import하고, 토큰은 `@theme inline` + CSS variable 중심으로 확장한다.
  - `next/link`는 className/target 등 anchor props를 직접 받을 수 있으므로, 공통 `Button`의 `asChild` 또는 Link wrapper 도입 시 중복 `<a>` 패턴을 피한다.

#### 전체 구조

- 현재 주요 화면 라인 수:
  - `/`: 91 lines
  - `/onboarding`: 139 lines
  - `/lobby`: 462 lines
  - `/main/[missionId]`: 8,639 lines
  - `/agent`: 391 lines
  - `/admin`: 3,123 lines
  - `MemoryClusterGraph`: 415 lines
- 가장 큰 리스크는 `/main/[missionId]`와 `/admin`이 거대한 client component라는 점이다. UI 개선 전에 모든 로직을 옮기면 회귀 위험이 커지므로, 1차 refactor는 visual/product component 추출에 한정한다.
- 반복되는 UI 패턴:
  - `rounded-2xl`/`rounded-3xl` card, modal, input container가 많다.
  - `bg-slate-*`, `text-slate-*`, `border-slate-*` 직접 지정이 대부분이다.
  - focus style이 `focus:border-slate-400` 또는 `outline-none` 중심이라 keyboard focus 기준이 약하다.
  - icon-only button 중 일부만 `aria-label`이 있다.
  - loading/empty/error 표현이 화면별로 다르다.

#### `/` 로그인

- 좋은 점:
  - 로그인 액션이 명확하고 loading/error 상태가 있다.
  - error message에 `role="alert"`가 있다.
- 문제:
  - dark glass card가 온보딩과만 연결되고 로비/작업 화면의 light dashboard와 톤이 끊긴다.
  - `rounded-3xl`, `rounded-2xl`, hover translate가 이후 화면과 통일되지 않는다.
  - 실패 상태가 재시도 행동과 시각적으로 연결되지 않는다.
- 개선 방향:
  - 제품 전체 토큰을 적용한 compact auth layout으로 정리.
  - Google login button을 공통 `Button` variant로 교체.
  - loading spinner, disabled, error alert를 공통 패턴으로 맞춘다.

#### `/onboarding`

- 좋은 점:
  - 사용자에게 전체 작업 흐름을 알려주는 4단계 안내가 있다.
  - 완료 상태와 저장 중 상태가 분리되어 있다.
- 문제:
  - 실제 `/main/[missionId]`의 3단계 option/profile/start 흐름과 설명 카드가 완전히 같은 구조는 아니다.
  - dark glass card와 nested rounded card가 많아 로비로 이동했을 때 제품 경험이 갈라진다.
  - 저장 실패가 `alert()`에 의존한다.
- 개선 방향:
  - onboarding guide를 stepper 또는 checklist component로 분리.
  - 완료/저장중/실패 상태를 Alert/Toast/Dialog 패턴으로 통일.
  - auth 화면과 같은 shell을 쓰되, 로비와도 이어지는 light token을 우선 검토.

#### `/lobby`

- 좋은 점:
  - onboarding mission과 일반 mission의 잠금 흐름이 구현되어 있다.
  - mission status badge가 derived status로 분리되어 있다.
  - user menu와 admin/agent entry가 있다.
- 문제:
  - "Agent Actions" 섹션이 미션 로비에서 가장 먼저 보이지만, 일반 사용자에게 primary task처럼 보이지 않을 수 있다.
  - mission card 전체 click과 `리뷰 보기` nested button이 섞여 있어 keyboard/semantics 개선 여지가 있다.
  - empty state는 있으나 loading/error state가 약하다.
  - `rounded-3xl` card, menu, empty box가 많아 작업도구 UI치고 다소 부피가 크다.
- 개선 방향:
  - top summary: 오늘 할 일 / 진행중 / 완료 / 대기 미션 요약 추가 검토.
  - `MissionCard`, `StatusBadge`, `UserMenu`, `AppTopbar` 추출.
  - locked mission은 disabled opacity만이 아니라 reason + primary redirect action을 명확히 표시.
  - card click 대신 명시적 action 영역 또는 accessible button/card pattern 적용.

#### `/main/[missionId]`

- 좋은 점:
  - 세션 준비, 미션 선택, profile input, active session, review, memory impact graph까지 제품의 핵심 기능이 한 화면에 연결되어 있다.
  - chat action chip, reference cite, mockup canvas controls, memory event timeline 등 연구/복기 기능이 풍부하다.
- 문제:
  - 8,639-line client component라 UI 변경 blast radius가 매우 크다.
  - route 안에 markdown renderer, reference logic, mockup capture, canvas controls, chat timeline, memory graph overlay, modal, context menu가 모두 섞여 있다.
  - 같은 버튼/칩/모달/패널 패턴이 파일 안에서 여러 스타일로 반복된다.
  - `transition`, `hover:*`, `rounded-full`, `rounded-2xl`, `rounded-3xl`, raw color class가 혼재한다.
  - mobile 대응은 일부 overlay와 `md:right-112` 같은 레이아웃이 있으나, 전체 작업 흐름을 mobile panel model로 명확히 분리하지는 않는다.
  - 일부 custom modal은 dialog semantics/focus trap 없이 fixed overlay로 구현되어 있다.
- 개선 방향:
  - 1차로 로직 이동 없이 visual component만 추출:
    - `SessionTopbar`
    - `SessionStepper`
    - `ReferenceCard`
    - `IdeaEditor`
    - `MockupCanvasToolbar`
    - `ChatBubble`
    - `ToolActionChip`
    - `MemoryEventCard`
    - `MemoryImpactPanel`
  - modal/confirm은 shadcn `Dialog`/`AlertDialog` 도입 이후 순차 교체.
  - mobile은 active session에서 `Workspace`, `Chat`, `Memory` tab 또는 sheet 기반 전환을 설계.
  - canvas controls는 icon button + tooltip + aria-label 기준으로 정리.

#### `/agent`

- 좋은 점:
  - cluster list/detail/graph가 비교적 명확한 2-column 구조다.
  - empty state와 regenerate action이 있다.
  - graph는 client-only dynamic import로 분리되어 있다.
- 문제:
  - user-facing memory view와 admin/debug view의 경계가 더 명확해야 한다.
  - graph/list/detail 패널 style이 admin memory modal과 유사하지만 공통 컴포넌트가 아니다.
  - regenerate action의 loading/error/success 피드백이 약하다.
- 개선 방향:
  - `MemoryClusterPanel`과 `MemoryClusterGraphShell` 공통화.
  - regenerate는 Button loading + Toast feedback으로 통일.
  - graph/detail/empty/loading state를 공통 memory UI 기준으로 맞춘다.

#### `/admin`

- 좋은 점:
  - 미션/참여자/세션/메모리/retrieval/forgetting까지 researcher workflow에 필요한 기능이 들어 있다.
  - table 기반 고밀도 정보 표현이 이미 일부 존재한다.
- 문제:
  - 3,123-line client component로 기능과 UI가 밀집되어 있다.
  - form control, segmented tab, table, modal, filter, destructive action 스타일이 반복된다.
  - 일부 destructive action은 alert/confirm 또는 custom UI로 흩어져 있을 가능성이 있어 AlertDialog 기준 정리가 필요하다.
  - admin debug 정보가 많아 기본 task와 raw 관측 정보의 위계가 흐려질 수 있다.
- 개선 방향:
  - `AdminShell`, `AdminTopbar`, `AdminDataTable`, `AdminFilterBar`, `AdminSectionHeader`, `DangerActionButton` 추출.
  - memory modal은 `Sheet` 또는 full-screen `Dialog` 패턴으로 정리.
  - destructive action은 AlertDialog + scope text + disabled/loading state로 통일.
  - raw prompt/json/debug는 collapsible/code viewer로 분리.

#### 우선순위 결정

1. `globals.css` 디자인 토큰 확장과 공통 class/utility 기반 마련.
2. shadcn-style primitive 중 dependency가 적은 `Button`, `Badge`, `Input`, `Textarea`, `Label`부터 수동 도입 또는 CLI 도입 검토.
3. `/lobby`에서 `AppTopbar`, `UserMenu`, `MissionCard`, `StatusBadge`를 먼저 추출해 작은 화면에서 토큰을 검증.
4. `/main/[missionId]`는 바로 전체 재설계하지 않고 `ToolActionChip`, `ChatBubble`, `ReferenceCard`처럼 isolated component부터 추출.
5. Dialog/Sheet/Tooltip/AlertDialog는 Radix dependency가 필요하므로 shadcn 호환 확인 후 한 번에 foundation으로 도입.

### 15.15 Design Token / Foundation Implementation Log `[partially implemented 2026-06-08]`

- `src/app/globals.css`
  - shadcn-style CSS variables 추가: background, foreground, card, popover, primary, secondary, muted, accent, destructive, success, warning, border, input, ring.
  - surface token 추가: `surface-page`, `surface-panel`, `surface-elevated`.
  - radius token 추가: `xs`, `sm`, `md`, `lg`, `xl`.
  - shadow token 추가: `panel`, `popover`, `dialog`.
  - Tailwind v4 `@theme inline`에 color/radius/shadow/font token 연결.
  - 전역 `:focus-visible` outline 추가.
  - font smoothing과 text rendering 기준 추가.
- `src/app/layout.tsx`
  - `next/font/google`의 Geist/Geist Mono 의존 제거.
  - 이유: 빌드 환경에서 Google Fonts fetch가 실패하면 production build가 깨짐.
  - root `lang`을 `ko`로 변경.
- `src/lib/utils.ts`
  - `cn()` 유틸 추가.
- `src/components/ui/*`
  - dependency-free shadcn-style primitive 5종 추가:
    - `button.tsx`
    - `badge.tsx`
    - `input.tsx`
    - `textarea.tsx`
    - `label.tsx`
- 1차 적용 화면:
  - `/`: Google login button을 공통 `Button`으로 교체.
  - `/onboarding`: 완료 버튼과 로비 링크를 `Button`/`buttonVariants`로 교체.
  - `/lobby`: user menu action, agent action link, mission status/device/duration badge, review action에 공통 primitive 적용.
- 검증:
  - `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /opt/homebrew/bin/npm run lint`
    - 통과. 기존 warning 19개 유지.
  - `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /opt/homebrew/bin/npm run build`
    - 통과. Turbopack NFT tracing warning 1개 유지.
    - 최초 sandbox build는 internal port binding 제한으로 실패했으며, escalated build에서 통과.
- Foundation 후속 결정 `[completed in 15.16]`:
  - `components.json` 도입 완료.
  - Tooltip/Dialog/AlertDialog/Sheet/Tabs/Select/Dropdown/Skeleton/ScrollArea/Sonner를 shadcn CLI로 추가 완료.
  - 기존 화면은 Phosphor icon을 유지하고, shadcn registry component 내부 필요분만 lucide를 허용하기로 결정.

### 15.16 shadcn/ui Official Initialization Log `[implemented 2026-06-08]`

- 공식 문서 확인:
  - `https://ui.shadcn.com/docs/installation/next`
  - `https://ui.shadcn.com/docs/tailwind-v4`
  - `https://ui.shadcn.com/docs/cli`
- CLI 확인:
  - `npx shadcn@latest info`
  - 프로젝트를 `Next.js (next-app)`, `srcDirectory: Yes`, `rsc: Yes`, `tailwindVersion: v4`, `tailwindCss: src/app/globals.css`, `importAlias: @`로 정상 인식.
- 초기화:
  - 실행: `npx shadcn@latest init --template next --base radix --preset nova --css-variables --no-reinstall --no-pointer`
  - 생성: `components.json`
  - 설치 dependency:
    - `class-variance-authority`
    - `clsx`
    - `lucide-react`
    - `radix-ui`
    - `shadcn`
    - `tailwind-merge`
    - `tw-animate-css`
  - `globals.css`에 `tw-animate-css`, `shadcn/tailwind.css`, shadcn OKLCH token, chart/sidebar token 추가.
- 보정:
  - CLI init가 `next/font/google`의 Geist를 다시 추가했으나, network-restricted build 안정성을 위해 제거하고 Pretendard/CSS token 방식 유지.
  - root `lang="ko"` 유지.
  - `TooltipProvider`를 root layout에 추가.
  - shadcn 공식 `Button`에 프로젝트 호환 alias 추가:
    - `size="md"`
    - `size="lg"`를 기존 적용 화면에 맞는 높이로 조정
    - button element 기본 `type="button"` 보강
  - shadcn 공식 `Badge`에 프로젝트 상태 variant 추가:
    - `success`
    - `warning`
- 추가한 공식 컴포넌트:
  - `badge`
  - `input`
  - `textarea`
  - `label`
  - `skeleton`
  - `separator`
  - `tooltip`
  - `dialog`
  - `alert-dialog`
  - `sheet`
  - `tabs`
  - `select`
  - `dropdown-menu`
  - `scroll-area`
  - `sonner`
- 아이콘 정책:
  - `components.json`의 `iconLibrary`는 shadcn preset에 맞춰 `lucide`로 유지.
  - 기존 앱 화면은 `@phosphor-icons/react`를 계속 사용한다.
  - 새 shadcn registry component가 lucide를 요구하는 경우에만 해당 component 내부에서 lucide를 사용한다.
- 검증:
  - `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /opt/homebrew/bin/npm run lint`
    - 통과. 기존 warning 19개 유지.
  - `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /opt/homebrew/bin/npm run build`
    - 통과. 기존 Turbopack NFT tracing warning 1개 유지.
- 다음 작업:
  - `/lobby` product component 추출:
    - `AppTopbar`
    - `UserMenu`
    - `MissionCard`
    - `StatusBadge`
  - 이후 `/main/[missionId]`의 isolated component(`ToolActionChip`, `ChatBubble`, `ReferenceCard`) 추출.

### 15.17 Color Mode Policy `[implemented 2026-06-08]`

- 문제:
  - shadcn init 이후 `globals.css`에 OS 다크모드 자동 토큰 전환(`@media (prefers-color-scheme: dark)`)과 `.dark` token block이 함께 존재했다.
  - 사용자의 OS/theme 상태에 따라 `border`, `input`, `card`, `background` token이 어둡게 바뀌어 라이트 화면 안에 다크 border line이 섞여 보일 수 있었다.
- 결정:
  - 현재 제품 UI는 전체 라이트 모드로 고정한다.
  - 다크모드는 이번 UX/UI 개선 범위에서 제외한다.
  - 추후 다크모드를 지원하려면 별도 theme toggle과 `.dark` root class 제어를 명시적으로 설계한 뒤 진행한다.
- 구현:
  - `src/app/globals.css`에서 `@media (prefers-color-scheme: dark)` token override 제거.
  - `src/app/globals.css`에서 `.dark` token block 제거.
  - shadcn component 내부의 `dark:` utility는 `.dark` class가 없으면 적용되지 않으므로 현재는 비활성 상태로 둔다.
  - `/` 로그인 화면의 명시 dark background/card/text class를 light token 기반 UI로 변경.
  - `/onboarding` 화면의 명시 dark background/card/text class를 light token 기반 UI로 변경.
- 검증:
  - `npm run lint` 통과. 기존 warning 19개 유지.
  - `npm run build` 통과. 기존 Turbopack NFT tracing warning 1개 유지.

### 15.18 Product Component / Route Polish Log `[partially implemented 2026-06-08]`

- `/lobby` product component 추출:
  - `src/components/lobby/app-topbar.tsx`
  - `src/components/lobby/user-menu.tsx`
  - `src/components/lobby/mission-card.tsx`
  - `src/components/lobby/status-badge.tsx`
  - `src/components/lobby/lobby-summary.tsx`
- `/lobby` UX 개선:
  - mission card 전체 클릭을 제거하고 명시적인 `시작` / `다시 열기` / `리뷰 보기` action으로 정리.
  - 온보딩 잠금 상태를 `잠김` 버튼과 안내 문구로 분리.
  - summary dashboard 추가: 전체, 대기, 진행중, 완료, 시간 초과.
  - mission loading skeleton 추가.
  - mission error state 추가.
  - top hero를 `Agent Actions` 중심에서 `미션 로비` 중심으로 재구성.
- `/onboarding` product component 추출:
  - `src/components/onboarding/onboarding-steps.tsx`
  - `alert()` 기반 실패 피드백을 Sonner `toast.error()`로 교체.
- `/main/[missionId]` isolated component 추출:
  - `src/components/session/tool-action-chip.tsx`
  - `src/components/memory/memory-score-bar.tsx`
  - `src/components/session/timeline-event-card.tsx`
  - chat action block chip의 token/radius/border 기준을 shadcn foundation에 맞춤.
  - review timeline의 activity/memory event card를 분리하고 token 기반 border/card/text 규칙으로 정리.
- `/agent` product component 추출:
  - `src/components/memory/memory-cluster-types.ts`
  - `src/components/memory/memory-cluster-colors.ts`
  - `src/components/memory/memory-cluster-list.tsx`
  - `src/components/memory/memory-cluster-empty-state.tsx`
  - `src/components/memory/memory-cluster-detail.tsx`
  - `src/components/memory/memory-cluster-side-panel.tsx`
  - `MemoryClusterGraph`를 embedding map canvas로 개편.
  - regenerate 성공/실패 피드백을 Sonner toast로 교체.
- `/admin` 피드백 정리:
  - mission delete, user mission record delete, onboarding settings save, memory delete/load, session backup/delete 결과를 Sonner toast로 통일.
  - 앱/컴포넌트 범위의 `alert()` 제거.
- 전역 피드백:
  - `src/app/layout.tsx`에 `Toaster` 추가.
  - `src/components/ui/sonner.tsx`는 라이트 모드로 고정.
  - `next-themes` dependency 제거.
- 보류한 항목:
  - `/main/[missionId]` 전체 layout redesign은 8,500+ line client route라 이번 pass에서는 isolated component 추출까지만 진행.
  - `/admin` 전체 재구성은 3,000+ line admin route의 regression risk가 커서 별도 pass로 보류.
  - destructive `confirm()`은 15.20에서 shadcn `AlertDialog`로 전환 완료.
  - screenshot 기록은 기존 Next dev lock/PID 때문에 보류. `npm run dev -- -p 3002`도 같은 프로젝트 lock을 감지하고 종료됨.
- 검증:
  - `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /opt/homebrew/bin/npm run lint`
    - 통과. 기존 warning 19개 유지.
  - `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /opt/homebrew/bin/npm run build`
    - 통과. 기존 Turbopack NFT tracing warning 1개 유지.

### 15.19 Continuation Pass — Agent/Admin/Main `[implemented 2026-06-08]`

- `/agent`
  - cluster list/detail/empty state를 product component로 분리.
  - graph/detail tab 구조는 15.25에서 graph + persistent right detail panel로 대체.
  - 재생성 액션에 success/error toast를 추가.
  - page/card/border/text 색을 라이트 토큰 기반으로 변경.
- `/main/[missionId]`
  - review timeline의 activity event card와 memory event card를 `TimelineActivityEventCard`, `TimelineMemoryEventCard`로 분리.
  - 세션 종료 실패 `alert()`를 `toast.error()`로 교체.
- `/admin`
  - 브라우저 `alert()` 기반 피드백을 모두 Sonner toast로 교체.
  - destructive action 확인은 15.20에서 shadcn `AlertDialog`로 scope text와 함께 전환 완료.
- 남은 큰 항목:
  - `/main/[missionId]` layout state 재설계.
  - `/admin` table/detail/sheet 기반 재구성.
  - screenshot/mobile 시각 검증. 현재 기존 Next dev lock/PID 때문에 보류.
- 검증:
  - `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /opt/homebrew/bin/npm run lint`
    - 통과. 기존 warning 19개 유지.
  - `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /opt/homebrew/bin/npm run build`
    - 통과. 기존 Turbopack NFT tracing warning 1개 유지.

### 15.20 Destructive Action Dialog Pass `[implemented 2026-06-08]`

- 목적:
  - 브라우저 기본 `confirm()`을 제거하고, 제품 토큰과 접근성 패턴을 따르는 shadcn `AlertDialog`로 통일한다.
- `/admin`
  - mission delete, participant mission records delete, session backup/delete를 하나의 `DestructiveAdminAction` state로 통합.
  - Dialog 문구에 삭제 scope를 명시:
    - 미션 삭제는 미션 목록 제거.
    - 참여자 미션 기록 삭제는 해당 미션 세션과 하위 기록만 삭제.
    - 세션 백업/삭제는 Storage 파일 포함, 메모리 컬렉션 유지. `[stale 2026-06-18 → 15.94: 메모리 컬렉션과 클러스터 캐시도 삭제]`
  - 확인 버튼은 `destructive` variant, 취소 버튼은 `outline` variant 사용.
- `/main/[missionId]`
  - idea delete, design/mockup delete, reference delete를 하나의 `DestructiveSessionAction` state로 통합.
  - 삭제 요청 함수와 실제 실행 함수를 분리:
    - `requestDeleteIdea` / `performDeleteIdea`
    - `requestDeleteDesign` / `performDeleteDesign`
    - `requestDeleteReference` / `performDeleteReference`
  - 삭제 전 Dialog에서 연결된 목업, 삭제 범위, 세션 활동/메모리 draft 기록 여부를 설명.
- 검증:
  - `rg "confirm\\(" src/app/admin/page.tsx 'src/app/main/[missionId]/page.tsx' src/app/agent/page.tsx -n`
    - 결과 없음.
  - `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /opt/homebrew/bin/npm run lint`
    - 통과. warning 18개 유지.
  - `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /opt/homebrew/bin/npm run build`
    - 통과. 기존 Turbopack NFT tracing warning 1개 유지.
- 남은 큰 항목:
  - `/admin` table/detail/sheet 기반 재구성.
  - `/main/[missionId]` layout state 재설계.
  - mobile/screenshot 시각 검증. 현재 기존 Next dev lock/PID 때문에 보류.

### 15.21 Lobby Status Bugfix — Start Button Not Clicked But Timed Out `[implemented 2026-06-08]`

- 증상:
  - 사용자가 세션 시작 버튼을 누르지 않았는데 로비에서 미션이 `시간 초과`로 표시되는 경우가 있었다.
- 원인:
  - `/main/[missionId]`에서 옵션을 선택하면 `selectedOptionId`, `missionTitle`, `missionBrief`가 먼저 저장된다.
  - 이 시점에는 아직 시작 버튼을 누르지 않았으므로 `timerStartedAt`은 `null`이다.
  - `/lobby`의 `missionProgress()`는 `selectedOptionId`만 있어도 `hasActivity=true`로 판단했다.
  - 이후 `derivedStatus()`가 `hasActivity=true`, `timerStartedAt=null`, `durationMinutes>0`인 상태를 `시간 초과`로 분류했다.
- 수정:
  - `/lobby`에서 `hasActivity=true`여도 `timerStartedAt`이 없으면 `준비중`으로 표시한다.
  - summary의 `대기` 카운트는 `대기 + 준비중`을 포함한다.
  - `/main/[missionId]` 저장 시 시작 전 snapshot은 `status: "draft"`, 시작 후 snapshot은 `status: "active"`로 저장한다.
  - 옵션 선택 직후 저장에도 `status: "draft"`를 명시한다.
- 검증:
  - `npm run lint` 통과. warning 18개 유지.
  - `npm run build` 통과. 기존 Turbopack NFT tracing warning 1개 유지.

### 15.22 Agent Memory Embedding Map `[implemented 2026-06-08]`

- 목적:
  - `/agent`의 memory graph를 cluster center + force link 구조가 아니라, embedding vector를 2D로 projection한 semantic map으로 보여준다.
- 구현:
  - `/api/memory/all` 응답에 `embedding` 배열을 포함.
  - `MemoryClusterGraph`를 `react-force-graph-2d` 기반 force graph에서 canvas 기반 scatter map으로 교체.
  - embedding vector는 클라이언트에서 PCA 2D projection으로 좌표화.
  - embedding이 없는 항목은 텍스트 hash 기반 fallback 좌표로 표시.
  - 각 memory item을 점으로 표시하고, cluster별 색을 다르게 적용.
  - cluster별 point group에는 반투명 convex hull/halo 영역을 표시.
  - selected cluster는 다른 cluster보다 더 강조하고, hover/click 시 semantic memory detail panel을 표시.
  - `/agent`뿐 아니라 admin memory cluster graph에서도 같은 컴포넌트가 동작하도록 `embedding`, `weight` 필드 호환 추가.
- 검증:
  - `npm run build` 통과. 기존 Turbopack NFT tracing warning 1개 유지.
  - `npm run lint` 통과. warning 18개 유지.

### 15.23 Agent Memory Map Zoom Controls `[implemented 2026-06-08]`

- 구현:
  - embedding map canvas에 zoom/pan transform state 추가.
  - mouse wheel로 cursor 기준 zoom in/out 지원.
  - 빈 canvas 영역 drag로 pan 지원.
  - 우측 상단에 zoom in, zoom out, fit/reset icon button 추가.
  - 현재 zoom percentage 표시.
  - hover/click hit-test를 zoom/pan 좌표 변환에 맞게 보정.
- 검증:
  - `npm run lint` 통과. warning 18개 유지.
  - `npm run build` 통과. 기존 Turbopack NFT tracing warning 1개 유지.

### 15.24 Agent Cluster Cache Signature Fix `[implemented 2026-06-08]`

- 증상:
  - `/agent` 새로고침 때마다 `클러스터 캐시가 현재 기억과 일치하지 않습니다. 재생성을 실행해주세요.` 안내가 반복될 수 있었다.
- 원인:
  - `/api/memory/clusters` GET이 현재 memory item signature와 일치하는 cache document를 읽지 않고, `memoryClusters` 컬렉션에서 `generatedAt`이 가장 최신인 문서를 반환했다.
  - admin memory modal 등에서 다른 memory version/filter/subset으로 생성한 최신 cluster cache가 있으면 `/agent`의 현재 `memories_0_1_2` item ids와 매칭되지 않아 stale로 판정됐다.
- 수정:
  - `memoryClusterItemSignature(items)` 공통 함수 추가.
  - `/api/memory/clusters` GET에서 현재 `/agent` memory items를 로드하고 signature를 계산한 뒤, 정확한 `clusterDocumentPath(uid, MEMORY_VERSION, itemSignature)`만 조회하도록 변경.
  - matching cache가 없으면 오래된/latest cache를 반환하지 않고 `clusters: []`, `found: false`를 반환한다. `[stale 2026-06-29 → 15.144: signature mismatch 시 빈 배열 대신 해당 variant의 최신 cache로 fallback하도록 변경]`
- 검증:
  - `npm run lint` 통과. warning 18개 유지.
  - `npm run build` 통과. 기존 Turbopack NFT tracing warning 1개 유지.

### 15.25 Agent Graph Persistent Detail Panel `[implemented 2026-06-08]`

- 목적:
  - `/agent`에서 graph와 detail을 탭으로 전환하지 않고, embedding map을 계속 보면서 선택 상세를 오른쪽 패널에서 확인한다.
- 구현:
  - `/agent`의 graph/detail `Tabs` 제거.
  - 레이아웃을 `cluster list + graph canvas + right detail panel` 구조로 변경.
  - `MemoryClusterSidePanel` 추가:
    - 선택 cluster summary
    - related actions
    - included memory list
    - graph point 선택 시 selected memory detail 표시
  - `MemoryClusterGraph`에 `selectedMemoryId`, `showInlineDetail` 옵션 추가.
  - `/agent`에서는 graph 내부 floating detail을 끄고, 오른쪽 side panel만 사용.
- 검증:
  - `npm run lint` 통과. warning 18개 유지.
  - `npm run build` 통과. 기존 Turbopack NFT tracing warning 1개 유지.

### 15.26 Agent Memory Selection Sync `[implemented 2026-06-08]`

- 구현:
  - 오른쪽 detail panel의 memory list를 항상 유지하도록 변경.
  - graph node 선택 시 list가 사라지지 않고 해당 memory item만 확장 표시.
  - detail panel의 memory item 클릭 시 `selectedMemoryId`를 업데이트해 graph node highlight와 동기화.
  - expanded memory row에 episodic/input/keywords/source metadata 표시.
- 검증:
  - `npm run lint` 통과. warning 18개 유지.
  - `npm run build` 통과. 기존 Turbopack NFT tracing warning 1개 유지.

### 15.27 15절 Current Status / Next Work `[updated 2026-06-08]`

#### 완료된 축

- Foundation:
  - shadcn/ui 기반 primitive 도입.
  - 라이트 모드 고정.
  - 전역 toast, tooltip, dialog/alert-dialog 기반 정리.
- `/`, `/onboarding`, `/lobby`:
  - light token 기반 UI로 통일.
  - onboarding stepper, mission cards, lobby summary, loading/error/empty state 정리.
  - 세션 시작 전 draft 상태가 시간 초과로 표시되는 문제 수정.
- `/agent`:
  - cluster list + embedding map + right detail panel 구조로 재설계.
  - PCA 기반 2D embedding map, cluster color/area, zoom/pan/fit 지원.
  - cluster cache signature 정확화.
  - profile/interaction source, semantic summary 유무, weight, selected row expansion 표시.
- Feedback/destructive actions:
  - 앱 범위 `alert()` 제거.
  - `/admin`과 `/main/[missionId]` destructive `confirm()`을 shadcn `AlertDialog`로 전환.

#### 아직 남은 핵심 작업

1. `/main/[missionId]` route redesign
   - 세션 시작 전 / active / complete-review layout state 분리.
   - 좌측 Mission/Reference/Idea/Mockup과 우측 Chat 정보 위계 재정의.
   - 모바일 panel tabs 또는 sheet 구조 설계.
   - canvas toolbar를 icon button + tooltip 기준으로 재구성.

2. `/main/[missionId]` product component extraction
   - `ReferenceCard` `[done 2026-06-08]`
   - `IdeaTabs`
   - `IdeaEditor`
   - `MockupCanvasToolbar` `[done 2026-06-08]`
   - `ChatPanel` `[done 2026-06-08]`
   - `ChatBubble` `[done 2026-06-08]`
   - 공통 `RetrievedMemoryBadge`
   - 공통 `SessionMemoryDiff`

3. `/admin` layout redesign
   - task group별 재구성: mission CRUD, users/participants, sessions, memory, debug.
   - table + detail sheet 패턴 도입.
   - 긴 memory/prompt/raw JSON은 `PromptViewer` 또는 collapsible/code viewer로 분리.
   - admin-only retrieval/forgetting/archive debug는 drawer/sheet로 격리.

4. 공통 memory UI consolidation
   - `/agent`, `/main` review, `/admin` memory modal에서 source/weight/semantic summary/archived 표시 규칙 통일.
   - `MemoryCard`와 `RetrievedMemoryBadge` 추출.

5. Verification pass
   - desktop/mobile screenshot 확인.
   - 360px, 390px, 430px, 768px, desktop viewport 점검.
   - keyboard focus, aria-label, tooltip, Dialog/Sheet focus trap 확인.
   - loading/empty/error/disabled/saving/streaming/completed 상태 점검.

#### 다음 실행 추천

- 1순위: active session 화면의 panel layout state를 작게 분리.
- 2순위: `IdeaTabs`, `IdeaEditor`, `ChatPanel`, `ChatBubble` 순서로 추가 추출.
- 3순위: `/admin`의 mission/user/session 섹션에 `AdminSectionHeader` + `AdminDataTable` 패턴 도입.

### 15.28 Main Session Product Component Extraction Pass 1 `[implemented 2026-06-08]`

- 목적:
  - `/main/[missionId]`의 큰 client route를 전체 재설계 전에 작은 product component 단위로 안정적으로 분리한다.
- 구현:
  - `src/components/session/reference-card.tsx` 추가.
    - reference thumbnail/title/rationale/tag/source/link/delete/selected state를 카드 컴포넌트로 분리.
    - selected state는 보라색 계열 대신 slate ring/badge로 표시해 다른 의미 색상과 겹치지 않게 조정.
  - `src/components/session/mockup-canvas-toolbar.tsx` 추가.
    - edit/fit/zoom/export/expand control을 icon button + tooltip 구조로 정리.
    - selected element pill을 toolbar 내부로 이동.
  - `/main/[missionId]/page.tsx`의 기존 reference card loop와 mockup toolbar JSX를 새 컴포넌트로 교체.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/reference-card.tsx src/components/session/mockup-canvas-toolbar.tsx` 통과. 기존 warning 계열 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 18개 유지.
  - `PATH=/usr/local/bin:$PATH npm run build`는 Turbopack의 local process/port binding sandbox 제한으로 실패. escalated 재실행은 사용량 제한으로 승인되지 않음.

### 15.29 Main Session Product Component Extraction Pass 2 — IdeaTabs `[implemented 2026-06-08]`

- 목적:
  - 15.27의 2순위 추출 순서(`IdeaTabs` → `IdeaEditor` → `ChatPanel` → `ChatBubble`)에 따라 시안 탭 바를 분리한다.
- 구현:
  - `src/components/session/idea-tabs.tsx` 추가.
    - 시안 목록을 active/hover/delete state가 있는 탭 리스트로 분리.
    - 기존 인라인 SVG X 아이콘을 lucide `X`로 교체.
  - `/main/[missionId]/page.tsx`의 note tab 목록 JSX(시안 전환/삭제)를 `IdeaTabs`로 교체. `switchIdea`/`requestDeleteIdea` 로직은 그대로 유지.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/idea-tabs.tsx` 통과. 기존 warning 계열 유지.
  - `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin /opt/homebrew/bin/npm run lint` 통과. warning 18개 유지.
- 다음 작업:
  - `IdeaEditor` (Note/Style/Mockup sub-tab 콘텐츠) 추출.

### 15.30 Memory Graph / Review UX Todo `[updated 2026-06-08]`

#### 우선순위 A — Memory Graph Layout

- [x] PCA projection과 similarity graph clustering의 불일치 1차 완화.
  - 현상:
    - clustering은 cosine similarity graph + label propagation 기반인데, 화면 좌표는 PCA 2D projection이라 cluster membership과 2D 거리감이 다르게 보일 수 있다.
    - PCA는 전체 분산을 잘 보존하지만, local neighborhood와 graph community를 반드시 보존하지 않는다.
  - 후보:
    - graph layout: similarity edge를 그대로 force-directed layout에 넣고 cluster별 force/edge weight로 2D 배치.
    - UMAP: local neighbor structure 보존이 PCA보다 좋아서 similarity graph와 더 비슷하게 보일 가능성이 높음.
    - t-SNE: local cluster separation은 강하지만 전역 거리 해석이 약하고 incremental/cache 관리가 어려움.
    - MDS / stress majorization: pairwise distance를 직접 2D 거리로 맞추는 방식이라 similarity distance 설명이 직관적임.
  - 1차 추천:
    - 저장된 similarity edges를 기반으로 force-directed/stress layout을 만들고, PCA는 fallback/debug projection으로 유지.
    - amem 시각화 방식을 참고해 node + edge + community area 중심으로 전환.
  - 구현:
    - `MemoryClusterGraph`가 `graphEdges`가 있으면 PCA를 초기값으로 한 deterministic force layout을 사용한다.
    - edge weight가 높을수록 node 사이 target distance를 짧게 잡고, 전체 node에는 repulsion을 적용한다.
    - cluster membership은 약한 centroid attraction으로만 반영해 edge 구조가 우선되도록 했다.
    - edge가 없으면 기존 PCA projection으로 fallback한다.

- [x] similarity edge 시각화.
  - edge는 node 사이의 cosine similarity가 threshold 이상이거나 top-k neighbor일 때만 표시.
  - edge opacity/width는 similarity weight에 비례.
  - selected node/cluster 주변 edge를 우선 강조하고, 전체 edge는 과밀해지지 않게 기본 opacity를 낮춘다.

- [x] edge similarity를 cache document에 저장.
  - 현재 clustering 과정에서 이미 `similarityEdges(vectors)`를 계산하므로, cluster cache에 edge list를 함께 저장한다.
  - `MemoryClusterGraph`는 매 렌더마다 pairwise similarity를 계산하지 않고 API 응답의 `edges`를 사용한다.
  - cache invalidation은 기존 memory item signature와 같은 기준을 사용한다.

#### 우선순위 B — Source / Admin Memory View

- [x] source label 워딩 변경.
  - `profile` → `Before session`
  - `interaction` → `During session`

- [x] admin 페이지 memory cluster view를 `/agent` 페이지와 같은 정보 구조로 개편.
  - cluster list + graph canvas + right detail panel 구조를 admin memory modal에도 적용.
  - admin-only raw/debug 정보는 기본 detail panel에서 숨기고 별도 drawer/collapsible로 분리.
  - admin view도 cluster color swatch, selected memory expansion, weight/source/semantic summary 표기 규칙을 `/agent`와 맞춘다.

#### 우선순위 C — Data / Production Validation

- [x] 기존 데이터 삭제.
  - legacy memory/cluster cache 호환 코드는 별도로 추가하지 않는다.
  - 이후 구현은 current schema 기준으로 단순화하고, 필요한 경우 새 데이터를 재생성한다.

- [ ] 배포 서버에서 실제 데이터를 충분히 생성해 memory graph 품질 확인.
  - 최소 확인:
    - before session memory만 있는 경우
    - during session memory가 많은 경우
    - 같은 미션에서 여러 session이 누적된 경우
    - reference/delete/mockup/note/final selection action이 섞인 경우

#### 우선순위 D — Memory Record Shape / Review UX

- [x] reference delete 같은 interaction memory의 input/output 표현 방식 점검.
  - 우려:
    - 일반 대화/생성 action은 input/output 쌍이 자연스럽지만, 삭제/선택 같은 UI action은 input만 있거나 output이 빈약해 detail card에서 어색할 수 있다.
  - 검토 방향:
    - 저장 schema를 바로 바꾸기 전에, detail UI에서 `input + output + action metadata`를 하나의 event summary로 합쳐 보여주는 방식부터 검증.
    - 실제 데이터에서 reference delete, note delete, mockup delete가 얼마나 어색하게 보이는지 샘플 확인 후 schema 변경 여부 결정.
  - 구현:
    - 저장 schema는 변경하지 않고 UI summary layer를 먼저 개선.
    - reference delete/cite/search, note delete, mockup delete, final design select는 action-aware event summary로 표시.
    - detail panel에는 `Event summary`, `Original input`, `Original output`을 함께 노출.

- [x] 세션 리뷰 화면에서 세션 전에 입력한 memory가 어떻게 반영됐는지 표시.
  - 현재는 채팅 기록 중심이라 before session memory가 어떤 식으로 session context에 들어갔는지 잘 보이지 않는다.
  - review timeline 또는 memory side panel에 before session memory usage/impact section 추가.

- [x] 미션별/세션 리뷰 화면에도 node view 추가 및 edge 연결.
  - `/agent`는 누적 memory graph.
  - session review는 해당 session의 before/during/changed memory graph.
  - mission review는 해당 mission에 누적된 graph로 구분한다.

### 15.31 Memory Graph Edge Cache / Visualization `[implemented 2026-06-08]`

- 목적:
  - clustering에 사용한 similarity graph를 화면에도 드러내 PCA projection과 community membership의 관계를 이해할 수 있게 한다.
  - edge similarity를 매 렌더마다 다시 계산하지 않고 cluster cache/API 응답에서 재사용한다.
- 구현:
  - `ClusterGraphEdge` 타입 추가: `{ sourceId, targetId, weight }`.
  - `src/lib/server/memoryClustering.ts`
    - `similarityEdges(vectors)` 결과를 memory item id 기반 `graphEdges`로 변환.
    - cluster cache document에 `graphEdges` 저장.
    - `parseStoredGraphEdges()` 추가.
  - `/api/memory/clusters`
    - GET/POST 응답에 `edges` 포함.
    - cache miss/empty 응답도 `edges: []`로 shape 통일.
  - `/api/admin/users/[uid]/memory/clusters`
    - admin cluster cache에도 `graphEdges` 저장/조회.
    - GET/POST 응답에 `graphEdges` 포함.
  - `/agent`
    - cluster API 응답의 `edges`를 `MemoryClusterGraph`에 전달.
  - `/admin`
    - memory modal cluster graph에 `graphEdges` state 추가.
    - cluster export JSON에도 `edges` 포함.
  - `MemoryClusterGraph`
    - cluster area와 node 사이에 similarity edge layer 추가.
    - edge opacity/width를 similarity weight에 비례시킴.
    - selected node 또는 selected cluster와 연결된 edge를 더 강조.
    - graph metadata badge에 edge count 표시.
- 데이터 전제:
  - 기존 데이터는 삭제된 상태이므로 legacy cluster cache migration/fallback은 구현하지 않는다.
  - graph edge가 필요한 경우 current schema로 cluster를 재생성한다.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint src/lib/server/memoryClustering.ts src/app/api/memory/clusters/route.ts 'src/app/api/admin/users/[uid]/memory/clusters/route.ts' src/app/admin/MemoryClusterGraph.tsx src/app/agent/page.tsx src/app/admin/page.tsx src/components/memory/memory-cluster-types.ts` 통과. 기존 admin warning 4개 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 18개 유지.
  - `PATH=/usr/local/bin:$PATH npm run build`는 기존과 같은 Turbopack local process/port binding sandbox 제한으로 실패.

### 15.32 Memory Graph Similarity Layout `[implemented 2026-06-08]`

- 목적:
  - clustering에 사용한 similarity graph와 2D 화면 좌표가 크게 어긋나는 문제를 줄인다.
  - PCA는 fallback/debug projection으로 남기고, 실제 graph view는 edge-aware layout을 기본으로 사용한다.
- 구현:
  - `MemoryClusterGraph`에 `projectSimilarityGraph()` 추가.
  - PCA projection을 deterministic 초기값으로 사용한 뒤 force-directed/stress-style layout을 계산.
  - layout force:
    - edge spring: cosine similarity weight가 높을수록 target distance를 짧게 설정.
    - node repulsion: node overlap과 과밀화를 줄임.
    - weak cluster attraction: 같은 cluster가 너무 흩어지지 않게 보조하되 edge 구조를 우선.
    - center gravity: 전체 graph가 canvas 밖으로 퍼지지 않게 보정.
  - graph edge가 있는 경우 상단 badge를 `Similarity graph layout`으로 표시.
  - edge가 없으면 기존 `PCA 2D projection`으로 fallback.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint src/app/admin/MemoryClusterGraph.tsx` 통과.

### 15.33 Admin Memory Cluster View Alignment `[implemented 2026-06-08]`

- 목적:
  - admin memory modal도 `/agent`처럼 graph를 계속 보면서 오른쪽 detail panel에서 cluster/memory detail을 확인하게 한다.
- 구현:
  - `/admin` memory cluster view의 `Graph / Detail` 탭 제거.
  - layout을 `admin tools/list + graph canvas + right detail panel` 구조로 변경.
  - 기존 admin diagnostics/regenerate/export controls는 왼쪽 admin tool 영역에 유지.
  - cluster card에 `/agent`와 같은 cluster color swatch 추가.
  - `MemoryClusterSidePanel`을 admin modal에서도 재사용.
  - graph node 클릭 시 오른쪽 panel의 memory row가 확장되도록 `selectedAdminGraphMemoryId` 연결.
  - admin row를 `MemoryItem` shape로 mapping해 source/weight/semantic/archived 표시 규칙을 `/agent`와 맞춤.
  - admin detail tab에 남아 있던 `Representative semantics` 노출 제거.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint src/app/admin/page.tsx` 통과. 기존 admin warning 4개 유지.

### 15.34 Session Review Before-Session Memory Impact `[implemented 2026-06-08]`

- 목적:
  - 세션 리뷰 화면에서 세션 전에 입력한 memory가 실제 세션 중 어떻게 쓰였는지 보이게 한다.
- 구현:
  - `SessionMemoryItem` 타입에 `sourceType` 추가.
  - review memory side panel에 `세션 전 정보 반영` 섹션 추가.
  - `sessionMemorySummary.graphMemories` 중 `sourceType === "profile"` 항목을 before-session memory로 계산.
  - before-session memory 중 `sessionMemorySummary.referenced`와 매칭되는 항목을 `세션 중 참고됨`으로 표시.
  - before-session memory 총 개수와 세션 중 참고된 개수를 summary card로 표시.
  - 각 before-session memory row에 weight와 weight delta를 표시.
  - row 클릭 시 전체 메모리 변화 modal을 열고 해당 memory node/reference를 선택.
  - graph memory가 아직 없고 raw profile input만 있는 경우 fallback 안내와 raw input list 표시.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx'` 통과. 기존 warning 12개 유지.

### 15.35 Interaction Memory Event Summary `[implemented 2026-06-08]`

- 목적:
  - reference delete 같은 UI action memory가 input/output 한쪽만 있는 것처럼 보여 detail card에서 어색해지는 문제를 줄인다.
  - 저장 schema를 바꾸기 전에 UI 표현 계층에서 먼저 검증한다.
- 구현:
  - `/main/[missionId]`의 `memorySummaryText()`를 action-aware summary로 변경.
  - `reference_delete`, `reference_cite`, `references_fetch`, `note_delete`, `mockup_delete`, `final_design_select`는 action label과 target text를 합쳐 표시.
  - `/agent`와 `/admin`이 공유하는 `MemoryClusterSidePanel`에 `Event summary` field 추가.
  - expanded memory detail에서 `Original input`, `Original output`도 함께 표시해 원본 raw fields를 잃지 않게 함.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/memory/memory-cluster-side-panel.tsx` 통과. 기존 warning 유지.

### 15.36 Session Review Node View Edges `[implemented 2026-06-08]`

- 목적:
  - `/agent` 누적 graph와 세션 리뷰 graph의 시각 언어를 맞춘다.
  - 세션 리뷰의 memory node view에서도 similarity edge를 보여줘 before/during/changed memory의 연결 관계를 읽을 수 있게 한다.
- 구현:
  - `/api/memory/session-summary`에서 선택된 cluster cache document의 `graphEdges`를 함께 반환.
  - `SessionMemorySummary`에 `graphEdges` 추가.
  - `fetchSessionMemorySummary()`가 `graphEdges`를 로드하도록 변경.
  - `renderSessionImpactGraph()`에서 현재 filter/phase로 보이는 node 사이의 edge만 필터링.
  - session review `MemoryClusterGraph`에 filtered edge를 전달.
  - graph badge에 cluster/node/edge count 표시.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/app/api/memory/session-summary/route.ts` 통과. 기존 warning 유지.

### 15.37 Main Session Product Component Extraction Pass 3 — ChatBubble `[implemented 2026-06-08]`

- 목적:
  - `/main/[missionId]`의 거대한 chat message JSX를 product component로 분리한다.
  - 이후 `ChatPanel` 추출과 채팅 UI polish를 쉽게 만든다.
- 구현:
  - `src/components/session/chat-bubble.tsx` 추가.
  - user bubble:
    - cited element, cited references, cited text snippets, user content 렌더링 분리.
  - assistant bubble:
    - markdown content, tool action chip, streaming dots, chat phase disclosure 렌더링 분리.
    - retrieved memory button, turn memory button, raw prompt button을 props callback으로 연결.
  - `/main/[missionId]/page.tsx`의 message map 내부 인라인 bubble JSX를 `ChatBubble` 호출로 교체.
  - page-level data lookup, modal state, review turn lookup은 route에 유지해 behavior 변경 범위를 줄임.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/chat-bubble.tsx` 통과. 기존 warning 유지.

### 15.38 Main Session Product Component Extraction Pass 4 — ChatPanel `[implemented 2026-06-08]`

- 목적:
  - `/main/[missionId]` 오른쪽 chat panel shell을 product component로 분리한다.
  - 이후 memory panel, chat input, prompt/citation controls를 더 작은 단위로 추출하기 쉽게 만든다.
- 구현:
  - `src/components/session/chat-panel.tsx` 추가.
  - review mode tab bar(`채팅`, `메모리 변화`)를 `ChatPanel` 내부로 이동.
  - scroll-to-bottom floating button을 `ChatPanel` 내부로 이동.
  - `/main/[missionId]/page.tsx`는 memory panel, message list, input area를 children slot으로 전달.
  - panel 내부의 상태/동작은 기존 route state와 callback을 그대로 사용해 behavior 변경 범위를 제한.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/chat-panel.tsx src/components/session/chat-bubble.tsx` 통과. 기존 warning 유지.

### 15.39 Main Session Product Component Extraction Pass 5 — ChatInput `[implemented 2026-06-08]`

- 목적:
  - `/main/[missionId]`의 chat input/citation tray JSX를 product component로 분리한다.
  - session route는 입력 상태와 handler 연결만 담당하게 하고, read-only/citation/reference/send/cancel UI는 독립 컴포넌트에서 관리한다.
- 구현:
  - `src/components/session/chat-input.tsx` 추가.
  - read-only notice, selected element/cited text/reference/style image attachment tray, textarea, send/cancel buttons를 `ChatInput`으로 이동. `[updated 2026-06-30 → 15.164: source chips는 Attachment-style item tray로 통일]`
  - `selectedElement`, `citedTexts`, `selectedReferences`, `textareaRef`, loading/mockup state를 props로 전달.
  - clear/remove/send/cancel/input keyboard handler는 page state를 유지한 채 callback props로 연결.
  - 기존 input UX와 mockup cancel label behavior는 유지.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/chat-input.tsx src/components/session/chat-panel.tsx src/components/session/chat-bubble.tsx` 통과. 기존 warning 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 17개 유지.

### 15.40 Main Session Product Component Extraction Pass 6 — Idea Note / Design Style `[implemented 2026-06-08]`

- 목적:
  - `IdeaEditor` 추출 전, `/main/[missionId]`의 note/style content blocks를 먼저 product component로 분리한다.
  - route component에서 markdown rendering detail과 style color-token rendering detail을 제거한다.
- 구현:
  - `src/components/session/idea-note-section.tsx` 추가.
    - 시안 노트 title/description markdown, empty state, expand/collapse control을 분리.
    - 기존 caret icon dependency를 컴포넌트 내부 lucide icon으로 이동.
  - `src/components/session/design-style-section.tsx` 추가.
    - 디자인 스타일 accordion, configured/empty state, style markdown renderer를 분리.
    - hex color token swatch rendering helper를 컴포넌트 내부로 이동.
  - `/main/[missionId]/page.tsx`는 active idea lookup과 section state만 유지하고, note/style UI는 component props로 전달.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/design-style-section.tsx src/components/session/idea-note-section.tsx` 통과. 기존 warning 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 17개 유지.

### 15.41 Main Session Product Component Extraction Pass 7 — MockupSection `[implemented 2026-06-09]`

- 목적:
  - `/main/[missionId]`의 active idea 영역에서 남아 있던 mockup section shell을 product component로 분리한다.
  - route component는 canvas 생성/zoom/export state와 handler를 유지하고, toolbar/empty/loading/expanded UI는 component로 이동한다.
- 구현:
  - `src/components/session/mockup-section.tsx` 추가.
  - `MockupCanvasToolbar` 사용 위치를 `MockupSection` 내부로 이동.
  - mockup expanded placeholder, generating placeholder, empty prompt, cancel button UI를 `MockupSection`으로 이동.
  - 실제 canvas는 기존 `renderMockupCanvas()` 결과를 `canvas` slot으로 전달해 canvas interaction logic 변경 범위를 제한.
  - `/main/[missionId]/page.tsx`의 mockup section JSX를 `MockupSection` 호출로 교체.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/mockup-section.tsx src/components/session/mockup-canvas-toolbar.tsx` 통과. 기존 warning 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 17개 유지.

### 15.42 Main Session Product Component Extraction Pass 8 — IdeaWorkspace `[implemented 2026-06-09]`

- 목적:
  - `/main/[missionId]`의 active idea workspace shell을 product component로 분리한다.
  - route component에서 idea tab bar, empty state, section sidebar navigation, content column layout을 제거한다.
- 구현:
  - `src/components/session/idea-workspace.tsx` 추가.
  - `IdeaTabs` 사용 위치를 `IdeaWorkspace` 내부로 이동.
  - 시안 없음 empty state를 `IdeaWorkspace` 내부로 이동.
  - Note/Style/Mockup section sidebar navigation과 scrollIntoView behavior를 `IdeaWorkspace` 내부로 이동.
  - `/main/[missionId]/page.tsx`는 active idea content assembly와 mockup handler wiring만 유지.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/idea-workspace.tsx src/components/session/idea-tabs.tsx` 통과. 기존 warning 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 17개 유지.

### 15.43 Main Session Product Component Extraction Pass 9 — FinalDesignSelector `[implemented 2026-06-09]`

- 목적:
  - `/main/[missionId]`의 mission-level final design selection UI를 product component로 분리한다.
  - route component에서 thumbnail sizing, iframe preview, selected badge, empty state rendering detail을 제거한다.
- 구현:
  - `src/components/session/final-design-selector.tsx` 추가.
  - final design empty state, idea별 artboard grouping, thumbnail scale calculation, iframe preview, final selected badge를 컴포넌트로 이동.
  - `/main/[missionId]/page.tsx`는 final artboard state update와 memory draft 저장 handler만 유지.
  - 선택/해제 동작과 `최종 디자인 선택` memory draft 기록 behavior는 유지.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/final-design-selector.tsx` 통과. 기존 warning 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 17개 유지.

### 15.44 Main Session Product Component Extraction Pass 10 — ReferenceSection `[implemented 2026-06-09]`

- 목적:
  - `/main/[missionId]`의 reference area shell을 product component로 분리한다.
  - route component에서 reference loading/error/empty/grid rendering detail을 제거한다.
- 구현:
  - `src/components/session/reference-section.tsx` 추가.
  - `ReferenceCard` grid, fetching indicator, search error panel, empty 안내를 `ReferenceSection`으로 이동.
  - `/main/[missionId]/page.tsx`는 selected reference state update와 delete handler만 유지.
  - selected state는 `selectedReferenceIds` set으로 전달해 card rendering과 page state mutation을 분리.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/reference-section.tsx src/components/session/reference-card.tsx` 통과. 기존 warning 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 17개 유지.

### 15.45 Main Session Product Component Extraction Pass 11 — MissionBriefSection `[implemented 2026-06-09]`

- 목적:
  - `/main/[missionId]`의 mission brief card를 product component로 분리한다.
  - route component에서 mission markdown renderer, device badge, selected option accordion UI detail을 제거한다.
- 구현:
  - `src/components/session/mission-brief-section.tsx` 추가.
  - mission title/brief empty state, device badge, mission markdown rendering, selected option accordion을 컴포넌트로 이동.
  - `/main/[missionId]/page.tsx`는 mission/option data와 option accordion state만 전달.
  - 기존 active option이 있을 때 parent mission brief를 우선 보여주고, active option이 없을 때 mission brief fallback을 보여주는 behavior 유지.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/mission-brief-section.tsx src/components/session/reference-section.tsx` 통과. 기존 warning 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 17개 유지.

### 15.46 Main Session Product Component Extraction Pass 12 — Session Setup Components `[implemented 2026-06-09]`

- 목적:
  - `/main/[missionId]`의 세션 시작 전 setup flow에서 반복되는 stepper/card UI를 product component로 분리한다.
  - route component에서 step indicator 중복, profile input/review card, setup mission summary card rendering detail을 제거한다.
- 구현:
  - `src/components/session/session-setup-stepper.tsx` 추가.
    - 1/2/3단계 step indicator와 back button UI를 공통화.
    - mission select, profile input, session start 단계에서 동일 컴포넌트 사용.
  - `src/components/session/session-setup-cards.tsx` 추가.
    - `ProfileInputCard`, `ProfileReviewCard`, `SetupMissionSummaryCard` 분리.
    - step 2/3의 중복 mission summary card를 하나의 컴포넌트로 통일.
  - `/main/[missionId]/page.tsx`는 setup flow state transition과 profile save/start handler만 유지.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/session-setup-stepper.tsx src/components/session/session-setup-cards.tsx` 통과. 기존 warning 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 17개 유지.

### 15.47 Main Session Product Component Extraction Pass 13 — MissionOptionSelection `[implemented 2026-06-09]`

- 목적:
  - `/main/[missionId]`의 mission option selection page를 product component로 분리한다.
  - route component에서 option preview tabs, mission intro card, option markdown detail, next button rendering detail을 제거한다.
- 구현:
  - `src/components/session/mission-option-selection.tsx` 추가.
  - step 1 `SessionSetupStepper`, parent mission info, device/time badges, option tabs, active option markdown detail, bottom next button을 컴포넌트로 이동.
  - `/main/[missionId]/page.tsx`는 active preview id state와 `chooseMissionOption` handler만 전달.
  - 분리 후 `/main/[missionId]/page.tsx`에서 더 이상 사용하지 않는 `ReactMarkdown`, `DeviceMobileIcon`, `MonitorIcon` import 제거.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint 'src/app/main/[missionId]/page.tsx' src/components/session/mission-option-selection.tsx` 통과. 기존 warning 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 17개 유지.

### 15.48 Profile Derived Memory Append Semantics `[implemented 2026-06-09]`

- 목적:
  - 세션 시작 시 before-session profile input을 매번 새로운 memory snapshot으로 남긴다.
  - 기존 profile-derived memory를 삭제하거나 같은 stable id로 덮어쓰지 않는다.
- 구현:
  - `src/app/api/memory/profile/route.ts`의 기존 `deleteProfileDerivedMemories()` 제거.
  - profile-derived memory write 전에 기존 mission profile memory를 삭제하던 behavior 제거.
  - derived memory id 생성에 `randomUUID()` 기반 `profileWriteBatchId`를 포함해, rawMarkdown이 수정되지 않아도 매 POST마다 새 memory document가 생성되도록 변경.
  - memory `source.profileWriteBatchId`를 저장해 같은 session-start write batch에서 생성된 profile memories를 추적 가능하게 함.
  - `profile_memories/{missionId}` rawMarkdown upsert와 revision 생성 조건은 유지.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint src/app/api/memory/profile/route.ts` 통과.

### 15.49 Memory Source Wording — Before/During Session `[implemented 2026-06-09]`

- 목적:
  - 내부/표시 wording에서 `profile`/`interaction` 출처 표현을 줄이고, UX에 맞는 `before_session`/`during_session`으로 정리한다.
  - 사용자가 세션 전에 입력한 정보는 `Before session`, 세션 중 확정되는 memory는 `During session`으로 보이게 한다.
- 구현:
  - before-session derived memory 저장 시 `sourceType`/`memorySource`를 `before_session`으로 변경.
  - before-session memory id prefix를 `before-session-...`로 변경.
  - before-session embedding source를 `before_session_unit_text`로 변경.
  - during-session memory 저장 시 `sourceType`/`memorySource`를 `during_session`으로 변경.
  - during-session memory id prefix를 `during-session-...`로 변경.
  - during-session embedding source를 `during_session_record_text`로 변경.
  - retrieval 응답 type을 `before_session_memory` / `during_session_memory`로 변경.
  - chat loading phrase를 `Reading before-session memory...` / `Reading during-session memory...`로 변경.
  - memory cluster side panel badge label을 `Before session` / `During session`으로 변경.
  - admin graph item mapping과 session review before-session filter를 새 sourceType 기준으로 변경.
  - 기존 `profile`/`interaction` sourceType과 old embedding source는 읽기 호환만 유지.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint src/app/api/memory/profile/route.ts src/app/api/memory/complete-session/route.ts src/app/api/memory/retrieve/route.ts src/app/api/chat/route.ts 'src/app/main/[missionId]/page.tsx' src/app/admin/page.tsx src/components/memory/memory-cluster-side-panel.tsx src/lib/prompts.ts` 통과. 기존 warning 유지.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. warning 17개 유지.

### 15.50 Original Interaction Content Memory Embedding `[implemented 2026-06-09]`

- 목적:
  - during-session memory embedding이 user input, agent output, agent action category를 분리된 의미 축처럼 다루지 않도록 정리한다.
  - 실제 상호작용 원문은 `originalInteractionContent` 단일 문자열로 저장하고, embedding/retrieval/clustering에서 같은 단위를 사용한다.
- 구현:
  - memory draft 생성 prompt에서 `user input`, `agent response`, `agent action category`, `agent action details` 분리 입력을 제거하고 `original interaction content` 단일 섹션으로 전달.
  - `MEMORY_ENCODE_PROMPT`의 input field 설명도 `original interaction content` 기준으로 변경하고, 한쪽만 요약하지 말라는 규칙으로 정리.
  - chat planner / during-session memory injection prompt에서 `interactionMemory`를 during-session memory로 해석하도록 설명을 정리.
  - cluster label prompt에서 `input`/`action` 중심 설명을 제거하고 `original interaction content`와 semantic/episodic/keywords 기준으로 라벨링하도록 변경.
  - memory draft document에 `originalInteractionContent` 저장.
  - session complete 시 promoted during-session memory document에 `originalInteractionContent` 저장.
  - during-session embedding text에서 `Action`, `Input`, `Output` 섹션을 제거하고 `Original interaction content`를 사용.
  - retrieval stale re-embedding text도 `Original interaction content` 기준으로 변경.
  - `/agent` memory clustering과 admin memory clustering 모두 `originalInteractionContent`를 우선 사용하고, 없을 때만 기존 input/output을 합쳐 fallback.
  - clustering input text 변경을 반영하기 위해 cluster cache method version을 `similarity-graph-v2`로 bump.
  - `/api/memory/all`, `/api/memory/session-summary`, admin cluster payload, session review graph item에 `originalInteractionContent` 전달 추가.
  - `agentActionCategory`는 embedding/encoder input에서는 제외하고, 기존 UI/filter/debug metadata로만 유지.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint src/lib/prompts.ts src/app/api/memory/drafts/route.ts src/app/api/memory/complete-session/route.ts src/app/api/memory/retrieve/route.ts src/app/api/memory/clusters/route.ts src/app/api/memory/all/route.ts src/app/api/memory/session-summary/route.ts 'src/app/api/admin/users/[uid]/memory/clusters/route.ts' src/lib/server/memoryClustering.ts src/app/admin/page.tsx 'src/app/main/[missionId]/page.tsx' src/components/memory/memory-cluster-types.ts` 통과.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. 기존 warning 유지.

### 15.51 Memory Legacy Fallback Removal `[implemented 2026-06-09]`

- 목적:
  - 기존 memory data를 삭제한 상태에 맞춰 v0.1.0/v0.1.1 compatibility path를 제거한다.
  - runtime/admin/review가 `memories_0_1_2`와 `before_session`/`during_session` source contract만 사용하도록 정리한다.
- 구현:
  - `/api/memory/retrieve`에서 `memories_0_1_1`, `semanticItems`, old embedding source fallback 제거.
  - retrieval weight update / near-miss decay를 v0.1.2 document 단위로 단순화.
  - `/api/memory/session-summary`, `/api/memory/archive-status`, admin memory/retrieval/session export API에서 구 memory collections 조회 제거.
  - `/api/memory/bootstrap`은 legacy preload fallback을 제거하고 `/api/memory/retrieve`로 안내하는 410 removed stub으로 변경.
  - admin memory modal의 v0.1.0/v0.1.1 tabs/counts 제거.
  - memory document `type` 저장값을 `before_session` / `during_session`으로 변경.
  - `sourceType === "profile"` / retrieved `profile_input` 호환 분기 제거.
  - code search 기준 `memories_0_1_1`, `episodicMemories`, `semanticMemories`, `profile_input`, old embedding source compatibility는 src 경로에서 제거.
- 검증:
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/tsc --noEmit` 통과.
  - `PATH=/usr/local/bin:$PATH ./node_modules/.bin/eslint src/app/api/memory/retrieve/route.ts src/app/api/memory/session-summary/route.ts src/app/api/memory/archive-status/route.ts src/app/api/memory/bootstrap/route.ts 'src/app/api/admin/users/[uid]/memory/route.ts' 'src/app/api/admin/users/[uid]/memory/retrievals/route.ts' 'src/app/api/admin/users/[uid]/sessions/route.ts' 'src/app/api/admin/users/[uid]/memory/clusters/route.ts' src/app/api/chat/route.ts src/app/api/memory/profile/route.ts src/app/api/memory/complete-session/route.ts src/app/admin/page.tsx 'src/app/main/[missionId]/page.tsx' src/components/memory/memory-cluster-side-panel.tsx` 통과.
  - `PATH=/usr/local/bin:$PATH npm run lint` 통과. 기존 warning 유지.

### 15.52 Note / Design Style 역할 분리 프롬프트 정리 `[implemented 2026-06-10]`

- 배경:
  - 시안 노트가 "...분석 노트 작성"처럼 task 문장으로 퇴화하고, high-level 컨셉이 들어갈 곳이 없던 문제.
  - 프롬프트에 "짧게"류 지침이 강해 노트가 한 줄로 압축되는 부작용.
- 구현:
  - `CHAT_NOTE_ACTION_PROMPT`: 노트는 task 재진술이 아니라 실제 브리프 내용(제품 아이디어 + high-level 디자인 컨셉/무드 방향 + 타깃 + 핵심 요구사항)을 쓰도록 변경. "디자이너가 노트만 보고 시작 가능"을 기준으로 길이 규칙 완화. 노트 금지 대상을 CSS-level 구체 토큰(컬러 토큰/타이포 스펙/스페이싱 값 등)으로 한정.
  - `CHAT_DESIGN_SPEC_ACTION_PROMPT`: 디자인 스타일은 CSS/구체 UI 스타일링에 직접 매핑되는 제약(컬러, 타이포, 스페이싱/사이징, radius, 그림자, 레이아웃 밀도, 컴포넌트 스타일, avoid 리스트)만 담도록 제한. high-level 컨셉/포지셔닝/추상 무드 서술은 노트로 분리하고, 무드는 형용사 대신 구체 시각 제약으로 표현하도록 명시.
- 역할 분리 요약: 노트(시안) = "무엇을 만들지 + 컨셉", 디자인 스타일 = "어떻게 보일지(CSS 매핑 가능한 제약)".
- 검증:
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.53 Stitch SDK Design System 통합 `[implemented 2026-06-10, 라이브 세션 검증 대기]`

- 목적:
  - 디자인 스타일을 매 생성마다 프롬프트 텍스트로 주입("always follow these constraints")하던 비결정적 방식을, Stitch 프로젝트 레벨 design system 토큰으로 강제 적용하도록 전환.
  - 15.52의 "디자인 스타일 = CSS 매핑 가능한 제약" 방향과 맞물려, 추출 가능한 토큰은 design system으로, 나머지 마크다운은 `designMd`로 넘긴다.
- 사전 검증 (라이브 Stitch API smoke test):
  - `@google/stitch-sdk`를 0.1.0 → 0.3.5로 업데이트. 기존 사용 API(`createProject`/`project`/`screens`/`getScreen`/`callTool`) 호환 유지 확인.
  - 실 API로 프로젝트 생성 → `createDesignSystem` → `update`(프로젝트 적용) → `listDesignSystems` 영속 확인까지 통과. 우리가 넘긴 토큰 shape를 Stitch가 수용하고 seed 컬러에서 `colorVariant`를 자동 파생함.
  - 핵심 가정 확인: `generate_screen_from_text`는 design system을 인자로 받지 않지만, 스타일을 전혀 지정하지 않은 중립 프롬프트로 생성한 결과 HTML에 프로젝트 활성 DS(다크 배경/세리프 폰트/풀 라운드/액센트 컬러)가 반영됨. → 생성이 프로젝트 레벨 DS를 따른다는 가정이 사실로 확인됨.
- 구현:
  - `src/lib/prompts.ts`: `DESIGN_SYSTEM_EXTRACT_PROMPT` + `STITCH_DESIGN_FONTS`(28개 enum) / `STITCH_DESIGN_ROUNDNESS` 추가. 디자인 스타일 마크다운 → 필수 5토큰(`colorMode`/`customColor` hex/`headlineFont`/`bodyFont`/`roundness`) JSON 추출. spacing/typography 맵은 추출하지 않고 Stitch 기본값에 위임.
  - `src/app/api/stitch/route.ts`:
    - `extractDesignTokens()` — gpt-5.4-mini로 토큰 추출, enum/hex 검증 실패 시 안전한 기본값으로 폴백(추출 실패가 생성을 막지 않음).
    - `applyDesignSystem()` — `designMd`에 마크다운 전체 + 토큰을 담아 create-or-update(create 직후 update로 프로젝트 적용).
    - POST에 `designStyle`/`designSystemId`/`appliedDesignStyleHash` 입력 추가. 스타일 content 해시가 바뀌었을 때만 design system 적용(해시 게이트) → 같은 시안 연속 생성/수정 시 추가 호출 0. 응답에 `designSystemId`/`appliedDesignStyleHash` 반환.
  - `src/app/main/[missionId]/page.tsx`:
    - `stitchDesignSystemId`/`appliedDesignStyleHash` state 추가, stitch 요청 body에 활성 시안 design style + 캐시 값 전송, 응답으로 갱신.
    - `buildMockupPrompt`에서 스타일 주입 블록 완전 제거(`appliedStyle` 파라미터 삭제). 비주얼은 design system이 담당하고 프롬프트는 제품/UX 의도만 전달.
- 검증:
  - `./node_modules/.bin/tsc --noEmit` 통과.
  - 라이브 smoke test로 SDK design-system 경로 + 생성 반영 확인(위 사전 검증).
  - **대기**: 앱 내 전체 흐름(실제 세션에서 CREATE_DESIGN_SPEC → 해시 게이트 → DS 적용 → 생성이 DS 반영, 시안 전환 시 갱신)은 라이브 세션에서 미검증.
- 고아 DS 하드닝 (후속 구현됨, 2026-06-11):
  - `applyDesignSystem()`에서 클라이언트가 `designSystemId`를 잃은 경우(새로고침 등) `listDesignSystems`로 프로젝트의 기존 design system을 찾아 재사용하고, 없을 때만 새로 생성 → 고아 DS 누적 없음.
- 남은 후속:
  - 라이브 세션 검증: 일반 미션에서 ① 스타일 생성 → 첫 목업 생성 시 `applying design system (style changed)` 로그 + 결과 반영, ② 같은 시안 연속 생성 시 적용 스킵(해시 게이트), ③ 스타일 변경 후 재적용, ④ 스타일 없음/추출 실패 시 정상 생성(폴백) 확인.
  - 검증 완료 후 Current Snapshot(2장 SDK 버전, 4.4 목업 비주얼 적용 방식, 6장 `/api/stitch`, 7장 프롬프트 표)에 반영하고 본 항목 태그에서 `라이브 세션 검증 대기` 제거.

### 15.54 시안 노트 안정화 / 액션 가드 / 디자인 스타일 seed `[implemented 2026-06-10]`

- 배경:
  - "노트 생성됨" 칩은 떴는데 좌측 시안 노트가 "아직 작성 안 됨"으로 비는 문제 — 칩(정규식 기반)과 실제 노트 파싱이 분리되어 있어 `description`이 비면 빈 노트가 생성됨.
  - "시안만 작성" 요청에도 모델이 같은 턴에 목업 액션까지 내보내 목업이 생성되는 문제.
  - Stitch는 디자인 스타일을 seed 컬러 1개로 압축하는데, 노트에 다색 팔레트를 적어도 의도대로 재현되지 않는 문제(15.53 후속).

- 노트 파서 (`page.tsx`):
  - `parseCreateNoteBlock`/`parseUpdateNoteBlock`을 공통 `parseNoteBlock`으로 통합. `description` 외 대체 키(`content`/`body`/`text`/`note`/`markdown`)도 인식하고, JSON.parse 실패 시(값 안 escape 안 된 줄바꿈 등) 정규식으로 필드를 복구.
  - 태그가 있으면 항상 객체를 반환(빈 경우 `description:""`)해 호출부 가드/로그가 반드시 동작.
  - CREATE: 빈 description이면 phantom 빈 노트를 만들지 않고 `console.warn`으로 원문 블록을 로그.
  - UPDATE: 활성 노트가 없으면 내용을 버리지 않고 새 시안으로 생성(폴백). 빈 description으로 기존 노트를 덮어쓰던 버그 수정(`?? ` → 비어있으면 기존 유지).

- 액션 결합 규율 (`prompts.ts`):
  - `CHAT_NOTE_ACTION_PROMPT`: "동시 출력 금지" 규칙을 CREATE/UPDATE 모두에 적용하고, 영어 태그뿐 아니라 한국어 alias(`[목업 생성 요청]` 등)도 금지. 목업은 평문 제안만 하고 대괄호 문구는 즉시 실행되니 쓰지 말 것, 사용자 확인 후 생성하도록 명시.
  - 트리거 경로: 클라이언트 `normalizeActionBlockAliases`가 한국어 대괄호 문구를 실제 액션으로 변환 → 모델이 "제안"으로 쓴 대괄호가 실행됨.

- 디자인 스타일 없이 목업 생성 차단:
  - `page.tsx`: 새 목업 생성(`isNew`) 시 활성 시안에 `designStyle.content`가 없으면 Stitch 호출 전 차단 + 안내 메시지. 기존 "노트 먼저" 가드 다음에 배치(노트 우선).
  - GENERATE_MOCKUP BLOCK_RULE에 `failedLabel`("목업 생성 불가")/`failedMarker` 추가 → 차단 시 칩이 실패로 표시.
  - `prompts.ts` `CHAT_MOCKUP_GENERATE_ACTION_PROMPT`: 디자인 스타일이 없으면 GENERATE_MOCKUP 대신 CREATE_DESIGN_SPEC 먼저 쓰거나 사용자에게 물어보도록 정렬.

- 디자인 스타일 seed 색상 (`prompts.ts`):
  - `CHAT_DESIGN_SPEC_ACTION_PROMPT`: 단일 primary brand seed 색을 hex로 항상 명시하고, CTA 전용 accent는 secondary로 두고 seed로 쓰지 않도록 규칙 추가.
  - `DESIGN_SYSTEM_EXTRACT_PROMPT`: `customColor`는 dominant brand/surface(=seed)를 고르고, declared seed가 있으면 그것을, CTA 전용 accent는 절대 seed로 잡지 않도록 강화.

- 검증:
  - `./node_modules/.bin/tsc --noEmit` 통과.
  - 노트 생성/수정은 라이브에서 정상 동작 확인. 액션 가드/목업 차단/seed 반영은 라이브 재검증 권장.

### 15.55 Next Work Backlog — 우선순위 `[active 2026-06-10]`

진행 순서 원칙: **(1) 데이터 정합성 버그 → (2) 싸고 다른 걸 풀어주는 것 → (3) 설계 결정 필요 → (4) UX 폴리시 → (5) 큰 기능.**

- 먼저 — 메모리 정합성 (연구 데이터 신뢰도 직결)
  - [x] **(1순위)** 세션에선 보이는데 메모리 view에서 3개 메모리가 안 보임 → 원인: complete-session이 episodic 빈 draft를 승격 안 하면서 promoted로 마킹(유실). 15.56에서 수정. (가설이던 "버전 싱크"는 아니었음)
  - [x] **(2순위)** weight가 증가만 되고 감소는 안 되는 이슈 → 실측 확인(증가 +835 vs 감소 −61, 0.5 미만 0개). 사용 기반 idle decay로 교체. 15.56에서 수정.
  - [x] **(3순위)** 온보딩 미션에서 작성한 before-session 메모리가 미션1 before-session으로 표시되는 오표기 → 리뷰 before 패널이 미션 필터 없이 모든 before_session을 가져오던 문제. 15.57에서 수정.

- 설계 결정 필요 (코딩 전 합의)
  - [ ] 메모리가 내용 기준이 아니라 "세션 전 입력 / 세션별 / 최종시안"으로 갈리는 문제 — 어떤 축으로 묶을지(내용/주제 vs 시점) 결정 후 진행. 현재 그룹핑이 의도된 동작인지 버그인지부터 확인.

- UX 폴리시 (작고 독립적)
  - [x] 메모리 뷰에서 노드 클릭 시 오른쪽 패널이 해당 메모리 위치로 스크롤. (15.58)
  - [x] 이전-이후 변화 뷰에서 "이후 생성분"을 더 명확히 표시(최근 diff 뷰 작업의 연장). (15.58)

- 큰 기능
  - [ ] Stitch 목업 생성 시 이미지 파일 추가(업로드 UI + 이미지 전달 파이프라인). 위 버그 정리 후 집중 블록으로.

### 15.56 메모리 유실 수정 / weight 사용 기반 decay / 리뷰 감소 표시 `[implemented 2026-06-10]`

- 배경: `/agent` 메모리 뷰에 일부 메모리가 안 보이고(#6), weight가 증가만 하는(#1) 문제. 둘 다 메모리 정합성 이슈.

- #6 메모리 유실 (`memory/complete-session/route.ts`):
  - 원인: 세션 종료 시 `episodic`(episode)가 빈 draft는 장기 메모리(`memories_0_1_2`)로 승격되지 않으면서도 draft는 `status:"promoted"`로 마킹돼 조용히 유실됨. episodic 빈 draft = UI 이벤트/최종시안 선택/semantic-only 메모리. 세션 뷰(draft 목록)엔 보이지만 /agent(장기 메모리)엔 안 나타남.
  - 수정: 승격 조건을 `episodic` 단독 → `episodic || semantic || input || output || keywords`(내용이 조금이라도 있으면 승격). 진짜 빈 draft만 `status:"skipped_empty"`(promotedAt 없음)로 표시 → 거짓 promoted 마킹 제거, 디버깅/재시도 가능.
  - 한계: 이미 종료돼 promoted로 마킹된 기존 draft는 자동 복구 안 됨(필요 시 backfill 스크립트 별도).

- #1 weight 사용 기반 decay (`memory/retrieve/route.ts`):
  - 실측(`scripts/analyze_memory_weights.py`): 5명/132개 중 weight 0.5 미만 0개, 60%가 0.5 동결, delta 이벤트 증가 +835 vs 감소 −61. 기존 near-miss decay(rank 6~20 & sim≥0.55)가 현실에선 거의 안 걸려 단조 증가만 함.
  - 수정: near-miss decay 제거 → **idle decay** 도입. retrieve마다 그 턴에 retrieve 안 된 모든 메모리에 −0.005(메모리 많을수록 최대 −0.006), 하한 0.1. 벽시계 무관(사용 기반)이라 3일 formative 실험의 "시간 기반 archive 금지" 원칙과 충돌 없음. 로그 필드 `idleDecayDeltas`/`idleDecayCount`로 교체(외부 consumer 없음). 튜닝 상수 `IDLE_DECAY_WEIGHT_LOSS`. `[stale 2026-07-13 → 15.241: idle decay 기본값 0.006, 상한 0.012, 하한 0으로 조정해 사용되지 않는 memory가 결국 inactive가 되게 함]`
  - 2026-07-01 Notion Weight 코멘트 반영: 요청이 한 번도 없는 memory가 세션당 평균 10~20 retrieval 턴에서 약 5~10% 낮아지도록 기본 idle decay를 0.003에서 0.005로 조정.
  - read-only 분석 스크립트 `scripts/analyze_memory_weights.py` 추가(weight 분포/증감 이벤트 집계).

- 리뷰 화면 감소 표시 (`memory/session-summary/route.ts` + `main/[missionId]/page.tsx`):
  - 일관성: `referenced.weightAfter`를 마지막 retrieve 시점 값 → **현재 live weight**로 변경, `weightDelta = 현재 − 세션 시작 전`(retrieve 증가 + idle 감소 합산). 그래프 수치와 일치하고 감소도 델타에 드러남.
  - 참가자 친화: route에 `idleDecaySummary{memoryCount,totalDelta}` 집계 추가. 메모리 변화 탭에 "자주 참고되지 않은 기억 N개가 약해졌어요" 한 줄. `formatWeightStrength`(강함/보통/약함/희미함) 라벨을 weight 옆에 표시. 음수 delta가 초록(증가처럼) 표시되던 색상 버그 수정.
  - 상세 per-memory 감소 수치는 admin/로그/분석 스크립트에만 유지, 참가자 화면은 깔끔하게.

- 검증: `./node_modules/.bin/tsc --noEmit` 통과. 라이브 세션에서 종료→승격, decay 누적, 리뷰 표시 재검증 권장.

### 15.57 before-session 메모리 미션 오표기 수정 `[implemented 2026-06-10, 15.59에서 누적 모델로 대체]`

- 배경(#3): 온보딩 미션에서 만든 before-session 메모리가 미션1 리뷰의 "세션 이전 항목"에 미션1 것처럼 표시됨.
- 원인: 리뷰 before 패널(`beforeSessionMemoryImpact`)이 `sessionMemorySummary.graphMemories`(= 유저 전체 메모리)에서 `sourceType === "before_session"`만 거르고 **`source.missionId` 필터가 없어서** 다른 미션(온보딩 포함)의 before_session 메모리까지 섞임. before_session 문서는 `before-session-{missionId}-...`로 미션별 생성되고, "직접 입력한 정보"(reviewProfileItems)는 이미 `profile_memories/{missionId}`로 미션 스코프인데 이 패널만 누락.
- 수정(`main/[missionId]/page.tsx`): before 패널 필터에 `item.source?.missionId === missionId` 추가, useMemo deps에 `missionId` 포함. referenced 목록은 session-summary에서 이미 `log.missionId === missionId`로 스코프되어 있어 변경 불필요.
- 검증: `./node_modules/.bin/tsc --noEmit` 통과. 라이브에서 미션1 리뷰에 온보딩 before_session이 더 이상 안 뜨는지 재확인 권장.

### 15.58 메모리 뷰 UX 폴리시 — 노드 클릭 스크롤 / 신규 강조 `[implemented 2026-06-10]`

- 노드 클릭 시 사이드 패널 스크롤 (`components/memory/memory-cluster-side-panel.tsx`):
  - 그래프 노드 클릭은 해당 클러스터 선택 + memory 선택을 동시에 함(`MemoryClusterGraph` onPointerUp). 사이드 패널이 그 클러스터의 item 목록을 보여주지만, 선택된 항목이 스크롤 밖이면 직접 찾아야 했음.
  - `selectedMemoryId` 변경 시 선택 항목을 `scrollIntoView({block:"nearest"})`로 자동 스크롤. 선택 항목에 ref + `scroll-mt-2`.
- "이후 생성분"(이번 세션 신규 생성) 강조:
  - 그래프(`admin/MemoryClusterGraph.tsx`): 노드 `action`에 "promoted" 토큰이 있으면 신규 강조. (초기 emerald 링 → 이후 15.59에서 **다이아몬드(◆) 모양**으로 변경) 세션 diff/누적 뷰에서만 action에 promoted가 들어가므로 admin/agent 일반 액션엔 영향 없음.
  - 사이드 패널: promoted 항목에 "이번 세션 신규" 초록 배지 + emerald 좌측 accent bar.
- 검증: `./node_modules/.bin/tsc --noEmit` 통과. 공유 컴포넌트(admin/agent)는 action에 promoted 토큰이 없어 강조 미적용(안전).

### 15.59 누적(cumulative) 메모리 뷰 `[implemented 2026-06-10]`

- 요청: 메모리를 미션 단위로 누적해서 보기. 온보딩=온보딩만, 미션1=온보딩+미션1, 미션2=온보딩+미션1+미션2 … (15.57의 "현재 미션만" 스코프를 대체).
- 누적 기준: 시간순 + 온보딩 베이스. mission id가 `mission-YYYYMMDD-HHmmss`라 문자열 비교 = 시간순. 온보딩은 항상 첫 베이스. 공용 헬퍼 `missionOrderKey`/`isWithinCumulative`(agent·main 각 파일에 정의): `memoryMissionId === onboarding || missionOrderKey(memoryMissionId) <= missionOrderKey(selectedMissionId)`.
- /agent (`agent/page.tsx`): 세션 선택 필터를 단일 세션 → "선택 미션까지 누적"으로 변경(`filteredClusterItems`). "전체"는 전부, no-session 버킷은 그대로. 세션 헤더에 "(이전까지 누적)" 힌트.
- /main 리뷰 (`main/[missionId]/page.tsx`): `cumulativeGraphMemories` memo 추가(graphMemories를 현재 미션 기준 누적 필터). before-session 패널/sessionArchived/diff 그래프(visibleMemoryItems)/사이드 패널/메모리 탭 카운트를 모두 누적 기준으로 교체. 후속 미션 메모리는 해당 미션 리뷰에서 제외됨.
- 신규 표시 회귀 수정: 누적으로 "before" 집합(온보딩+이전 미션)이 거의 항상 채워지면서, diff 뷰가 "before" phase에 머물러 그 세션 신규(promoted)가 가려지던 문제. diff 오픈 시 신규가 있으면 "after" phase로 기본 전환하도록 변경(기존 "before가 빌 때만" 조건 제거). after = 누적 전체 + 신규(다이아몬드 ◆로 강조), before 토글은 이전 상태 비교용으로 유지.
- /agent 신규 강조: /agent엔 "promoted" 개념이 없어, **선택한 미션에서 생성된** 메모리(누적 베이스가 아닌 것)에 action "promoted" 토큰을 붙여 그래프/패널 강조를 켬(`agent/page.tsx` clusterItems). "전체"/no-session 선택 시엔 강조 없음.
- 신규 강조 표현: emerald 링 → **다이아몬드(◆)** 모양으로 변경(`admin/MemoryClusterGraph.tsx`). 색과 무관하게 모양으로 구분. 사이드 패널 배지도 "◆ 이번 세션 신규", raw action 칩에선 "promoted" 토큰 숨김(전용 배지로 표현).
- 범례(legend): 그래프 좌하단에 "◆ 새로 생긴 기억 / ● 기존 기억" 작은 칩. **신규(◆) 노드가 있을 때만** 자동 표시(없으면 미표시 → admin 등 비대상 화면 혼란 방지). 공유 컴포넌트라 /agent·리뷰 양쪽 자동 적용.
- 검증: `./node_modules/.bin/tsc --noEmit` 통과. 라이브에서 온보딩→미션1→미션2 순으로 누적 표시/제외 + 신규(다이아몬드) 노출 재확인 권장. source.missionId 없는 레거시 메모리는 누적에서 제외(안전).

### 15.60 메모리 변화 전체 보기 — /agent 레이아웃 미러링 `[implemented 2026-06-11]`

- 배경: 리뷰 화면의 "메모리 변화 전체 보기"가 모달 + 자체 우측 aside 구조라 /agent 페이지와 인터페이스가 달랐고, 그래프 내장 상세 카드(`showInlineDetail`)와 우측 패널이 같은 정보를 중복 표시했음. 온보딩 리뷰에서는 "아직 node view로 표시할 세션 메모리 변화가 없습니다"만 떠 비어 보이는 문제도 있었음.
- 레이아웃 개편 (`main/[missionId]/page.tsx`):
  - 모달 → 전체 화면(fixed inset-0)으로 변경하고 /agent와 동일한 3패널 구성: `MemoryClusterList`(좌, 클러스터 목록) + `MemoryClusterGraph`(중앙, `showInlineDetail={false}`) + `MemoryClusterSidePanel`(우, 선택 클러스터 항목/상세). 노드 상세는 사이드패널 한 곳에서만 표시(중복 제거).
  - `세션 이전/세션 이후` phase 토글은 그래프 좌상단에서 오버레이 헤더 우측으로 이동(그래프 자체의 "N clusters …" 배지와 겹침 해소). `memoryPhaseToggle` 공용 JSX로 추출해 채팅 패널 내 작은 그래프(panel variant)와 공유.
  - `변화만/전체/참고/기억됨/보관됨` 필터 버튼 제거(필터는 기본 "변화만" 고정). 우측 aside의 stats/선택 노드/참고 목록도 제거하고 사이드패널로 대체.
  - 빈 상태에서도 phase 토글을 유지해 "세션 이전" 진입 후 되돌아올 수 있게 수정. 온보딩처럼 세션 이전 메모리가 없으면 오픈 시 "세션 이후"로 자동 전환.
  - `MemoryClusterList`의 `onRegenerate`를 optional로 바꿔 read-only 리뷰에서는 재생성 버튼 숨김(/agent 동작 불변).
- 노드 상세 라벨 수정 (`admin/MemoryClusterGraph.tsx`):
  - 상세 카드 제목이 "Semantic memory"로 하드코딩돼 있던 것을 실제 표시 필드 기준(semantic→"Semantic memory", episode/episodic→"Episodic memory", input→"User input", 없으면 "Memory node")으로 동적 변경. 라벨 fallback 체인에 `episode` 추가.
  - 세션 리뷰 graph item이 `semantic: semantic ?? episodic ?? input`으로 fallback을 미리 합쳐 넘겨 모든 노드가 "Semantic memory"로 표시되던 문제 수정(원본 `semantic`만 전달).
- 온보딩 빈 화면 수정: 온보딩은 세션 이전 메모리가 0이므로 promoted 전부가 "before" phase에서 필터링돼 비어 보였음 → phase 자동 전환 + 빈 상태 문구 분기("세션 이전에는 메모리가 없었습니다.")로 해소.
- 검증: `./node_modules/.bin/tsc --noEmit` 통과. 페이지 피드백 루프로 레이아웃/겹침/빈 화면 확인. (commit d4ba11e)

### 15.61 온보딩 세션 설정 — 정보 입력 단계 제거 `[implemented 2026-06-11]`

- 배경: 온보딩 미션은 before-session 메모리를 만들지 않기로 결정 → step 2(정보 입력)가 미션 요약만 보여주는 무의미한 단계로 남음.
- 구현 (`main/[missionId]/page.tsx`, `components/session/session-setup-stepper.tsx`, `components/session/mission-option-selection.tsx`):
  - 온보딩이면 step 2를 건너뛰고 시안 선택 → 바로 세션 시작 단계(`profileStep === 3 || isOnboardingMission`).
  - `SessionSetupStepper`에 `hideProfileStep` prop 추가: 온보딩은 "미션 선택 → 세션 시작" 2단계로 표시하고 번호를 index 기준으로 재부여. `MissionOptionSelection` 내부 stepper에도 `onboarding` prop 연결(미션 선택 화면에서도 2단계 표시).
  - 세션 시작 단계의 "이전" 버튼은 온보딩에서 시안 선택으로 복귀. `ProfileReviewCard` 미표시, 세션 시작 시 `/api/memory/profile` POST 생략.
- 검증: `./node_modules/.bin/tsc --noEmit` 통과.

### 15.62 신규 요구사항 백로그 — 미션 확장 / semantic 적극 생성 / clustering 비교 / 사용자 이해 요약 `[active 2026-06-11]`

연구용 4개 신규 요구사항을 정리하고 우선순위를 매긴다. 구현 전 각 항목의 **열린 결정**을 먼저 합의한다. 진행 순서 원칙은 15.55와 동일: 데이터 정합성/실험 셋업 → 싸고 upstream → 큰 기능 → 연구 분석 도구.

#### 요구 A. 온보딩 제외 세션 9개로 미션 확장

- 요구: 현재 "3개 옵션 중 1개 선택" 구조를 옵션별 개별 미션으로 쪼개 온보딩 제외 총 9개 세션이 되게 한다. (3 미션 × 3 옵션 → 9 미션)
- 현재 구조: `Mission.options: MissionOption[]`, 세션은 `selectedOptionId`로 1개 선택. 옵션 1개뿐인 미션은 자동 선택(`MissionOptionSelection`).
- 어디: Firestore `missions` 데이터(콘텐츠 생성이 주). 코드는 `admin/page.tsx`(미션 CRUD), `MissionOptionSelection`, 세션 시작 흐름. 옵션 선택 mechanic을 유지할지/제거할지에 따라 변동.
- 접근 스케치: 기존 각 옵션의 `title/description/content`를 개별 미션 문서로 승격. 미션당 옵션 0~1개로 단순화하면 옵션 선택 화면은 자동 통과.
- 고려·의존:
  - 미션 id가 `mission-YYYYMMDD-HHmmss`이고 **누적 메모리 뷰(15.59)가 id 문자열=시간순으로 누적**하므로, 9개 미션을 의도한 학습 순서대로 id 시퀀스가 정렬되게 생성해야 함.
  - 옵션 선택 UI/`selectedOptionId` 경로를 제거할지(완전 단일화) 데이터만 9개로 늘릴지 결정 필요.
- 규모: 콘텐츠 셋업 위주 + 소량 코드. 실험 진행의 선행 조건(데이터 수집 차단 해제).
- 열린 결정: ① 옵션 선택 mechanic 제거 vs 미션당 1옵션 유지, ② 9개 미션의 순서/난이도 배치, ③ 기존 옵션 콘텐츠 재사용 범위.

#### 요구 B. interaction마다 semantic memory 무조건 생성 (적극적 해석)

- 요구: 지금은 "근거 있는 durable insight"만 보수적으로 semantic 생성(없으면 null). 이를 바꿔 **과해석이 들어가더라도 매 interaction마다 semantic을 1개 이상 생성**. 의도: 사용자가 메모리를 보는 재미 + "어떻게 해석됐어야 맞나"에 대한 insight 도출(연구 관찰 대상).
- 어디: `src/lib/prompts.ts` `MEMORY_ENCODE_PROMPT`. 현재 보수 문구(라인 ~280 "must be clearly supported", ~304 "Do NOT force or fabricate", ~305 "Return null when no durable inference")를 반전.
- 접근 스케치: semantic을 required 1개(또는 1~N)로 바꾸고, null 금지. 단 연구 추적성을 위해 **추론임을 표식**(예: 별도 필드 `interpretationConfidence` 또는 semantic이 해석/관찰 기반임을 명시)으로 남겨, 리뷰에서 과해석을 보이고 교정 가능하게.
- 고려·의존:
  - B는 C(clustering 비교)와 D(사용자 요약)의 **upstream** — 둘 다 semantic을 소비하므로 B가 먼저 적용된 데이터로 진행해야 일관됨.
  - semantic 데이터 분포가 바뀌므로 clustering `CLUSTERING_METHOD_VERSION` bump 필요.
  - 다음 데이터 수집 라운드 **전에** 적용해야 함(수집 후 바꾸면 메모리 데이터가 섞임).
- 규모: 프롬프트 변경 위주(작음). 영향은 큼(데이터 성격 변화).
- 열린 결정: ① semantic 개수(항상 1개 vs 1~N), ② 최소한의 grounding 가드 유지 vs 완전 적극, ③ 과해석 추적 표식 방식.

#### 요구 C. clustering 입력 3버전 비교

- 요구: 임베딩 입력을 3가지로 만들어 어떤 게 좋은지 비교. ① semantic만, ② interaction log 제외(episodic+semantic+keyword), ③ 기존(keyword+episodic+semantic+originalInteractionContent+link).
- 어디: `src/lib/server/memoryClustering.ts` `embeddingText()`(현재 ③), `CLUSTERING_METHOD_VERSION`, cluster cache 키(method version + item signature). 비교 UI는 `/agent`/admin.
- 접근 스케치: `embeddingText`를 variant 파라미터로 분기, 각 variant를 별도 method-version 키로 캐시(공존). 같은 메모리 집합에 3버전 클러스터를 생성하고 나란히 비교하는 뷰.
- 고려·의존: B 이후의 semantic 데이터로 비교해야 의미. 누적 뷰/캐시 버전 관리 인프라는 이미 존재. 비교 "지표"를 정성(연구자 eyeball) vs 정량(silhouette 등) 중 무엇으로 할지 결정 필요.
- 규모: 중간(embeddingText 파라미터화 + 3캐시 생성 + 비교 UI).
- 열린 결정: ① 비교 지표(정성/정량), ② 3버전 동시 생성 트리거/저장 위치, ③ 비교 뷰 위치(/agent vs admin).

#### 요구 D. 에이전트의 사용자 이해 overall summary

- 요구: 에이전트가 사용자를 어떻게 이해하는지 하나의 종합 요약. (B의 적극적 해석이 쌓인 결과를 한 눈에 보는 payoff)
- 어디: 신규 — 생성 API + 저장(`users/{uid}/...`) + UI 표면(`/agent` 또는 리뷰). 기존 user-summary 개념 없음.
- 접근 스케치: 사용자 semantic(+episodic) 메모리를 입력으로 LLM이 1개 narrative 요약 생성. 저장 후 표시. 갱신 트리거(세션 종료 시 / 온디맨드).
- 고려·의존: B의 풍부한 semantic이 있으면 더 풍성. per-user 전역 1개 vs per-mission 누적 중 선택. 신규 프롬프트는 `prompts.ts`에 추가.
- 규모: 중간(생성+저장+UI).
- 열린 결정: ① 범위(전역 1개 vs 미션 누적), ② 갱신 시점, ③ 표시 위치, ④ 사용자에게 보일지/연구자만 볼지.

#### 우선순위 (추천)

의존: **B는 C·D의 upstream**, **A·B는 다음 데이터 수집 전 필수**(실험 셋업·데이터 성격을 바꾸므로 수집 후 변경 시 데이터 오염).

- **P0 — 다음 세션 수집 전 (둘 다 싸고 선행조건, 병렬 가능)**
  - [x] 요구 A (미션 9개): 15.64에서 구현. (옵션 선택 mechanic 제거, 유저별 랜덤 순서 + 어드민 표시로 확장됨.)
  - [x] 요구 B (semantic 적극 생성): 15.63에서 구현. (정정: `CLUSTERING_METHOD_VERSION` bump 불필요 — B는 clustering 입력/방법이 아니라 메모리 데이터만 바꾸고, cluster 캐시 키의 item signature가 데이터 변경 시 자동 재생성을 트리거함.)
- **P1 — 사용자 이해 요약**
  - 요구 D: B의 payoff(재미/insight), 사용자 친화 기능. 중간 규모.
- **P2 — clustering 비교 분석 도구**
  - [x] 요구 C: 15.86에서 `/agent` 본인 memory 화면의 3가지 clustering input variant 비교로 구현. admin 전용 분석이 아니라 팀원 공개 테스트 컨트롤로 제공.

근거: A는 실험 자체를 돌리기 위한 선행조건, B는 5분짜리 프롬프트 변경이지만 C·D가 먹는 데이터 성격을 바꾸므로 같은 P0에서 함께 처리. D는 B의 결과를 사용자에게 바로 보여주는 기능이라 P1. C는 가장 빌드가 크고(3버전 파라미터화+비교 UI) 누적 데이터가 쌓여야 비교가 의미 있어 P2.

### 15.63 semantic memory 적극 생성 + 해석 신뢰도(interpretationConfidence) `[implemented 2026-06-11]`

- 요구(15.62-B): 보수적으로 null 가능하던 semantic을 매 interaction마다 1개 무조건 생성하도록 전환. 과해석 허용(사용자에 대한 대담한 해석 가설). 단 과해석 추적을 위해 신뢰도 표식을 함께 남김(열린 결정 → "추적 표식 포함" 선택).
- 프롬프트 (`src/lib/prompts.ts` `MEMORY_ENCODE_PROMPT`):
  - "Semantic Interpretation (active)" 섹션 추가: 항상 정확히 1개 semantic 생성(null 금지), 근거가 약해도 구체적 해석 가설을 commit, strictly proven 넘어서는 speculative reading 허용·장려.
  - 출력에 `interpretationConfidence`(0.0–1.0) 추가: 0.8–1.0 명확히 지지 / 0.4–0.7 부분적 추론 / 0.0–0.3 speculative 과해석.
  - 기존 보수 규칙("clearly supported only", "Do NOT force or fabricate", "Return null …") 제거. semantic은 paraphrase 금지(사용자에 대한 해석이어야 함) 규칙만 유지.
  - PROFILE_MEMORY_ENCODE_PROMPT(before-session)는 변경 안 함 — 요구는 interaction 한정.
- 데이터 관통:
  - `memory/drafts/route.ts`: `EncodedMemory`에 `interpretationConfidence` 추가, `parseMemory`가 `clamp01`로 0~1 정규화(semantic 없으면 null), draft 문서에 `interpretationConfidence` 저장.
  - `memory/complete-session/route.ts`: draft → promoted memory(`memories_0_1_2`)로 `interpretationConfidence` 승계.
  - `memory/session-summary/route.ts`: `compactMemory`/`compactGraphMemory`에 필드 추가.
  - `memory/all/route.ts`(/agent): 응답에 필드 추가.
- 타입/UI:
  - `memory-cluster-types.ts`: `MemoryItem`/`ClusterGraphItem`에 `interpretationConfidence?: number | null` 추가.
  - `main/[missionId]/page.tsx`: `SessionMemoryItem` 타입 + graphItems(ClusterGraphItem) + sidePanelMemories(MemoryItem) 매핑에 필드 전달.
  - `agent/page.tsx`: clusterItems 매핑에 필드 전달.
  - `memory-cluster-side-panel.tsx`: 선택 노드의 Semantic 필드 아래에 신뢰도 배지(`interpretationTier`): ≥0.8 "해석 근거 강함"(emerald) / ≥0.4 "해석 추론"(amber) / <0.4 "과해석"(rose). /agent·세션 리뷰 공유.
  - admin 경로는 필드가 optional이라 미표시여도 무해(후속 시 추가 가능).
- 정정: 15.62에 적었던 `CLUSTERING_METHOD_VERSION` bump은 불필요(데이터만 바뀌고 cluster 캐시 키 item signature가 자동 재생성 트리거).
- 검증: `./node_modules/.bin/tsc --noEmit` 통과. 라이브에서 신규 interaction이 항상 semantic + confidence를 갖는지, 리뷰/agent 패널에 신뢰도 배지가 뜨는지 확인 권장. 기존(필드 없는) 메모리는 배지 미표시(graceful).
- 후속: 과해석이 실제로 유용한 insight를 주는지 관찰 후, 필요하면 retrieval/clustering에서 저신뢰 semantic 가중 조정 검토(현재는 동일 취급).

### 15.64 미션 옵션 선택 제거 + 9개 단독 미션 + 유저별 랜덤 순서 `[implemented 2026-06-11]`

- 요구(15.62-A): "3옵션 중 1개 선택" 구조를 옵션별 단독 미션으로 쪼개 온보딩 제외 9개 세션. 옵션 선택 mechanic 제거. + (확장) 미션 순서를 유저별 랜덤으로, 어드민에서 유저별 순서 확인.
- 데이터:
  - `scripts/create_split_missions.py`: 기존 3미션×3옵션을 9개 단독 미션으로 생성. 제목 "과제 · 브랜드"(예: "스타트업 랜딩페이지 디자인 · 🌙 Zzzly"), description=상위 미션 brief, device/duration 상속, `options`는 원본 옵션 1개 유지(콘텐츠 플러밍 재사용). id는 순서 중립(`mission-20260611-GNN001`).
  - 기존 3개 옵션 미션은 `exports/old-missions-backup/`에 백업 후 삭제. `missions` 컬렉션엔 9개만 남김.
- 옵션 선택 화면 제거 (`main/[missionId]/page.tsx`):
  - 선택 화면 게이트 `missionOptions.length > 0` → `> 1`. 옵션 1개 미션은 선택 화면 자동 스킵, `activeOption`은 옵션 1개면 자동 해석(line 2622)되어 콘텐츠 주입 그대로 동작.
  - 단일 옵션 자동 선택 effect 추가(어떤 페르소나였는지 세션에 기록): 미션 컨텍스트 준비 + 세션 로드 완료 + 미시작 시 `chooseMissionOption(options[0])` 1회(ref 가드).
- 유저별 랜덤 미션 순서:
  - 저장: `users/{uid}.missionOrder: string[]`(9개 미션 id).
  - 할당: `GET /api/users/me`의 `resolveMissionOrder` — 저장된 순서가 있으면 유지(현존 미션만 필터), 새 미션은 셔플 append, 변경 시에만 patch. 최초 1회 셔플로 고정 → 진행 중 재셔플 없음. 서버 측 할당.
  - 로비(`lobby/page.tsx`): `/api/users/me`의 missionOrder로 미션 정렬(없으면 createdAt fallback). 온보딩은 항상 맨 앞.
- 누적 메모리 뷰 수정(15.59 가정 변경):
  - 순서가 유저별이라 mission-id 시간순 누적이 깨짐. `isWithinCumulative`를 missionOrder 배열 인덱스 비교로 변경(onboarding은 항상 base; 순서 미해석/선택 미션 부재 시 onboarding+동일 미션만 fallback). 기존 `missionOrderKey`(문자열 비교) 제거.
  - missionOrder 전달 경로: `POST /api/memory/session-summary`가 `users/{targetUid}.missionOrder`를 응답에 포함(서버 admin 토큰으로 대상 유저 doc 읽음) → main page `SessionMemorySummary.missionOrder`로 수신 → `cumulativeGraphMemories`가 사용.
- 어드민 표시:
  - `GET /api/admin/users`가 각 유저 `missionOrder` 반환. `AdminUser` 타입 + `upsertUser`에 필드 추가.
  - 유저 카드에 "미션 순서 (유저별 랜덤)" 번호 매긴 시퀀스 표시(`missionTitle(id)`로 제목 매핑).
- 신규/수정 스크립트: `scripts/create_split_missions.py`(신규), `scripts/backup_users.py`(신규, 이전 단계), `scripts/wipe_users.py`(신규, 이전 단계), `scripts/export_stitch_html.mjs`(env 경로 오버라이드).
- 검증: `./node_modules/.bin/tsc --noEmit` 통과. 라이브에서 ① 로비가 유저별 순서로 9개 표시, ② 미션 진입 시 선택 화면 없이 바로 시작, ③ 어드민 카드에 순서 노출, ④ 리뷰 누적 뷰가 유저 순서 기준 누적 재확인 권장.
- 한계/후속: missionOrder 할당은 로비(`/api/users/me`) 최초 진입 시 — 로비를 거치지 않고 바로 세션 진입하면 미할당일 수 있음(현 플로우상 로비 경유). 온보딩은 `missions` 컬렉션 밖 합성 미션이라 순서에서 제외(항상 base).

### 15.65 미션 선형 진행 게이팅 (순차 잠금) `[implemented 2026-06-11]`

- 요구: 미션을 순서대로만 진행하도록 강제하되, 온보딩 미완료 시 배너 난사 대신 사용자 친화적으로. 결정: ① 완료 미션 재실행 차단(리뷰만), ② 엄격 선형(첫 미완료 1개만 해제).
- 설계: 배너 제거 → 카드 상태가 유일한 정보원인 "선형 경로" 모델. 온보딩=0단계로 같은 경로에 포함.
- 카드 상태 (`components/lobby/mission-card.tsx`):
  - 완료: 체크 아이콘 + "리뷰 보기"만 노출(재실행 버튼 제거 → 선형 누적 데이터 오염 방지).
  - 지금 진행(current): 첫 미완료 1개. accent 보더 + ring 강조 + "시작" CTA.
  - 잠금: 자물쇠 아이콘 + opacity 낮춤 + 카드에 잠금 이유 상시 노출 + 클릭 시 토스트(내비게이션 X). 이유: 온보딩 미완료면 "온보딩 완료 후 진행 가능", 아니면 "이전 미션 완료 후 진행 가능".
  - `isOnboardingRequired` per-card amber 배너 제거. `MissionCard` props 변경: `isCurrent`/`lockReason`/`onLockedClick` 추가, `isOnboardingRequired` 제거.
- 선형 상태 계산 (`lobby/page.tsx`):
  - 경로 = `[onboarding, ...유저순서 미션]`. 완료 판정: 온보딩 → `!isOnboardingRequired`, 일반 → `progress.status==="completed"`.
  - `currentMissionIndex` = 첫 미완료 인덱스(온보딩 상태 확인 중이면 -1로 전부 잠금). `index > current` = 잠금. 완료 미션은 잠기지 않음(리뷰 가능).
  - 헤더 amber 배너 제거. "미션 목록" 우측에 "완료 X / 전체 Y · 순서대로 진행" 진행도 표시.
  - 잠긴 카드 클릭 → `toast.info(lockReason)` (sonner, 전역 Toaster 마운트됨).
- 연구 타당성: 순차 강제는 UX뿐 아니라 15.64 누적 메모리 설계("유저 순서대로 수행" 전제)의 데이터 정합성도 보장(순서 건너뛰기 시 "N까지 누적" 왜곡 방지).
- 검증: `./node_modules/.bin/tsc --noEmit` 통과. 라이브에서 온보딩 미완료 시 미션 전부 잠금+온보딩 강조, 미션 순차 해제, 완료 카드 리뷰 전용, 잠긴 카드 클릭 토스트 재확인 권장.
- 한계: 완료 판정은 세션 `status==="completed"` 기준(미완료 중단 세션은 current 유지). status 배지는 잠긴 카드에도 표시됨(대기 등)으로 무해.

### 15.66 로비 초기 미션 1개 플래시 수정 `[implemented 2026-06-11]`

- 문제: `/lobby` 첫 진입 시 약 1초 동안 미션 카드가 1개만 보였다가 전체 목록으로 바뀌는 플래시가 발생. `missions` Firestore 스냅샷, `/api/users/me`의 `missionOrder`/온보딩 상태, Firestore 로컬 캐시 스냅샷이 서로 다른 타이밍에 도착하면서 불완전한 경로(`[onboarding, ...missions]`)가 먼저 렌더링될 수 있었음.
- 수정 (`lobby/page.tsx`):
  - `isLobbyLoading = isMissionsLoading || isCheckingOnboarding`으로 로비 목록 렌더링 게이트를 통합. 사용자 프로필/온보딩 상태가 확정되기 전에는 카드 그리드 대신 기존 skeleton 유지.
  - `onSnapshot(q, { includeMetadataChanges: true }, ...)`로 missions 서버 스냅샷 여부를 확인하고, `snap.metadata.fromCache === false`일 때만 missions loading을 해제. 빈/부분 캐시가 먼저 들어와도 카드 1개짜리 중간 화면을 열지 않음.
  - 로딩 중 summary도 0 기준으로 유지하고, 미션 목록 우측 문구는 "미션 불러오는 중"으로 표시.
  - `missionOrder` 정렬에서 양쪽 모두 order에 없는 경우 `Infinity - Infinity`가 `NaN`이 되므로, 이때 `createdAt` fallback으로 안정 정렬.
- 검증: `./node_modules/.bin/eslint src/app/lobby/page.tsx` 통과. 라이브에서 최초 진입/새로고침 시 skeleton 이후 전체 미션 목록이 한 번에 표시되는지 재확인 권장.

### 15.67 세션 setup 1단계 미션 읽기 분리 `[implemented 2026-06-13]`

- 배경: 15.64에서 미션 선택 mechanic이 사라져 단일 옵션 미션이 자동 선택되면서, 일반 미션 진입 시 첫 화면이 바로 "정보 입력"으로 보이는 상태가 됨. QA Note 요청: "미션 선택 없어졌다 보니 1번을 그냥 미션 읽기 같은 거로 하고 에이전트가 알아야 할 것들 따로 분리".
- 구현:
  - `SessionSetupStepper`의 1단계 라벨을 "미션 선택"에서 "미션 읽기"로 변경하고, 2단계 라벨을 "사전 정보"로 변경.
  - `main/[missionId]/page.tsx`의 setup state를 `profileStep: 1 | 2 | 3`으로 확장. 단일 옵션 자동 선택은 유지하되, 자동 선택 후에도 일반 미션은 1단계 미션 요약 화면에 머문다.
  - 1단계 화면은 `SetupMissionSummaryCard`만 표시하고, 다음 버튼으로 2단계 `ProfileInputCard`("에이전트가 미리 알아야 할 것들")로 이동한다.
  - 2단계 뒤로가기는 단일 옵션 미션에서는 1단계로 돌아가고, 다중 옵션 미션에서는 선택 상태를 해제한 뒤 1단계로 돌아간다.
- 온보딩: 기존 15.61 정책 유지. 온보딩은 before-session memory를 만들지 않으므로 정보 입력 단계를 숨기고, 선택 후 바로 세션 시작 단계로 간다.
- 검증: `npm run lint -- 'src/app/main/[missionId]/page.tsx' src/components/session/session-setup-stepper.tsx` 및 `./node_modules/.bin/tsc --noEmit` 통과.

### 15.68 레퍼런스 목적 분류 + OpenAI URL hallucination 차단 `[stale 2026-06-15 → 15.74: 검색 품질 저하로 search engine 변경 rollback]`

- 범위: "편향된 3개"를 줄이는 balancing/slotting 개선은 제외. 이번 변경은 ① 찾은 레퍼런스가 왜 필요한지 목적 분류 표시, ② OpenAI product 검색의 가짜 URL 차단 두 가지로 제한.
- 목적 분류:
  - `ReferenceCard` 응답에 `referencePurpose`/`referencePurposeLabel` 추가.
  - 라벨은 `비주얼 참고`, `구조 참고`, `콘텐츠 참고` 3종. domain과 title/description/rationale의 style/layout/product 신호로 route에서 추론.
  - 카드 UI에 purpose badge를 표시하고, same-mission reference preference context와 reference memory detail에도 purpose를 포함.
- URL 검증:
  - product mode의 OpenAI web search 결과는 Responses API의 `url_citation` annotation URL만 카드 후보로 사용.
  - 모델이 JSON에 쓴 URL은 citation URL과 canonical match될 때만 title/description/rationale 보강용으로 사용. citation이 없으면 빈 결과로 처리하고 Serper fallback으로 넘어감.
  - citation URL의 `utm_*` 등 tracking parameter는 카드 저장 전 제거.
- 프롬프트:
  - `referenceProductSearchPrompt`를 JSON-only에서 citation-first numbered list로 변경. JSON은 보조 enrichment로만 허용.
- 검증:
  - `npm run lint -- src/app/api/references/route.ts src/components/session/reference-card.tsx 'src/app/main/[missionId]/page.tsx' src/lib/prompts.ts` 통과(기존 warning만 유지).
  - `./node_modules/.bin/tsc --noEmit` 통과.
  - 로컬 `/api/references`에 `wine mobile app onboarding UI references` 요청 시 App Store의 실제 와인 앱 URL 3개가 반환되고, 각 카드에 `콘텐츠 참고` 라벨이 붙는 것을 확인.

### 15.69 스타일 요청 분기 우선순위 + 선택 이유 중복 수정 `[stale 2026-06-15 → 15.74: 검색 품질 저하로 mode override와 fallback rationale 변경 rollback]`

- 문제:
  - 사용자가 "디자인 스타일을 정해보려고 하는데 레퍼런스 찾아줘"라고 요청했는데, mission/option context의 앱·서비스·제품 신호가 섞이면서 product mode로 분기되어 콘텐츠 관련 앱/서비스 레퍼런스가 반환됨.
  - OpenAI product citation 결과가 JSON 보강 없이 내려오면 모든 카드의 rationale이 동일한 fallback 문장으로 표시됨.
- 수정:
  - `inferReferenceMode()`에서 현재 사용자 요청의 explicit style signal(`디자인 스타일`, `무드`, `색감`, `톤앤매너`, `typography` 등)을 mission context보다 먼저 판단. 단, `구조 참고`/layout/section structure 요청은 product 우선 유지.
  - style mode 카드의 purpose는 `비주얼 참고`로 고정해, style 요청에서 layout/case-study 단어 때문에 `구조 참고`로 오분류되는 일을 줄임.
  - fallback description/rationale 생성 함수를 추가해 source domain/title/mode에 따라 카드별 선택 이유를 다르게 생성.
- 검증:
  - `npm run lint -- src/app/api/references/route.ts` 통과.
  - `./node_modules/.bin/tsc --noEmit` 통과.
  - 로컬 `/api/references`에 동일 스타일 요청을 보내 `mode: style`과 서로 다른 rationale이 반환되는 것을 확인.

### 15.70 레퍼런스 검색 중 상태 가시성 개선 `[stale 2026-06-15 → 15.71: Reference 섹션 배너 대신 chat bubble 로딩으로 변경]`

- 문제: 채팅에는 "레퍼런스 검색 요청됨" 상태가 잘 보이지만, 실제 검색 대기 중 상태는 Reference 섹션 헤더 오른쪽에 작은 회색 텍스트로만 표시되어 놓치기 쉬웠음.
- 수정:
  - `ReferenceSection`의 검색 중 표시를 작은 회색 텍스트에서 emerald 계열 강조 배지로 변경.
  - 검색 중일 때 섹션 상단에 "디자인 레퍼런스를 찾고 있어요" 상태 배너와 진행 bar를 표시.
  - `Loader2`, `Search` lucide icon으로 상태를 더 빨리 인지할 수 있게 함.
- 검증: `npm run lint -- src/components/session/reference-section.tsx` 통과.

### 15.71 레퍼런스 검색 로딩 위치를 chat bubble로 이동 `[implemented 2026-06-15]`

- 문제: 15.70의 Reference 섹션 강조 배지/상태 배너는 화면 비중이 크고, 사용자가 검색을 요청한 채팅 맥락과 떨어져 보여 어색했음.
- 수정:
  - `ReferenceSection`의 검색 중 강조 배지와 상태 배너 제거. 검색 중일 때 빈 상태 안내가 뜨지 않도록 `fetching` prop은 유지.
  - 레퍼런스 검색을 트리거한 assistant message id를 `referenceLoadingMessageId`로 추적.
  - 해당 `ChatBubble` 안에 `Loader2` 아이콘과 `레퍼런스 검색 중...` pill을 표시하고, 검색 완료 후 자동 제거.
- 검증:
  - `npm run lint -- src/components/session/reference-section.tsx src/components/session/chat-bubble.tsx 'src/app/main/[missionId]/page.tsx'` 통과(기존 warning만 유지).

### 15.72 레퍼런스 배지 색상 의미 정리 `[partially stale 2026-06-15 → 15.74: purpose badge는 현행 API에서 내려오지 않음, chat loading 색상만 유지]`

- 문제: 레퍼런스 검색 중 pill과 `콘텐츠 참고` 같은 purpose badge가 emerald/green 계열이라 성공·완료 상태처럼 읽힘.
- 수정:
  - chat bubble의 `레퍼런스 검색 중...` pill은 진행 중 상태로 보이도록 indigo 계열로 변경.
  - Reference card의 purpose badge(`비주얼 참고`, `구조 참고`, `콘텐츠 참고`)는 성공 상태가 아니라 분류 메타 정보이므로 slate 계열로 변경.
- 검증: `npm run lint -- src/components/session/chat-bubble.tsx src/components/session/reference-card.tsx` 통과.

### 15.73 레퍼런스 카드 중복 모드 배지 제거 `[implemented 2026-06-15]`

- 문제: 카드에 `콘텐츠 참고`와 `product`, 또는 `비주얼 참고`와 `style`이 함께 표시되어 사용자가 같은 의미의 배지로 읽을 수 있었음.
- 수정:
  - UI에서는 목적 분류 badge(`비주얼 참고`, `구조 참고`, `콘텐츠 참고`)만 표시.
  - 내부 `referenceMode`(`style`/`product`)는 검색 파이프라인, preference context, memory 기록용 데이터로 유지하되 카드 배지로는 숨김.
- 검증: `npm run lint -- src/components/session/reference-card.tsx` 통과.

### 15.74 레퍼런스 검색 엔진 rollback `[implemented 2026-06-15]`

- 문제: 15.68~15.69 이후 실제 인터랙션에서 `Chop Dawg`, `Justinmind`처럼 현재 스타일과 동떨어진 결과가 들어와 검색 품질이 이전보다 나빠짐.
- 결정: search engine 쪽 변경은 안정성이 떨어지므로 이전 동작으로 rollback. 단, chat bubble loading, mode badge 숨김 같은 UI 정리는 유지.
- 수정:
  - `src/app/api/references/route.ts`에서 OpenAI citation URL only product 검색, explicit style mode override, fallback rationale 생성, purpose 추론 wrapping을 제거.
  - `referenceProductSearchPrompt`를 citation-first numbered list에서 기존 JSON array 반환 방식으로 복구.
  - Reference card UI의 `style/product` 배지 숨김과 chat bubble loading은 유지.
- 결과:
  - 현행 API는 `referencePurpose`를 생성하지 않으므로 `비주얼 참고`/`콘텐츠 참고` purpose badge는 기본 검색 결과에 표시되지 않는다.
  - `referenceMode`는 내부 데이터로는 유지되지만 사용자 카드에는 표시하지 않는다.
- 검증:
  - `npm run lint -- src/app/api/references/route.ts src/lib/prompts.ts src/components/session/reference-card.tsx src/components/session/chat-bubble.tsx 'src/app/main/[missionId]/page.tsx'` 통과(기존 warning만 유지).
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.75 레퍼런스 빈 결과 메시지를 chat bubble로 이동 `[implemented 2026-06-15]`

- 문제: "새로 추가할 레퍼런스를 찾지 못했습니다. 이미 추가했거나 삭제한 사이트는 제외됩니다." 같은 상태 메시지가 Reference 섹션에 표시되어, 사용자가 요청한 chat turn과 맥락이 분리됨.
- 수정:
  - `fetchReferences()` 반환값을 `Reference[]`에서 `{ references, message }` 형태로 변경.
  - 새로 추가할 레퍼런스 없음, 조건에 맞는 레퍼런스 없음, 검색 실패 메시지를 assistant bubble의 `### 레퍼런스 검색 결과` 섹션에 append.
  - 성공 결과가 있을 때만 기존 `### 레퍼런스 선택 이유`와 memory draft encoding을 수행.
- 검증:
  - `npm run lint -- 'src/app/main/[missionId]/page.tsx' src/components/session/reference-section.tsx` 통과(기존 warning만 유지).
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.76 목업 readiness 질문에서 자동 생성 방지 `[implemented 2026-06-15]`

- 문제: 사용자가 "목업 만들기에 충분한 정보가 있니?"처럼 가능 여부만 질문했는데, assistant가 조건부 제안("필요하면...")을 action alias 형태로 출력해 실제 목업 생성이 시작될 수 있었음.
- 원인:
  - prompt가 readiness/capability 질문을 `answer`로 고정하라는 규칙이 약했음.
  - `normalizeActionBlockAliases()`가 `[생성 요청]`, `[목업 생성 요청]`을 실행 가능한 `[GENERATE_MOCKUP]`으로 변환하므로, 조건부 제안이 command로 승격될 수 있었음.
- 수정:
  - `CHAT_MOCKUP_GENERATE_ACTION_PROMPT`: "충분한 정보인가/가능한가/준비됐나/무엇이 필요한가" 질문에는 `[GENERATE_MOCKUP]`을 쓰지 말고 plain answer만 하도록 명시.
  - `chatPlannerPrompt`: readiness/capability 질문은 `generate_mockup`이 아니라 `answer` intent로 분류하도록 명시.
  - `main/[missionId]/page.tsx`: `isMockupReadinessQuestion()` runtime guard 추가. 현재 user text가 readiness 질문이면 모델이 `[GENERATE_MOCKUP]`/`[EDIT_MOCKUP]`을 출력해도 실행하지 않음.
  - 차단 시 `stripMockupActionBlocks()`로 action chip을 제거하고, "목업은 아직 생성하지 않았습니다..." 안내를 chat bubble에 남김.
- 검증:
  - `npm run lint -- 'src/app/main/[missionId]/page.tsx' src/lib/prompts.ts` 통과(기존 warning만 유지).
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.77 선택 요소 기반 목업 편집 컨텍스트 강제 `[implemented 2026-06-15]`

- 문제: 사용자가 목업 캔버스에서 요소를 선택한 뒤 "이거 크게", "색 바꿔", "문구 수정"처럼 짧게 요청하면, planner가 `selectedElement`/`mockupHtml` 컨텍스트 필요성을 놓치거나 `edit_mockup` intent로 분류하지 못해 선택 편집이 일반 답변 또는 전체 목업 편집처럼 동작할 수 있었음.
- 수정:
  - `/api/chat`의 `forceIntentFromUserText()`에 선택 요소 + 현재 목업 + 편집성 키워드 조합을 감지하는 deterministic guard 추가.
  - 조건에 맞으면 intent를 `edit_mockup`으로 강제하고, `mission`, `activeIdea`, `designSpec`, `mockupHtml`, `selectedElement` 컨텍스트를 켠다.
  - `shouldIncludePlannedContext()`에서 selectedElement가 있으면 reliable planner가 false를 내려도 `selectedElement`와 `mockupHtml`을 반드시 포함한다.
  - "뭐야/왜/가능/충분" 같은 질문형 요청은 편집 강제에서 제외하되, 한국어 명령형 질문에 흔한 물음표만으로는 제외하지 않는다.
- 검증:
  - `npm run lint -- src/app/api/chat/route.ts` 통과.
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.78 편집 모드 토글 시 목업 iframe 깜빡임 제거 `[implemented 2026-06-15]`

- 문제: 목업 toolbar의 편집 버튼을 누르면 캔버스의 목업이 잠깐 사라졌다가 다시 보였음.
- 원인:
  - `renderMockupCanvas()`가 `editMode`일 때만 `injectSelectionScript()`를 적용했다.
  - 편집 모드 토글마다 iframe `srcDoc` 문자열이 바뀌어 브라우저가 iframe 문서를 reload했고, 그 순간 빈 화면이 보였음.
- 수정:
  - `injectSelectionScript()`를 항상 적용해 `editMode` 토글로 `srcDoc`이 바뀌지 않게 함.
  - 실제 편집 가능 여부는 기존처럼 iframe `pointerEvents`로 제어.
  - parent가 iframe refs를 보관하고, 선택 해제/편집 Off/캔버스 빈 영역 클릭 시 `vda-clear-selection` postMessage를 보내 iframe 내부 `data-vda-selected` outline을 제거.
  - iframe selection script에 `vda-clear-selection` message listener와 공용 `clearVdaSelection()` 추가.
- 검증:
  - `npm run lint -- 'src/app/main/[missionId]/page.tsx' src/lib/session/mockup-html.ts` 통과(기존 warning만 유지).
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.79 목업 수정 pending 응답과 새 Stitch screen 처리 `[implemented 2026-06-15]`

- 문제: 목업 수정 요청 후 로딩은 떴지만 수정된 화면이 보이지 않거나 화면이 빈 것처럼 보일 수 있었음. Stitch 로그에는 새 screen이 생성됐는데 canvas에는 나타나지 않는 케이스도 포함.
- 원인:
  - `/api/stitch`가 `htmlPending: true`와 빈 `html`을 반환하면, edit branch가 기존 artboard HTML을 즉시 빈 문자열로 덮어썼음.
  - edit 요청 대상은 요청 직전에 계산했지만, 응답 후 업데이트 대상은 다시 `activeArtboardId ?? last`로 계산해 비동기 중 active artboard가 바뀌면 다른 board를 업데이트할 여지가 있었음.
  - Stitch `edit_screens`가 기존 screen을 mutate하지 않고 새 screen을 생성하는 경우가 있는데, 클라이언트는 edit 결과를 항상 기존 artboard 덮어쓰기로만 처리했음.
- 수정:
  - edit 요청 시작 시 `editTargetBoard`, `editTargetId`, `editScreenId`를 고정.
  - edit 응답이 pending이면 기존 HTML을 유지하고, lazy `/api/stitch/html` fetch가 실제 HTML을 반환할 때만 교체.
  - lazy fetch 성공 시 `htmlUpdatedAt`도 갱신해 iframe이 새 HTML을 확실히 렌더링하게 함.
  - edit 응답의 `screenId`가 요청한 `editScreenId`와 다르면 새 screen 생성으로 보고 새 artboard를 추가한 뒤 active artboard로 전환. pending이면 우선 기존 target HTML을 임시로 보여주고 lazy fetch 완료 시 새 HTML로 교체.
- 검증:
  - `npm run lint -- 'src/app/main/[missionId]/page.tsx'` 통과(기존 warning만 유지).
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.80 선택 요소 citation 전송 후 선택 상태 해제 `[implemented 2026-06-15]`

- 문제: 선택된 목업 요소를 인용해 chat에 보낸 뒤에도 입력창과 캔버스 outline에 선택 상태가 남아 다음 메시지까지 같은 요소가 계속 인용될 수 있었음.
- 수정:
  - `sendMessage()`에서 `userMsg.citedElement`와 memory input을 만든 뒤, UI state의 `selectedElement`를 비운다.
  - iframe 내부 `data-vda-selected` outline도 `vda-clear-selection` postMessage로 함께 제거한다.
  - `clearIframeSelections`/`clearSelectedElement` helper를 `sendMessage`보다 앞에 배치해 전송 흐름과 toolbar/chat input 해제가 같은 동작을 공유하게 함.
- 검증:
  - `npm run lint -- 'src/app/main/[missionId]/page.tsx'` 통과(기존 warning만 유지).
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.81 레퍼런스→목업 외형 충실도: 이미지 주도 생성 설계 `[Phase 1·2 구현·검증 2026-06-15 — 서버 isImageLed(첨부+URL 캡처) end-to-end 검증 + Phase 1 GUI 사용자 확인]`

- 배경/문제: 사용자가 레퍼런스의 디자인 스타일을 좋아한다고 해도, 현재는 레퍼런스가 채팅 모델에 텍스트(제목/URL/브랜드 사전지식)로만 들어가 design.md를 작문한다 — 레퍼런스 이미지가 픽셀로 모델에 들어가지 않고, 카드의 imageUrl도 og:image라 사용자가 실제로 본 페이지와 다르다. 그 결과 흰색 에디토리얼 레퍼런스가 "딥 차콜/블랙" 스타일로 반전됐고, Stitch는 그 스타일을 충실히 다크로 생성했다. 즉 생성기는 정상이고 오염은 상류 reference→design.md 단계.

- 사실 확인 (`@google/stitch-sdk` 0.3.5 = 최신, 코드/타입에서 확인):
  - design.md 직접 전달 가능 — `DesignTheme.designMd` 1급 필드. 이미 `applyDesignSystem`이 `theme.designMd`로 넘김. design system 계약은 앱이 쓰는 5토큰보다 풍부(`backgroundLight/Dark`, `namedColors`, `overridePrimaryColor` 등) — 5토큰은 앱이 스스로 좁힌 것이지 Stitch 한계가 아님.
  - 이미지 업로드 가능 — `project.upload(filePath)` (private REST `BatchCreateScreens`; MCP 툴 아님). png/jpg/webp/html. 단 업로드만으론 IMAGE 스크린만 생기고 getHtml은 빈값. image→UI 재구성은 업로드한 스크린에 `screen.edit(...)`를 호출해야 일어남.
  - 경험적 검증(2026-06-15): 의도적으로 만든 흰 배경·2열 상품 리스트 PNG를 upload→edit 했더니 `bg-white`/`#ffffff`·라이트그레이 카드·상단만 black bar로 명도 반전 없이 재구성, 콘텐츠(New Arrivals/Represent/Filters/가격)도 보존. → upload+edit가 image-to-UI 다리임을 확인.

- 설계 (이미지 주도 생성 경로를 기존 텍스트 경로 옆 가지로 추가, 전면 교체 아님):
  - 캡처 소스 2종(결정): (1) 사용자 첨부 이미지, (2) URL이면 서버가 그 페이지를 자동 스크린샷. 둘 다 있으면 첨부 우선. 레퍼런스 카드 og:image는 스타일 소스로 사용 금지.
  - `/api/stitch` POST에 `styleImage?`/`styleSourceUrl?` 추가. `isNew` + 이미지 있을 때: PNG 확보 → `os.tmpdir` 임시저장 → `project.upload` → `imgScreen.edit(제품/UX 프롬프트 + 가드레일[배경 밝기 반전 금지·팔레트/레이아웃/타입/밀도 보존] + device)` → 기존 `waitForScreenHtml`/202/lazy 재사용해 html 반환. 이 경로에선 edit 전에 낡은 design.md를 적용하지 않음(그림과 충돌 방지).
  - 글(design.md) 처리(결정): 레퍼런스가 아니라 재구성된(올바른) 결과에서 design.md/토큰을 추출해 design system 적용하고 클라에 `derivedDesignStyle`로 반환 → 활성 시안 designStyle에 저장 → 이후 화면 일관성. "레퍼런스→글(틀림)"을 "올바른 결과→글"로 교체하는 게 핵심.
  - 가드레일: 업로드한 IMAGE 스크린은 artboard로 노출 금지(`allScreenIds`에서 제외), 큰 이미지는 업로드 전 다운스케일, URL 경로는 캡처한 URL을 응답에 포함(사용자 확인용).

- 역할 분담: 이미지 = 레퍼런스 외형의 단일 출처. design.md/토큰 = 여러 화면 일관성 + 사용자가 말로 지정한 제약 + 참고 이미지 없는 경우. (업계 패턴인 "스크린샷→비전 생성 + 컴포넌트/테마 토큰" 하이브리드와 동형.)

- 빌드 순서:
  - Phase 1 (외부 인프라 0): 사용자 첨부 → upload→edit → artboard + 결과에서 글 추출. 오늘 버그를 끝까지 해결.
  - Phase 2(구현됨): URL 자동 스크린샷. 결정 = 캡처 엔진은 무키 Microlink로 시작하되 `captureScreenshot(url)` 함수 하나로 추상화해 나중에 매니지드 API(키)나 자체 Playwright로 교체 가능. URL 진입점은 둘 다 — 채팅 메시지 내 URL 감지 + 인용 레퍼런스의 URL. 첨부 이미지 > URL 우선순위. 응답에 `capturedUrl`을 실어 어떤 페이지를 캡처했는지 추적 가능(클라 UI 노출은 후속).

- 닿는 코드(구현 시): `src/app/main/[missionId]/page.tsx`(첨부 UI + POST 본문 + `derivedDesignStyle` 저장), `src/app/api/stitch/route.ts`(이미지 분기 + 글 추출). 구현 완료 시 1~9장(레퍼런스/디자인 스타일/목업 생성 서술)과 같은 커밋에서 동기화 필요.

- 범위 메모(중요): 이 설계는 레퍼런스 로직을 걷어내는 게 아니라 "스타일을 뽑는 소비 지점"에만 픽셀 그라운딩을 더하는 것.
  - 그대로 재사용: 레퍼런스 검색/패널(`/api/references`), 인용(`citedReferences`), keep·delete preference, 태그, URL. 카드 og:image도 패널 썸네일로는 유지. 인용은 오히려 더 중요해짐 — 어느 레퍼런스의 픽셀을 가져올지 가리키는 포인터이자 Phase 2 URL 스크린샷의 입력.
  - 바뀌는 것: 카드 og:image를 스타일의 권위 소스로는 쓰지 않음. 폐기되는 로직은 거의 없고, 스타일 의도일 때만 `chatCitedRefsWithUrlPrompt`의 "web_search로 읽어라"를 픽셀 우선으로 조정(개념/텍스트 참고 용도일 땐 유효).
- 의도별 픽셀 소스(추가 결정): "레퍼런스처럼 목업" → `GENERATE_MOCKUP` → upload→edit. "레퍼런스처럼 디자인 시스템/스타일만" → `CREATE_DESIGN_SPEC` → 올바른 스크린샷을 비전에 넣어 design.md 작성(Stitch 왕복 불필요). 후자는 Phase 1에 자동 포함 아님 — 같은 이미지 그라운딩을 `CREATE_DESIGN_SPEC` 경로에 별도 배선 필요.
- Phase 1 검증(2026-06-15): 실행 중인 dev 서버 `/api/stitch`에 라이트/다크 테스트 PNG를 직접 POST. 라이트는 `bg-white text-black`로, 다크는 다크 팔레트(seed `#0a0a0a`)로 반전 없이 재구성됨. `allScreenIds`가 업로드 IMAGE 스크린을 제외(len 1)하고, `derivedDesignStyle`가 결과 기반(seed/모드/타이포)으로 역추출됨. 잘못된 styleImage는 HTTP 500 + 명확 메시지로 처리. GUI(첨부/붙여넣기·버블·게이트 우회)는 인증 뒤라 사용자가 직접 확인.
- Phase 2 검증(2026-06-15): `/api/stitch`에 `styleSourceUrl: https://example.com`로 POST → Microlink 캡처→재구성 성공(HTTP 200), `capturedUrl` 에코, `allScreenIds` len 1, `derivedDesignStyle` seed `#f0f0f2`(example.com 실제 오프화이트 그대로). 잘못된 URL(`notaurl`, `ftp://`)은 HTTP 500 + 명확 메시지. 클라 URL 진입점(메시지/인용 레퍼런스)·게이트 우회는 코드 완료+tsc/lint 통과이나 GUI 런타임은 미구동(인증). 한계: 인용 레퍼런스 URL이 메인 페이지일 수 있어 `capturedUrl` UI 노출은 후속 권장.

### 15.82 다른 스타일 레퍼런스로 다시 만들기 → 새 시안 fork `[implemented 2026-06-15]`

- 문제: 현재 시안에 디자인 스타일이 이미 지정된 상태에서 사용자가 아예 다른 스타일 레퍼런스를 인용하고 "다시 만들어줘"라고 하면, 기존 디자인 스타일이 강한 제약으로 남아 새 레퍼런스 방향으로 충분히 변하지 않았음. 기존 스타일을 단순 교체하면 레거시 디자인 스타일 기록이 사라지는 문제도 있음.
- 정책:
  - 작은 스타일 보정은 기존 시안의 디자인 스타일을 업데이트할 수 있다.
  - "다른 스타일/무드/레퍼런스처럼 다시", "새 버전", "아예 다른 느낌"처럼 방향 전환 신호가 있고 현재 시안에 디자인 스타일이 있으면 기존 시안을 보존하고 새 시안으로 분리한다.
  - 새 시안은 기존 제품/UX brief를 복사하되, 시각 스타일은 새 레퍼런스/URL/첨부 이미지에 귀속한다.
- 구현:
  - `prompts.ts`: note/mockup/designSpec/planner prompt에 "다른 스타일 재생성은 기존 스타일 overwrite가 아니라 새 시안" 규칙 추가.
  - `/api/chat`: `forceIntentFromUserText()`가 현재 디자인 스타일이 있는 상태의 스타일/레퍼런스 기반 재생성 요청을 `generate_mockup` intent로 강제해 `create_design_spec`로만 빠지는 것을 줄임.
  - `main/[missionId]/page.tsx`: `shouldForkIdeaForStyleReference()` 휴리스틱 추가. 현재 시안에 designStyle이 있고, 사용자가 다른 스타일/무드/레퍼런스 기반 재생성을 요청하면 새 시안을 생성하고 active로 전환.
  - 모델이 `CREATE_DESIGN_SPEC`를 내면 새 시안에 붙이고, 내지 않으면 `fallbackDesignStyleFromStyleReference()`로 인용 레퍼런스/URL/첨부 이미지 기반의 최소 디자인 스타일 기록을 남김.
  - 모델이 새 note를 만들지 않고 바로 `GENERATE_MOCKUP`만 내도 runtime이 기존 제품 brief를 복사한 새 시안 shell을 만들어 목업을 거기에 생성한다.
- 검증:
  - `npm run lint -- 'src/app/main/[missionId]/page.tsx' src/app/api/chat/route.ts src/lib/prompts.ts` 통과(기존 warning만 유지).
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.83 URL 레퍼런스 캡처 viewport를 target device에 맞춤 `[implemented 2026-06-15]`

- 문제: 모바일 스크린 작업에서 URL 레퍼런스를 캡처할 때도 Microlink 기본 viewport를 사용해 데스크톱 화면 기준으로 캡처되는 문제가 있었음. 모바일 UI 레퍼런스는 breakpoint가 달라 색/레이아웃/밀도 신호가 달라질 수 있음.
- 수정:
  - `/api/stitch`의 `captureScreenshot()`에 `deviceType` 파라미터 추가.
  - `deviceType === MOBILE`이면 Microlink 요청에 `viewport.width=390`, `viewport.height=844`, `viewport.isMobile=true`, `viewport.deviceScaleFactor=3`을 전달.
  - 데스크톱은 `1280×900`, `isMobile=false`, `deviceScaleFactor=1`.
  - image-led URL 캡처 호출부에서 현재 목업 `device`로 계산한 `deviceType`을 넘김.
- 검증:
  - `npm run lint -- src/app/api/stitch/route.ts` 통과.
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.84 새 스타일 레퍼런스 fork 턴의 malformed action 보정 `[implemented 2026-06-15]`

- 문제: `https://www.bbcicecream.com/collections/mens-tops 이런 느낌 괜찮은 거 같은데 아예 새로운 시안으로 다시 만들어볼래?` 턴에서 다음 문제가 동시에 발생.
  - chat bubble은 `디자인 스타일 작성 중...`으로 멈췄지만 실제 시안에는 디자인 스타일이 저장됨.
  - 노트 본문에 `제목=시안 2; 내용=# 제품 리스트 페이지 시안 노트` 같은 action payload 메타가 그대로 포함됨.
  - 새 시안의 디자인 스타일이 시안 1과 같게 저장됨.
  - 모델이 새 시안/스타일 설명만 하고 `GENERATE_MOCKUP` 액션을 내지 않아 Stitch 호출이 일어나지 않음.
- 원인:
  - `CREATE_NOTE` plain payload가 `제목=...; 내용=...` 형태일 때 note parser가 key/value를 분리하지 않고 전체를 본문으로 저장.
  - `CREATE_DESIGN_SPEC`가 JSON 완료 형태가 아니면 UI chip parser는 partial로 남지만, runtime fallback은 디자인 스타일을 저장해 UI와 데이터 상태가 어긋남.
  - "새로운 시안으로 다시 만들어볼래"처럼 생성 의도가 명확해도 모델이 `GENERATE_MOCKUP`을 누락하면 클라이언트는 목업 생성을 시작하지 않았음.
- 수정:
  - `parsePlainNotePayload()` 추가: plain `CREATE_NOTE` payload의 `제목/title`과 `내용/content/description` key를 분리해 본문에는 실제 내용만 저장.
  - `stripDesignSpecActionBlocks()` 추가: malformed `CREATE_DESIGN_SPEC` partial block을 화면에서 제거해 `디자인 스타일 작성 중...` 칩이 남지 않게 함.
  - style fork 시 모델이 기존 디자인 스타일과 동일한 내용을 내면 `fallbackDesignStyleFromStyleReference()`로 새 레퍼런스/URL/첨부 이미지 기반 스타일 기록을 대신 저장. 이미지 주도 생성이 성공하면 이후 `/api/stitch`의 `derivedDesignStyle`가 결과 기반 스타일로 다시 덮어씀.
  - `shouldAutoGenerateForkedStyleMockup`: 다른 스타일 레퍼런스로 새 시안을 다시 만드는 요청에서 모델이 `GENERATE_MOCKUP`을 누락해도 클라이언트가 새 목업 생성 action을 합성하고 Stitch를 호출.
- 검증:
  - `npm run lint -- 'src/app/main/[missionId]/page.tsx'` 통과(기존 warning만 유지).
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.85 새 스타일 fork에서 이전 시각 brief가 레퍼런스를 덮는 문제 수정 `[implemented 2026-06-15]`

- 문제: 새 시안 fork와 URL/이미지 주도 생성은 동작했지만, WTAPS 같은 밝고 성긴 상품 리스트 레퍼런스를 줘도 결과가 기존 Mixtape 시안의 다크 톤, 2열 고밀도 그리드, 스트릿 무드를 계속 따랐음.
- 원인:
  - 새 시안 shell을 만들 때 기존 아이디어 description을 거의 그대로 복사해 제품/UX 요구사항뿐 아니라 기존 시각 스타일·레이아웃·무드 제약까지 함께 들어감.
  - Stitch 이미지 재구성 prompt에서 제품/content brief가 스크린샷과 충돌할 때 어떤 쪽이 우선인지 명시가 약해, 이전 brief의 다크/2열 제약이 레퍼런스 스크린샷의 흰 배경/희소 레이아웃 신호를 누를 수 있었음.
- 수정:
  - `productBriefForStyleFork()` 추가: style fork용 새 시안 description은 기존 description에서 제품/UX 요구사항만 남기고, 비주얼/스타일/무드/톤/컬러/타이포/레이아웃/그리드/밀도/브랜드 레퍼런스 관련 줄은 제거.
  - style fork shell 생성 시 전체 description 복사 대신 `productBriefForStyleFork(activeIdea.description)`을 사용.
  - `styleImageReconstructPrompt()`에 충돌 우선순위 추가: 레이아웃, 밀도, grid columns, navigation, filter UI, card structure, background, typography, mood는 업로드된 스크린샷이 항상 우선이고, brief는 상품명/필수 필드/카테고리/미션 카피에만 사용.
- 기대 효과:
  - 새 레퍼런스가 WTAPS처럼 white background, 큰 wordmark/header, checkbox filter, item/image toggle, 1열 큰 이미지 중심이면 기존 dark/2-column 스타일보다 해당 화면 구조가 우선 반영됨.
- 검증:
  - `npm run lint -- 'src/app/main/[missionId]/page.tsx' src/lib/prompts.ts` 통과(기존 warning만 유지).
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.86 팀원 공개용 `/agent` 클러스터링 입력 3버전 비교 `[implemented 2026-06-16]`

- 배경: `클러스터링 3가지 버전 비교`는 연구자/admin만 보는 진단보다 팀원 각자가 자기 memory를 보며 어떤 묶음이 납득되는지 판단하는 실험에 가까움. 따라서 타인 memory 접근 권한을 넓히지 않고 `/agent`의 본인 memory 화면에 테스트 컨트롤로 노출.
- 입력 variant:
  - `semantic-only`: semantic insight만 embedding. legacy item은 episodic/input 등으로 fallback.
  - `compact-context`: keyword + episodic + semantic. interaction 원문 로그는 제외.
  - `full-context`: 기존 기준. keyword + episodic + semantic + originalInteractionContent + link.
- 구현:
  - `src/lib/server/memoryClustering.ts`: `ClusteringInputVariant`, `normalizeClusteringInputVariant()`, `clusteringMethodVersion()` 추가. `embeddingText()`를 variant별로 분기하고, `embedItems()`/`generateAndStoreClusters()`가 variant를 받도록 변경.
  - cluster cache id hash에 `similarity-graph-v2:{variant}`를 포함해 같은 item signature라도 variant별 결과가 공존하도록 변경. 저장 문서에는 `clusteringInputVariant`, `clusteringMethodVersion` 기록.
  - `GET /api/memory/clusters?variant=...`, `POST /api/memory/clusters { variant }` 지원. variant 미지정 시 기존 동작인 `full-context`.
  - `/agent` 상단에 `Semantic only`, `Semantic + Episode`, `Full context` segmented control 추가. 선택 시 해당 variant cache를 로드하고, 없으면 그 variant로 클러스터 생성 가능.
- 범위:
  - 이번 변경은 일반 사용자 본인 `/agent` 화면만 공개 실험으로 연다. `/admin` 타인 memory 진단 API/UI는 기존 graph clustering 경로를 유지한다.
- 검증:
  - `npm run lint -- src/app/agent/page.tsx src/app/api/memory/clusters/route.ts src/lib/server/memoryClustering.ts` 통과.
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.87 디자인 노트 → Design Brief 명칭 변경 `[implemented 2026-06-16]`

- 요청: QA Note `디자인 노트 → 디자인 브리프로 이름 바꾸기`, 이후 사용자 노출 명칭은 영어 `Design Brief`로 조정.
- 정책:
  - 사용자에게 보이는 산출물 명칭은 `Design Brief`로 통일한다.
  - 내부 action/protocol은 기존 `[CREATE_NOTE]`, `[UPDATE_NOTE]`, `note_create`, `note_update`를 유지한다. 이 값들은 chat parser, memory action, 기존 저장 데이터와 연결된 계약이므로 rename하지 않는다.
- 수정:
  - `IdeaNoteSection` 섹션 라벨과 empty state를 `Design Brief`로 변경.
  - `IdeaWorkspace` 섹션 탭 label을 `Brief`로 변경.
  - assistant action chip 문구를 `Design Brief 생성됨/작성 중/수정됨`으로 변경.
  - mockup 생성 가드와 Stitch product/UX prompt에서 `active note` 표현을 `active design brief`로 변경.
  - chat planner 진행 문구를 `Reading design brief rules...`, `Reading current design brief...`로 변경.
  - onboarding/lobby의 안내 문구에서 `노트`를 `Design Brief`로 변경.
  - LLM prompt의 산출물 개념을 `design brief`로 정리하되, 내부 명령어는 기존 action tag를 그대로 사용하도록 유지.
- 검증:
  - `npm run lint -- src/lib/session/chat-content.ts src/components/session/idea-note-section.tsx 'src/app/main/[missionId]/page.tsx' src/lib/prompts.ts src/app/api/chat/route.ts src/components/onboarding/onboarding-steps.tsx src/app/onboarding/page.tsx src/app/lobby/page.tsx` 통과.
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.88 시안 구조 제품 투어 추가 `[implemented 2026-06-16]`

- 요청: QA Note `튜토리얼 추가하기`.
- Notion 기준:
  - Intercom/Mobbin 예시처럼 실제 화면을 어둡게 깔고 특정 UI 영역을 하이라이트하는 제품 투어 형태.
  - 특히 디자인 시안 안에 Design Brief, 디자인 스타일, Mockup이 있다는 점과 시안을 여러 개 만들 수 있다는 점을 알려야 함.
  - 미션 설명, 채팅 공간, 레퍼런스 섹션, 목업 편집 버튼, Final Design 선택, 타이머와 세션 종료 버튼까지 작업 흐름으로 안내하고, 마지막에 튜토리얼 버튼 위치를 리마인드.
- 구현:
  - `SessionProductTour` 추가: 실제 시안 작업 영역을 `data-tour` target으로 찾아 spotlight overlay와 coachmark를 표시.
  - 시안이 없을 때는 미션 설명 → 채팅 공간 → 레퍼런스 → 시안 작업 공간 중심 안내 → Final Design → 타이머 → 세션 종료 → 튜토리얼 버튼 순서로 진행, 시안이 있으면 미션 설명 → 채팅 공간 → 레퍼런스 → 시안 작업 공간 → 시안 탭 → Brief/Style/Mockup → 목업 편집 버튼 → Final Design → 타이머 → 세션 종료 → 튜토리얼 버튼 순서로 진행.
  - `/main/onboarding` 작업 화면 진입 후 read-only가 아니면 자동 표시. 그 외 미션은 자동 표시하지 않고 헤더의 `튜토리얼` 버튼으로만 열 수 있음.
- 검증:
  - `npm run lint -- 'src/app/main/[missionId]/page.tsx' src/components/session/session-product-tour.tsx` 통과(기존 warning만 유지).
  - `./node_modules/.bin/tsc --noEmit` 통과.

### 15.89 미션 콘텐츠 이미지 → 목업 asset-led 생성 `[implemented 2026-06-17 — 서버/GUI 라이브 미검증]`

- 배경(QA Note "stitch 목업 만들 때 이미지 파일 추가하기"): 이커머스 상품 리스트·랜딩 같은 미션에서 목업이 placeholder 이미지 대신 실제 상품 사진/UI 캡쳐를 쓰게 하고 싶다. 스타일 참고 이미지(레퍼런스 캡쳐/사용자 캡쳐)는 이미 15.81 이미지 주도 생성으로 처리됨. 남은 건 미션이 미리 주는 "콘텐츠" 이미지.
- 결정(사용자): 어드민이 미션별로 이미지를 등록한다. Stitch `upload`로 올린 뒤 생성 프롬프트에 "이 이미지를 그대로 넣어달라"고 명시한다(스타일 재구성이 아니라 콘텐츠 보존).
- 구현:
  - 스키마: 미션 옵션에 `assetImages[{url, path, note}]` 추가. 어드민 `/admin/new`에서 Firebase Storage `mission-assets/`로 업로드 → URL/path 저장(썸네일·삭제 UI, 최대 12장). `POST /api/admin/missions`가 http(s) URL만 검증해 저장.
  - 생성: 세션에서 신규 목업(`isNew`)이고 그 턴에 스타일 이미지/URL 첨부가 없을 때 활성 옵션의 `assetImages` URL들을 `/api/stitch`로 전달. 서버 `isAssetLed` 분기가 각 asset URL과 note manifest를 `generate_screen_from_text` prompt에 넣고, Stitch가 해당 URL을 `img src`로 직접 쓰도록 지시한다. `[stale 2026-07-13 → 15.216: 이전 `fetchImageAsDataUrl` → `project.upload` → `edit_screens` 경로는 업로드된 IMAGE screen 편집이 `invalid argument`를 반환해 기본 경로에서 제거됨]`
  - 우선순위: 사용자가 그 턴에 스타일 이미지/URL을 붙이면 `isImageLed`가 우선, asset-led는 비활성.
- 한계: SDK가 generate 프롬프트에 이미지를 직접 첨부하는 API가 없어, 여러 장을 한 화면에 그대로 박는 신뢰도는 미검증(첫 이미지를 edit하는 경로). 다중 이미지 임베드 충실도는 라이브에서 튜닝 필요. Firebase Storage `mission-assets/` 쓰기 규칙이 어드민에 열려 있어야 업로드 동작. `[stale 2026-06-18 → 15.92: 클라이언트 직접 Storage 업로드 대신 admin 서버 API가 service account로 업로드/삭제]`

### 15.90 기존 미션 편집에서도 콘텐츠 이미지 관리 `[implemented 2026-06-17]`

- 문제: 15.89에서 asset-led 생성 경로는 이미 붙어 있었지만, 어드민 GUI는 신규 미션 생성 `/admin/new`에만 콘텐츠 이미지 업로드 UI가 있고 기존 미션 수정 `/admin`에는 빠져 있었다. 그래서 생성 후 자산을 보강하거나 교체할 수 없었다.
- 구현: `/admin` 편집 카드의 미션 콘텐츠 영역에 `/admin/new`와 같은 수준의 콘텐츠 이미지 섹션을 추가했다. 기존 미션에서도 이미지 업로드, 썸네일 미리보기, 삭제가 가능하고, 저장 시 `options[0].assetImages`가 그대로 Firestore에 유지된다.
- 세부:
  - `MissionOption` normalize 단계에서 `assetImages`를 정규화해 편집 상태에 포함
  - Firebase Storage `mission-assets/` 업로드 후 `{url, path}`를 편집 상태에 반영
  - 썸네일 우상단 삭제 버튼으로 Storage object와 편집 상태를 함께 정리
  - 업로드 중에는 저장 버튼과 파일 input을 잠시 막아 부분 저장 꼬임을 줄임

### 15.91 main Mission 섹션에 콘텐츠 이미지 노출 `[implemented 2026-06-17]`

- 문제: 미션 콘텐츠 이미지가 stitch asset-led 생성에는 쓰이지만, 사용자는 main 화면에서 어떤 이미지가 미션에 연결돼 있는지 확인할 수 없었다.
- 구현: `MissionBriefSection`의 선택된 옵션 펼침 영역에 콘텐츠 이미지 그리드를 추가했다. `activeOption.assetImages`를 그대로 받아 썸네일로 표시하고, 클릭하면 원본 URL을 새 탭으로 연다.
- 의도: 사용자가 목업 생성 전에 실제 상품 사진이나 UI 캡쳐가 제대로 연결돼 있는지 눈으로 확인할 수 있게 한다.
- 검증: `tsc --noEmit` 통과, 변경 파일 eslint 0 error(기존 warning만). 인증·Stitch 키 필요한 업로드/생성 end-to-end는 사용자 라이브 확인 필요.

### 15.92 미션 콘텐츠 이미지 업로드를 admin 서버 API로 우회 `[implemented 2026-06-18]`

- 문제: `/admin`/`/admin/new`가 브라우저 Firebase Storage SDK로 `mission-assets/*`에 직접 업로드해서, Storage Rules가 해당 경로 쓰기를 허용하지 않으면 admin 사용자도 `storage/unauthorized`로 막혔다.
- 수정: `POST /api/admin/mission-assets`와 `DELETE /api/admin/mission-assets` 추가. Firebase ID token으로 admin email을 확인한 뒤 service account `devstorage.full_control` 토큰으로 Storage object를 생성/삭제한다. 업로드 시 Firebase download token metadata를 붙여 기존 `firebasestorage.googleapis.com/...token=...` URL 계약을 유지한다.
- 클라이언트: 신규 미션 생성과 기존 미션 편집의 콘텐츠 이미지 업로드/삭제가 Storage SDK 직접 호출 대신 admin API를 호출한다.
- 후속 수정: file input을 비우기 전에 선택 파일을 `File[]`로 고정한다. `FileList`를 그대로 async 함수에 넘기면 `getIdToken()` 대기 중 input reset으로 목록이 비어, 파일 선택 후 아무 반응 없이 업로드가 0건으로 끝날 수 있었다.
- 검증: `npm run lint -- src/app/api/admin/mission-assets/route.ts src/app/admin/new/page.tsx src/app/admin/page.tsx` 통과(기존 admin warning만 유지), `./node_modules/.bin/tsc --noEmit` 통과. 실제 업로드 smoke test는 인증된 admin 브라우저에서 재확인 필요.

### 15.93 미션 콘텐츠 이미지 설명 manifest 추가 `[implemented 2026-06-18]`

- 문제: 어드민이 콘텐츠 이미지를 올릴 수는 있지만, 어떤 이미지가 어떤 상품/작품/인물인지 설명할 수 없어 Stitch가 이커머스 상품 사진이나 포트폴리오 작품 이미지를 서로 바꿔 쓸 위험이 있었다.
- 구현:
  - `/admin/new`와 `/admin`의 콘텐츠 이미지 카드에 설명 textarea를 추가했다. 저장 필드는 기존 `assetImages[].note`를 사용한다.
  - 신규/기존 미션 저장 시 `note`를 유지한다. main 세션에서 신규 목업 생성 시 `assetImages[{url,note}]`를 `/api/stitch`로 전달한다.
  - `/api/stitch`의 asset-led 경로가 note 목록을 `Asset 1: ...` 형태의 manifest로 만들어 `assetImageEmbedPrompt`에 포함한다. 프롬프트는 manifest를 보고 제품/인물/작품 간 이미지를 서로 바꾸지 말라고 지시한다.
- 한계: 여전히 Stitch에 이미지를 구조화된 멀티모달 배열로 직접 전달하는 API는 아니고, 업로드된 프로젝트 이미지 + 텍스트 manifest 기반이다. 정확한 상품 카드 매핑을 보장하려면 생성 후 HTML에 asset URL을 직접 주입하는 후처리가 별도 후보.

### 15.94 세션 백업 후 삭제에 장기 메모리/클러스터 포함 `[implemented 2026-06-18]`

- 문제: 관리자 사용자 카드의 `관리자 미션 기록 삭제`/`미션 기록 삭제`는 세션과 참여 기록, `memoryDrafts`, presentation Storage만 삭제하고 장기 메모리 `users/{uid}/memories_0_1_2`와 `memoryClusters`를 남겼다. 그래서 삭제 후 `/agent`의 클러스터링 화면에 과거 데이터가 계속 보였다.
- 수정: `POST /api/admin/users/[uid]/sessions`의 백업 데이터에 기존 메모리뿐 아니라 `memoryClusters`, `memoryRetrievalLogs`를 포함하고, 삭제 단계에서 `memories_0_1_2`, `memoryClusters`, `memoryRetrievalLogs`를 함께 삭제한다.
- UI: 확인 모달 설명에서 장기 메모리/클러스터 캐시도 삭제된다고 명시하고, 성공 toast에 삭제된 메모리/클러스터 개수를 표시한다.
- 의도: 이 버튼은 사용자 세션 리셋/관리자 테스트 데이터 삭제 용도이므로, `/agent`에서 보이는 장기 메모리 상태도 같이 초기화한다. 개별 미션 기록 삭제(`recordsOnly`)도 해당 미션의 `source.missionId`를 가진 장기 메모리를 삭제하고 cluster cache를 비운다. 이미 세션 문서가 지워진 경우에도 `DELETE /api/admin/users/{uid}/memory?missionId={missionId}`로 같은 cleanup을 실행할 수 있다.

### 15.95 세션 시작 전 미션 설명/이미지 설명 노출 `[implemented 2026-06-18]`

- 문제: 일반 미션의 3단계 setup 화면은 활성 옵션 brief만 보여줘서, 전체 미션 설명(`missions/{id}.description`)과 어드민이 붙인 콘텐츠 이미지 설명(`assetImages[].note`)을 사용자가 세션 시작 전에 확인할 수 없었다.
- 수정:
  - `SetupMissionSummaryCard`가 전체 미션 설명과 활성 옵션의 제공 이미지 목록을 함께 렌더한다. 이미지는 썸네일 + `note` 텍스트로 표시하고 원본 URL을 새 탭으로 열 수 있다.
  - 카드 내부 순서는 `전체 미션 설명` → `제한 시간` → `해당 옵션 brief` → `제공 이미지/설명`으로 통일한다.
  - 여러 옵션 선택 화면(`MissionOptionSelection`)도 별도 부모/콘텐츠/이미지 카드 대신 같은 `SetupMissionSummaryCard`를 재사용해 활성 preview 옵션의 콘텐츠 이미지와 설명을 보여준다.
  - `/main/[missionId]`는 setup 1/2/3단계의 요약 카드에 `parentMissionTitle`, `parentMissionBrief`, `activeOption.assetImages`를 전달한다.
- 의도: 사용자가 세션을 시작하기 전에 “이 미션이 무엇인지”와 “어떤 이미지가 어떤 상품/작품/인물인지”를 한 화면에서 확인하게 하고, 이후 asset-led Stitch 생성에서 쓰이는 manifest와 사용자가 본 정보가 어긋나지 않게 한다.

### 15.90 에이전트 능력 카탈로그 — 예시 요청 안내 `[implemented 2026-06-17]`

- 배경(QA Note "에이전트 능력 카탈로그 (예시 요청 안내)"): 사용자가 처음에 "무엇을, 어떻게 요청해야 하는지"(예: 목업을 보려면 뭐라고 입력하나)를 몰라 막힌다. 본질은 발견성 문제 — 그 능력과 표현법이 화면에 안 보인다. 기존 채팅 빈 화면 예시 칩은 (1) 첫 메시지 후 사라지고 (2) 일부만 노출하며 (3) 목업 생성 전 디자인 스타일 의존성을 안 알려줬다.
- 결정(사용자):
  - 톤은 "능력 카탈로그" — 부탁할 수 있는 것들을 보여주고 예문엔 "예:" 프리픽스로 정해진 명령어가 아님을 드러낸다(라우터는 LLM 의도 분류라 정확한 문구 불필요).
  - 노출 위치는 입력 툴바 아이콘 + 팝오버 — 대화 중에도 상시 접근, 세로 공간 상시 점유 없음. 같은 카탈로그 데이터를 빈 화면에도 펼쳐 재사용.
- 구현:
  - 신규 `ChatCapabilityCatalog`(`src/components/session/chat-capability-catalog.tsx`): 워크플로 순서 5종(레퍼런스→시안→디자인 스타일→목업 생성→요소 수정) 데이터와 리스트 UI를 한 벌로 갖고 `onPick(text)` 콜백만 받는다. 입력 툴바 팝오버와 빈 화면이 동일 렌더를 공유. 단계 번호 + 3단계 타입 램프(캡션/라벨/예문 칩)로 순서를 드러냄. 발표(presentation)는 플로우에서 제외돼 카탈로그에도 넣지 않음.
  - `ChatInput`: 이미지 첨부 아이콘 옆에 카탈로그 트리거 아이콘 추가, 클릭 시 입력창 위로 팝오버(우상단 X 닫기 버튼 + 바깥 클릭 닫힘). 항목/예문 클릭 → 입력창에 텍스트 채우고 포커스(자동 전송 안 함). `readOnly`면 트리거 숨김. 새 prop `onPickCatalogExample`.
  - `page.tsx`: 채팅 빈 화면의 인라인 예시 칩 배열을 카탈로그 펼침형으로 교체(기존 `setInputText` 패턴 유지). 목업 생성 항목엔 "디자인 스타일 먼저 필요" 의존성 노트 표기.
  - 색상 slate/indigo/violet 유지.
  - 위치 논의 결론: 카탈로그는 헤더 튜토리얼 버튼 옆이 아니라 입력 툴바에 둔다. 근거는 동작-결과 co-location(예문 클릭 → 바로 아래 입력창이 채워짐)과 역할 분리(튜토리얼=공간 안내 1회성, 카탈로그=입력 직전 반복 참조). 대신 발견성 보완으로 프로덕트 투어에 "부탁할 수 있는 것들" 스텝 추가: `chat-capability-catalog` 버튼을 highlight(fallback `chat-panel`), EMPTY/IDEA 두 시나리오의 "채팅 공간" 다음에 삽입.
  - 입력창 레이아웃을 Claude식 세로 구조로 변경(`ChatInput`): 위는 full-width textarea, 아래 행 좌측은 ✨ 카탈로그 + 이미지 첨부 아이콘, 우측은 보내기/중단 버튼. 보내기 버튼은 "Send" 텍스트 → 원형 `ArrowUp` 아이콘 버튼(bg-slate-900)으로 교체. 색/상태(disabled, 생성 취소, 중단)는 기존 유지. 스타일 이미지 첨부 칩의 "· 이 이미지처럼 목업 생성" 안내 문구 제거(첨부 버튼 title 툴팁에는 유지).
- 검증: `./node_modules/.bin/tsc --noEmit` 통과, 변경 파일 eslint 0 error(기존 warning만).

### 15.91 채팅 패널 너비 드래그 리사이즈 `[implemented 2026-06-17]`

- 요청: 채팅 창 크기 조절.
- 구현:
  - `ChatPanel`에 `width?` prop 추가. 값이 있으면 `style.width` + `shrink-0`, 없으면 기존 `w-full max-w-md` 유지(하위 호환).
  - `page.tsx`: `chatWidth` 상태(localStorage `vda-chat-width` 영속, 범위 `CHAT_MIN_WIDTH`360~`CHAT_MAX_WIDTH`720, 기본 448=기존 max-w-md). content 섹션과 ChatPanel 사이에 `cursor-col-resize` 핸들 추가, pointer 드래그로 `window.innerWidth - clientX`를 clamp해 갱신.
  - 목업 확장 오버레이의 우측 오프셋을 고정 `md:right-112` → `md:right-[var(--chat-w,28rem)]`로 변경. `chatWidth` 변경 시 `document.documentElement`의 `--chat-w` CSS 변수를 effect로 동기화해 오버레이가 채팅 폭을 따라간다. SSR/첫 페인트는 28rem fallback.
- 검증: `tsc --noEmit` 통과, 변경 파일 eslint 0 error(기존 warning만).

### 15.92 요청 에러를 채팅에서 명시적으로 노출 `[implemented 2026-06-17]`

- 배경(QA Note "목업 생성하다가 에러가 나면 (...) 좀 더 채팅창에서 명시적으로 알려줘야할듯?", P2 Bug/UI): 에러/경고가 접히는 "처리 과정" 토글 근처 평문으로 들어가 사용자가 모르고 지나친다. 노출 방식도 경로별로 제각각이었다(레퍼런스 실패만 toast, 목업 실패는 `m.content`에 ⚠️ 평문 append, 일반 오류는 content 교체).
- 결정(사용자): 추천대로 (1) 채팅 버블에 토글과 독립된 빨간 콜아웃으로 항상 노출 + (2) 실패 시 toast 동시 발사.
- 구현:
  - `Message`/`ChatBubbleMessage`에 `error?` 필드 추가. 버블은 phase 토글/콘텐츠와 무관하게 `error`가 있으면 `role=alert` 빨간 콜아웃(TriangleAlert)을 렌더. 콘텐츠가 비어도 콜아웃이 보이도록 분기 조건에 `message.error` 포함.
  - 목업 생성/수정 실패: content append 대신 `error`에 "목업 생성 실패/목업 수정 실패: …" 설정 + `toast.error`. 사용자 취소(`wasCanceled`)는 에러가 아니라 평문 "목업 작업을 취소했습니다."로 유지.
  - 일반 요청 실패: `error`에 "요청을 처리하지 못했습니다…" + toast. 타임아웃/AbortError는 사용자 취소일 수 있어 기존대로 content 안내 메시지만(콜아웃/toast 미발사).
- 검증: `tsc --noEmit` 통과, 변경 파일 eslint 0 error(기존 warning만).

### 15.93 아이콘 라이브러리 lucide로 통일 `[implemented 2026-06-17]`

- 결정(사용자): 아이콘을 한 라이브러리로 통일. lucide 채택 — shadcn 정합성 때문(프리미티브 dialog/select/dropdown/sheet/sonner가 lucide를 import하고, `components.json` `iconLibrary: lucide`라 CLI가 컴포넌트 추가/업데이트 시 lucide를 재생성한다. phosphor로 통일하면 그 재생성과 영구 충돌). 단 lucide는 브랜드 로고를 제공하지 않으므로 `GoogleLogoIcon`(랜딩 로그인 버튼)만 phosphor 유지.
- 구현: 기존 @phosphor-icons/react 사용 14개 파일을 lucide로 교체. 이름 매핑(suffix Icon 유지) — DeviceMobile→Smartphone, PencilSimple→Pencil, UsersThree→Users, ArrowsOut→Maximize2, ArrowsIn→Minimize2, DownloadSimple→Download, MagnifyingGlassPlus/Minus→ZoomIn/ZoomOut, CornersOut→Maximize, CaretDown/Up→ChevronDown/Up, CheckCircle→CircleCheck, LockSimple→Lock, SignOut→LogOut, Trash→Trash2. phosphor 전용 prop `weight`는 lucide에 없어 제거(mission-card, user-menu).
- 컨벤션: 앞으로 신규 아이콘은 lucide에서 가져온다. 브랜드/로고가 필요한 예외만 phosphor.
- 검증: `tsc --noEmit` 통과, 변경 파일 eslint 0 error(기존 warning만). phosphor 잔존 참조는 page.tsx GoogleLogo 1건뿐임을 grep으로 확인.

### 15.96 미션 콘텐츠 이미지 업로드 포맷 제한 `[implemented 2026-06-19]`

- 문제: `/admin` 기존 미션 편집에서 콘텐츠 이미지를 업로드한 직후 썸네일이 깨져 보일 수 있었다. 기존 input/API가 `image/*`를 모두 허용해서 HEIC/HEIF처럼 업로드는 되지만 브라우저 `<img>`가 안정적으로 표시하지 못하는 포맷이 통과할 수 있었다.
- 수정: `POST /api/admin/mission-assets`가 PNG/JPG/WebP만 허용하고 그 외 image MIME은 415와 한국어 오류를 반환한다. `/admin`과 `/admin/new`의 file input accept도 같은 세 포맷으로 좁히고, 클라이언트에서 먼저 필터링해 깨진 썸네일이 생기기 전에 오류를 보여준다.
- 후속 수정: PNG도 200 업로드 후 깨지는 케이스가 있고 서버 환경에서 `firebasestorage.googleapis.com` 호출이 TLS 오류를 내서, 저장 URL을 Firebase download URL 대신 앱 프록시 `/api/mission-assets?path=...`로 바꿨다. 업로드/삭제/다운로드 프록시는 서버에서 service account로 `storage.googleapis.com`만 호출한다. 이 URL은 브라우저 썸네일과 Stitch asset-led 다운로드가 모두 이미지처럼 사용할 수 있다.
- UI 보강: `/admin` 기존 미션 편집의 콘텐츠 이미지 썸네일을 클릭하면 Dialog에서 원본 비율로 크게 볼 수 있게 했다. 삭제 버튼은 기존처럼 썸네일 우상단에 유지한다.
- 호환 보정: 예전 Firebase download URL로 저장돼 깨지는 `assetImages`도 `path`가 `mission-assets/...`이면 `/admin`과 `/main/[missionId]` 로드 시 현재 origin의 `/api/mission-assets?path=...`로 재계산한다. 기존 미션을 저장하면 보정된 URL이 Firestore에 남는다.
- 문서: 1~9장 `/admin` Current Snapshot의 콘텐츠 이미지 업로드 계약을 PNG/JPG/WebP로 갱신했다.

### 15.97 디자인 스타일 action과 Stitch 빈 아트보드 복구 `[implemented 2026-06-21]`

- 문제: 완료된 채팅 응답이 `디자인 스타일 작성 중...` chip으로 계속 남으면서 디자인 스타일이 저장되지 않고, Mockup에는 HTML이 없는 빈 화면이 표시되는 QA가 발생했다.
- 원인:
  - `CREATE_DESIGN_SPEC` chip parser는 정확한 JSON + 닫는 대괄호 형태만 완료로 봤지만 runtime parser와 모델 출력은 닫는 대괄호 누락, 일반 markdown payload, 일부 malformed JSON을 허용할 수 있어 UI와 저장 상태가 어긋났다.
  - `/api/stitch`가 `htmlPending`으로 screen metadata를 먼저 반환할 때 클라이언트가 빈 artboard를 즉시 추가하고 HTML endpoint를 한 번만 호출했다. 그 호출에서도 HTML이 준비되지 않으면 빈 iframe이 영구적으로 남았다. Firestore에는 Stitch artboard HTML을 비워 저장하므로 세션 재진입 복원도 같은 단발 조회 문제를 가졌다.
- 수정:
  - `src/lib/session/chat-content.ts`: 디자인 스타일 action도 note action과 같은 bracket/brace 균형 스캔을 사용한다. balanced JSON이면 닫는 대괄호가 없어도 완료 chip으로 수렴하고, 저장 불가능 marker가 있으면 실패 chip으로 표시한다.
  - `src/app/main/[missionId]/page.tsx`: `CREATE_DESIGN_SPEC` parser가 정상 JSON, loose JSON string field, plain markdown payload를 순서대로 복구한다. content를 얻지 못하면 사용자에게 저장 실패를 명시한다.
  - Stitch primary screen이 `htmlPending`이면 HTML 재조회가 성공한 뒤에만 artboard를 추가하며, 끝내 빈 HTML이면 생성 실패로 처리한다. 추가 screen과 저장 세션 복원도 재조회 helper를 공유한다.
  - HTML이 없는 저장 artboard는 빈 iframe을 렌더하지 않고 로딩 상태를 보이며, 재조회 실패 시 새로고침 재시도 안내를 표시한다.
- 검증: `./node_modules/.bin/tsc --noEmit` 통과. 관련 파일 ESLint 0 error, 기존 warning 7개 유지. 실제 Stitch 응답 지연을 포함한 라이브 재검증 필요.

### 15.98 한 줄 Design Brief 저장 방지 `[implemented 2026-06-21]`

- 배경(QA Note `디자인 시안 생성 관련 버그`, P2): 사용자가 디자인 시안을 요청하면 채팅 prose에는 시안 설명이 나오지만, 실제 Design Brief에는 `미션 기준 시안 작성` 같은 한 줄 작업 지시문만 저장되는 문제가 있었다. 또한 디자인 시안과 그 내부 구성 요소인 Design Brief의 계층이 화면 제목에서 충분히 분명하지 않았다.
- 원인:
  - prompt는 self-contained brief를 요구했지만 action payload가 downstream source of truth라는 점과 최소 구성 요소를 강하게 고정하지 않았다. 모델이 상세 내용을 action 밖 prose에 쓰고 `CREATE_NOTE.description`은 메타 문장으로 축약해도 클라이언트가 정상 저장했다.
  - 저장 경로에는 새 브리프의 최소 내용 품질을 확인하는 deterministic guard가 없었다.
- 수정:
  - `CHAT_NOTE_ACTION_PROMPT`: 저장되는 action payload 자체에 목표/대상 사용자, 핵심 경험, 화면·섹션 구조, 미션 필수 콘텐츠, 제약·완료 기준을 담도록 명시했다. 새 브리프는 최소 세 개의 실질 문장 또는 bullet을 가져야 하며 action 밖 prose로 대체할 수 없다.
  - `page.tsx`: `isSubstantiveDesignBrief()`가 새 `CREATE_NOTE` payload의 길이, 실질 단위 수, task-statement 패턴을 검사한다. 부족하면 `recoverThinDesignBrief()`가 현재 미션 맥락, 원래 payload, 실제 사용자 요청을 목표/필수 요구사항/시안 방향/핵심 경험/완료 기준 구조로 재조립한다. 사용자가 의도적으로 짧게 수정할 수 있도록 `UPDATE_NOTE`에는 적용하지 않는다.
  - 시안 탭과 그 아래 Design Brief/Design Style/Mockup의 포함 관계가 드러나도록 workspace 상위 제목을 `Design Workspace`에서 `디자인 시안`으로 변경했다. 제목 아래에는 세 구성 요소의 관계를 한 줄로 상시 표시하고, 좌측 섹션 라벨도 축약형 대신 `Design Brief`/`Design Style`/`Mockup`으로 통일한다. 제품 투어의 기존 `시안 안의 3가지` 단계도 같은 용어를 사용한다.
- 검증: `./node_modules/.bin/tsc --noEmit` 통과. 관련 파일 ESLint 0 error, 기존 warning 7개 유지. 실제 chat provider 응답을 포함한 라이브 재검증 필요.

### 15.99 메모리 클러스터 summary를 사용자 이해 중심으로 개선 `[implemented 2026-06-21]`

- 배경(QA Note `메모리 클러스터 summary 작성 관련`, P2): 기존 cluster summary가 `This cluster contains...`처럼 묶인 작업을 일반적으로 설명해, 실제 사용자의 성격·습관·방식·취향을 읽기 어려웠다. 화면에 `the user` 같은 익명 표현 대신 실제 이름을 쓰고 싶다는 요구도 있었다.
- 원인:
  - label prompt가 summary를 `shared pattern` 한 문장으로만 요구했고, 사람의 반복 행동·의사결정·작업 방식·디자인 취향을 우선하라는 계약이 없었다.
  - labeler 입력에 대상 사용자의 이름이 없었다.
  - 사용자 `/agent`의 공용 `memoryClustering.ts`와 admin 타인 진단 route에 labeler 구현이 중복돼 한쪽만 수정하면 화면별 결과가 달라질 수 있었다.
- 수정:
  - cluster label/summary 지시문을 `src/lib/prompts.ts`의 공용 builder로 옮기고 사용자·admin labeler가 함께 사용하게 해, 프롬프트 변경 지점을 하나로 통합했다.
  - 두 labeler 모두 `users/{uid}.displayName`을 읽어 prompt의 subject로 전달한다. 이름이 있으면 summary에서 그 이름을 자연스럽게 사용하고 `the user`/`the participant` 표현을 금지한다. 이름이 없을 때만 `this participant`를 제한적으로 허용한다.
  - summary를 1~2문장으로 확장해, cluster evidence에 근거한 성격·습관·작업 프로세스·의사결정·시각 및 UX 취향을 foreground하도록 요구한다. 반복 근거가 있을 때는 concrete evidence와 함께 recurring pattern을 쓰고, 단일·약한 cluster에서는 consistently/always를 금지한다.
  - parse 실패 fallback도 익명 generic count 문장 대신 이름과 cluster label을 포함한다.
  - clustering method version을 `similarity-graph-v3-persona-summary`로 올렸다. admin cache fallback도 같은 method version 문서만 허용하고 저장 문서에 version을 명시해 과거 generic summary cache가 재사용되지 않게 한다.
- 검증: `./node_modules/.bin/tsc --noEmit` 통과. 관련 clustering 파일 ESLint 0 error. 실제 displayName과 memory 데이터가 있는 계정에서 클러스터 재생성 후 문구 라이브 확인 필요.

### 15.100 메모리 입력 source normalization과 lazy cache `[implemented 2026-06-21]`

`[stale 2026-06-23 → 15.109: text/link/UI의 단순 텍스트 포맷과 image 전용 설명을 넘어, 모든 reference source를 interaction 맥락과 함께 선행 해석하는 단계로 교체됨]`

- 배경(QA Note `Source Normalization`): interaction input에는 text, link, image, UI result가 서로 다른 형태로 들어오지만 memory encoder는 클라이언트가 합친 문자열만 받아 첨부 이미지를 놓치고, 재처리 가능한 정규화 결과도 저장하지 않았다.
- 수정:
  - 채팅 turn에서 인용 text, reference link metadata, 선택 UI result, 첨부 image를 structured `sources` payload로 `/api/memory/drafts`에 전달한다.
  - text/link/UI는 서버에서 bounded text로 정규화하고, image가 있을 때만 vision description을 생성한다. image는 허용된 data image 형식과 5MB 이하 입력만 처리한다.
  - source fingerprint, normalization version, normalized text/types, normalized timestamp를 memory draft에 저장한다. 같은 interaction과 fingerprint가 다시 들어오면 저장된 normalization을 재사용한다.
  - normalized source context를 원본 interaction content에 포함해 memory encoding과 embedding의 근거로 쓰고, 세션 종료 시 장기 memory document에도 normalization metadata를 승격한다.
- 검증: TypeScript와 관련 파일 ESLint를 통과해야 하며, 첨부 이미지가 있는 실제 chat turn에서 draft 재호출 시 sourceNormalizedAt이 유지되는지 라이브 확인이 필요하다.

### 15.101 첨부 이미지 시각 선호를 메모리에 기록 `[implemented 2026-06-21]`

- 배경(QA Note `이미지 첨부 기반 마음에 든 디자인이 메모리에 안 들어감`): 15.100 이후 첨부 이미지는 vision description으로 메모리에 들어오지만, image normalizer는 의도적으로 선호를 추론하지 않는다. 정작 시각 선호 신호인 derivedDesignStyle(생성 결과에서 역추출한 디자인 스타일)는 idea.designStyle 상태로만 저장되고 어떤 memory draft에도 연결되지 않았다. 또한 turn의 memory draft는 채팅 스트림 완료 시점에 만들어지는데 derivedDesignStyle는 그 뒤 목업 생성에서 나와 타이밍도 어긋났다.
- 수정:
  - 첨부 이미지가 주도한 신규 목업 생성이 성공해 derivedDesignStyle가 나오면, 그 스타일을 `style-image-preference-{turnId}` interactionId로 별도 memory draft에 기록한다.
  - draft route의 category 추론에 `style-image-preference-` 접두사 → `style_image_preference`를 추가한다.
  - input에는 이번 턴에 스타일 참고 이미지를 첨부했다는 사실과 사용자 요청을 담고, 이번 미션/시안 맥락의 session-scoped evidence로만 기록하며 단일 첨부를 전역 취향으로 단정하지 말라는 지시를 포함한다. output에는 도출된 디자인 스타일 요지를 담는다.
  - 이미지 자체는 이 별도 draft의 source로 다시 넘기지 않는다. 이미지 내용은 이미 turn draft에서 정규화되므로 중복 vision 호출을 피한다.
- 검증: tsc 통과, 변경 파일 ESLint 0 error. 첨부 이미지로 목업을 생성한 실제 세션에서 style_image_preference draft가 생기고 세션 종료 시 장기 메모리로 승격되는지, 다음 미션에서 과도하게 강제하지 않고 참고 근거로만 retrieval되는지 라이브 확인이 필요하다.

### 15.102 미션 시작 setup을 원페이지로 통합 `[implemented 2026-06-21]`

- 배경(QA Note `각 미션 시작 페이지 수정`): 세션 시작 전 setup이 `미션 읽기`/`사전 정보 입력`/`세션 시작` 3개의 거의 동일한 페이지로 나뉘어 있어 단순히 다음 버튼만 누르게 되는 단조로운 흐름이었다. 또 사전 정보 입력 안내 문구가 브랜드 컬러/제약 같은 좁은 예시에 치우쳐 있었다.
- 수정:
  - 3개 step 분기와 `profileStep` state, `ProfileReviewCard`, 셋업 페이지의 `SessionSetupStepper`를 제거하고 단일 스크롤 페이지로 합쳤다. 미션 요약 카드 + 사전 정보 입력 카드를 한 화면에 두고 하단 고정 버튼은 세션 시작하기 하나만 남겼다.
  - 미션 요약 뒤에 다음: 사전 정보 입력 pill을 두어 사전 정보 입력 카드로 부드럽게 스크롤한다(긴 요약에서 입력 영역이 접혀 있을 때 안내).
  - 옵션이 여러 개인 미션은 옵션 선택 화면에서 이 페이지로 진입하며 옵션 다시 선택 버튼으로 되돌아간다. 온보딩은 사전 정보 입력 카드를 숨기고 미션 요약 + 시작 버튼만 보여준다.
  - 사전 정보 입력 카드 제목을 사전 정보 입력으로 바꾸고, 안내 문구를 지난 세션 회고와 평소 작업 방식까지 포함하도록 넓혔다. 입력 내용이 미션 종료 후에도 기억된다는 점을 명시하고 placeholder도 작업 성향 예시로 교체했다.
  - `SessionSetupStepper`는 옵션 선택 화면(mission-option-selection)에서 계속 사용하므로 컴포넌트 자체는 유지한다.
  - 이미 시작된 세션은 resume 시 setup 페이지를 건너뛰어야 한다. `sessionAlreadyStarted` 판정에 status active와 timerStartedAt/startedAt를 추가해(기존 messages/ideas/artboards 유무는 구 snapshot fallback으로 유지), 시작한 적 있는 세션이면 `profileModalConfirmed`를 true로 두고 본 세션 화면으로 바로 들어가게 한다.
- 검증: tsc 통과, 변경 파일 ESLint 0 error. 단일/다중 옵션/온보딩 미션 각각에서 setup 페이지 진입, 스크롤, 옵션 되돌아가기, 세션 시작이 정상 동작하는지와, 채팅 기록이 있는 세션 resume 시 setup 페이지가 뜨지 않는지 라이브 확인이 필요하다.

### 15.103 시안 작업 영역 세 섹션 UI 통일 `[implemented 2026-06-21]`

- 배경(QA Note `UI 통일성`): Design Brief는 그라데이션 페이드 + 하단 펼치기/접기 pill로 접고, Design Style은 헤더 클릭 아코디언으로 접어 방식이 달랐다. 또 Design Style 헤더의 현재 시안의 시각 규칙 부제가 불필요했고, 세 섹션 타이틀 표기도 제각각이었다.
- 수정:
  - Design Brief(`idea-note-section`)를 Design Style과 같은 헤더 클릭 아코디언(ChevronDown 회전)으로 통일하고 기존 페이드 + 하단 pill을 제거했다. 브리프는 기본 노출이 자연스러우므로 `isIdeaExpanded` 기본값을 펼침(true)으로 두었다.
  - Design Style(`design-style-section`)에서 현재 시안의 시각 규칙/아직 정의되지 않음 부제와 중복되던 바깥 Style 타이틀을 제거했다. 설정됨/미정의 badge는 유지.
  - 세 섹션 타이틀을 Design Brief (디자인 브리프), Design Style (디자인 스타일), Mockup (목업)으로 통일하고 같은 text-base/semibold 스타일을 적용했다. 영어는 제품 투어/빈 상태 문구와 같은 기존 용어 Mockup을 따르고, 한국어를 slate-400으로 병기한다.
  - IdeaNoteSection의 미사용 `title` prop(시안 제목 라벨)을 제거했다.
  - Brief/Style 빈 상태 문구가 크기(text-sm vs text-xs)와 톤이 달라 둘 다 text-sm/slate-400과 "아직 ~가 없어요. 에이전트에게 ~ 요청해 보세요." 형태로 통일했다.
- 검증: tsc 통과, 변경 파일 ESLint 0 error. 실제 시안 화면에서 세 섹션 타이틀과 Brief/Style 아코디언 동작, 브리프 기본 펼침을 라이브 확인이 필요하다.

### 15.104 세션 UI shadcn 프리미티브 점진 표준화 `[implemented 2026-06-21, 진행 중]`

- 배경(QA Note `shadcn 점진 표준화`): shadcn 셋업(components.json radix-nova, `src/components/ui/`)은 있으나 세션 화면이 raw button + slate 하드코딩으로 짜여 비일관적이었다. 토큰은 중립 그레이스케일이라 primary는 기존 slate-900과 사실상 같고, destructive는 솔리드가 아니라 연한 틴트다.
- 원칙: 토큰이 잘 맞는 중립 버튼/뱃지만 ui/Button·ui/Badge로 옮기고, indigo/violet 강조와 커스텀 composite(탭/카드/토글)는 유지한다. 의도적 pill 모양은 className으로 보존한다.
- 적용:
  - Phase 1 chat-input: 전송/카탈로그 토글/카탈로그 닫기 X를 ui/Button으로, 이미지 첨부 label은 buttonVariants로 통일.
  - Phase 2: 상태 뱃지를 ui/Badge로(reference-card tag/purpose, design-style 설정됨/미정의, mission-brief 디바이스), 풀폭 primary CTA를 ui/Button으로(mission-option-selection 다음, main setup 세션 시작하기).
  - Phase 3: chat-input 취소/중단 버튼을 variant destructive(연한 틴트)로 통일. 기존 솔리드 빨강 대비 차분해지는 시각 변화가 있으며, 솔리드가 필요하면 className으로 복원한다.
- 범위 밖/후속: chat-panel/chat-bubble 및 page.tsx의 나머지 버튼은 케이스별 후속. 진행 상황은 QA Note 추적 문서에 단계별로 기록한다.
- 검증: 각 단계 tsc 통과, 변경 파일 ESLint 0 error. 외형 라이브 확인 필요(특히 destructive 틴트, 뱃지 크기).

### 15.105 메모리 클러스터링 입력을 structured memory로 단일화 `[implemented 2026-06-22]`

- 배경: `/agent`에 공개했던 세 가지 clustering embedding 입력 실험 중 keyword + episodic + semantic 조합만 유지하기로 결정했다.
- 수정:
  - clustering embedding text를 keyword + episodic + semantic으로 고정하고 semantic-only/full-context 분기와 원문 interaction fallback을 제거했다.
  - `/api/memory/clusters`는 query/body의 variant 값을 받지 않고 compact-context 캐시만 조회·생성한다. 응답과 저장 문서의 clusteringInputVariant는 호환성 및 진단을 위해 compact-context로 유지한다.
  - `/agent`의 입력 variant 비교 컨트롤과 관련 client state/loading 경로를 제거했다.
  - 기존 compact-context cache key는 동일하므로 같은 memory item signature의 생성 결과는 계속 재사용할 수 있다.
- 검증: `./node_modules/.bin/tsc --noEmit`, 관련 파일 ESLint, `git diff --check` 통과.

### 15.106 클러스터링 입력 필드 안내 추가 `[implemented 2026-06-22]`

- `/agent` 헤더의 에이전트 기억 제목 옆에 현재 clustering embedding 입력인 Keyword · Episodic · Semantic을 작은 muted 보조 문구로 표시한다.
- 좁은 화면에서는 헤더 높이를 바꾸지 않고 문구가 truncate되도록 처리한다.
- 검증: 관련 파일 ESLint, `./node_modules/.bin/tsc --noEmit`, `git diff --check` 통과.

### 15.107 Admin 유저 메모리를 Agent와 동일한 전용 페이지로 통합 `[implemented 2026-06-22]`

- 배경: `/admin` 유저 카드의 메모리 보기는 full-screen modal과 admin 전용 데이터 가공/클러스터 구현을 사용해 `/agent`와 UI 및 결과가 달라질 수 있었다.
- 수정:
  - 유저 카드 액션을 `메모리 보기` Link로 바꾸고 `/admin/users/[uid]/memory` 동적 페이지로 이동시킨다. 클릭 시 modal은 열리지 않는다.
  - `/agent`의 화면 본체를 `MemoryClusterPage` named component로 공개해 self 페이지와 admin 대상 페이지가 같은 컴포넌트 인스턴스를 렌더링한다. Admin 페이지의 유일한 차이는 권한 확인, API base path, 뒤로가기 목적지다.
  - `loadUserMemoryItems`와 `loadClusterInputItems`를 서버 공용 helper로 추출해 self/admin memory API가 같은 필드 정규화, 정렬, structured clustering 대상 선별을 사용한다.
  - 중복된 admin clustering route 구현을 제거하고 공용 `memoryClustering.ts`의 cache path, graph community 생성, LLM labeling, 저장 로직을 호출하도록 교체했다.
  - 기존 compact-context cache path가 self/admin 양쪽에서 같으므로 같은 uid와 item signature의 결과를 그대로 공유한다.
- 검증: `./node_modules/.bin/tsc --noEmit`, 관련 파일 ESLint(0 error, 기존 admin warning만 유지), `git diff --check`, `npm run build` 통과. Build의 기존 presentation route NFT trace warning은 유지. 실제 admin 계정에서 유저 카드 → 페이지 이동, back navigation, cache load/regenerate는 라이브 확인이 필요하다.

### 15.108 채팅 composer의 `/` 생성 명령과 `@` 기존 산출물 언급 `[implemented 2026-06-22]`

- 배경:
  - 15.90의 ✨ 능력 카탈로그는 가능한 작업과 예문을 보여주지만, 사용자가 고른 작업을 구조화된 intent로 전달하지 않고 자연어를 입력창에 복사하는 데 그친다.
  - `시안`은 Design Brief, Design Style, Mockup을 포함하는 상위 작업 단위인데, 기존 카탈로그의 `시안 잡기`가 실제로는 Design Brief 생성과 같은 의미로 쓰여 용어가 혼재했다.
  - 레퍼런스 카드 선택, 텍스트 하이라이트 인용, 목업 요소 선택은 이미 전용 UI와 구조화된 전송 경로가 있다. 이를 `@` 자동완성으로 다시 제공하면 같은 기능의 진입점만 중복된다.
- 결정:
  - `/`는 존재하지 않는 산출물을 만드는 명시적 생성 액션, `@`는 이미 존재하는 시안/산출물을 언급하는 문법으로 분리한다.
  - 별도 대상이 없으면 현재 활성 시안 탭을 기본 대상으로 사용한다. 일반적인 현재 시안 작업에는 `@시안 N`을 요구하지 않는다.
  - `/시안생성`은 새 시안 컨테이너와 그 시안의 Design Brief를 함께 생성하고 새 탭을 활성화한다. 따라서 일반 흐름에서는 `/디자인브리프생성`을 별도 노출하지 않는다. `[stale 2026-07-13 → 15.215: visible command는 `/새시안추가`, `/디자인브리프작성`, `/디자인스타일작성`, `/목업생성`, `/레퍼런스검색`으로 분리됨]`
  - 1차 `/` 목록은 `/시안생성`, `/디자인스타일생성`, `/목업생성`, `/레퍼런스검색`으로 제한한다. 실제 동작이 검색이므로 `레퍼런스생성`이라는 이름은 사용하지 않는다. `[stale 2026-07-13 → 15.215: 기본 command는 `/새시안추가`, `/디자인브리프작성`, `/디자인스타일작성`, `/목업생성`, `/레퍼런스검색`]`
  - `@디자인브리프`, `@디자인스타일`, `@목업`은 현재 활성 시안에 존재하는 해당 산출물의 contextual shortcut이다. 자동완성 결과에는 `시안 N · 디자인 스타일`처럼 실제 결합 대상을 표시하고, 선택 시점의 `ideaId`와 artifact type에 고정한다.
  - 다른 시안을 직접 지목할 때는 동적으로 `@시안 1`, `@시안 2` 등을 제공한다. 해당 시안을 검색한 경우 존재하는 하위 산출물도 `시안 N · Design Brief/Design Style/Mockup` 결과로 찾을 수 있다. 사용자에게 이 긴 조합을 직접 입력하도록 요구하지 않고 dropdown이 완성한다.
  - 존재하지 않는 산출물은 `@` 결과에 표시하지 않는다. 예를 들어 현재 시안에 Design Style이 없으면 `@디자인스타일` 대신 `/디자인스타일생성` 안내를 보여준다. `[stale 2026-07-13 → 15.215: 현행 visible label은 `/디자인스타일작성`]`
  - 레퍼런스/텍스트/선택 요소는 `@` 목록에 넣지 않는다. 레퍼런스 카드 선택 → citation tray, 텍스트 하이라이트 → cited text tray, 목업 클릭 → selected element pill이라는 현행 전용 UI를 유지한다. 발표와 요소 수정도 `/` 또는 `@` 항목으로 만들지 않고 자연어 + 기존 선택 상태로 처리한다.
- composer UX:
  - textarea에서 단어 시작 위치의 `/` 또는 `@`를 감지해 입력창 위 dropdown을 연다. `/`는 생성 명령, `@`는 현재 세션에 실제로 존재하는 시안/산출물만 검색한다.
  - 방향키 이동, Enter/Tab 선택, Escape 닫기, 바깥 클릭 닫기를 지원한다. IME 조합 중에는 확정/전송 단축키를 실행하지 않는다.
  - 1차 구현에서는 textarea를 `contenteditable` 기반 리치 에디터로 바꾸지 않는다. 자동완성 선택 시 trigger query를 textarea에서 제거하고, 기존 citation tray와 같은 composer chip으로 명령/언급을 표시한다. chip 삭제 시 구조화 상태도 함께 제거한다. `[stale 2026-06-30 → 15.157: 자동완성 선택값은 textarea 안 inline token으로 삽입되고 별도 composer chip은 제거됨]`
  - 한 turn에는 생성 명령을 최대 1개만 허용한다. 명령 chip과 언급 chip은 일반 요청 텍스트, 기존 citation tray, 첨부 이미지와 함께 사용할 수 있다.
  - 현재 시안 contextual shortcut은 선택 당시 `ideaId`를 chip에 저장한다. 다른 시안을 선택하면 해당 탭도 활성화하고, 사용자가 이후 탭을 직접 바꾸면 이전 언급 chip을 해제해 화면의 활성 대상과 숨은 target이 어긋나지 않게 한다.
  - ✨ 카탈로그 버튼은 `/` 명령 팔레트를 여는 slash/command 아이콘으로 교체한다. 클릭은 `/`를 직접 입력한 것과 같은 dropdown을 열고, 이미지 첨부 버튼은 유지한다. placeholder는 `/로 만들기 · @로 기존 항목 언급`의 의미를 짧게 안내한다.
  - 빈 채팅의 능력 카탈로그는 제거하지 않고 새 문법의 발견성 안내로 축약한다. 각 단계의 긴 예문 목록 대신 `/` 생성 명령과 현재 활성 시안 기본 규칙을 보여준다.
- 구조화 상태와 전송 계약:
  - client composer에 `ComposerCommand`와 `ComposerMention` 상태를 둔다. mention은 최소 `kind`, `ideaId`, `artifactId?`, `label`을 가지며 표시 문자열을 식별자로 사용하지 않는다.
  - `/api/chat` 요청에 plain text와 별도로 `requestedCommand` 및 `mentionedArtifact`를 전달한다. client dropdown은 현재 UI 상태와 선행 조건으로 생성 명령을 비활성화하고, 서버는 command/mention allowlist와 identifier를 검증한 후 planner 결과보다 명시적 명령을 우선한다.
  - 명령 매핑은 `/시안생성` → 새 idea 강제 + `create_note`, `/디자인스타일생성` → `create_design_spec`, `/목업생성` → `generate_mockup`, `/레퍼런스검색` → `fetch_references`다. `[stale 2026-07-13 → 15.215: `/새시안추가`는 내부 `create_blank_idea`, `/디자인브리프작성`은 내부 `create_idea`, `/디자인스타일작성`은 내부 `create_design_style` command id를 사용함]`
  - `/시안생성`은 현재의 자연어 fork 휴리스틱에 의존하지 않고 explicit new-idea flag로 새 시안을 만든다. 나머지 시안 종속 명령은 mention의 `ideaId`, 없으면 전송 시점의 `activeIdeaId`를 대상으로 한다. `[stale 2026-07-13 → 15.215: `/디자인브리프작성`은 현재 시안의 빈 Design Brief를 채우며 별도 새 시안만 추가하려면 `/새시안추가`를 사용함]`
  - 명령/언급 metadata는 user message와 review turn에 저장해 재접속 시 표시, admin prompt 진단, memory draft의 실제 입력 맥락이 서로 어긋나지 않게 한다. 모델에 보낼 때는 raw token 문자열 파싱에 의존하지 않고 구조화 metadata를 system context로 직렬화한다.
  - planner/API 실패 시 임의의 다른 생성 intent로 fallback하지 않는다. 명시적 명령의 선행 조건이 맞지 않으면 현재 시안에 무엇이 부족한지 채팅 오류/안내로 반환한다.
- 구현 순서:
  1. command/mention 타입, 명령 allowlist, 현재 시안 기반 자동완성 데이터와 순수 target resolution helper를 추가한다.
  2. `ChatInput`에 `/`·`@` trigger dropdown, 키보드 조작, command/mention chip, ✨ 버튼 교체를 구현한다.
  3. `/main/[missionId]`에서 composer 상태와 활성 시안/산출물 데이터를 연결하고, send snapshot·초기화·메시지 영속화를 추가한다.
  4. `/api/chat` request schema, planner override, 선행 조건 검증, review 기록을 추가한다.
  5. 명시적 `/시안생성`의 새 idea 생성과 기존 action 처리 경로를 연결하고, 자연어 fork 및 현재 active idea 처리와 충돌하지 않는지 정리한다.
  6. 15.90의 카탈로그/제품 투어/빈 상태 설명을 새 문법에 맞게 갱신하고, 구현 완료 시 1~9장 Current Snapshot의 채팅 입력 계약도 같은 커밋에서 동기화한다.
- 검증 계획:
  - 현재 시안이 1/2일 때 `@디자인브리프`가 각각 올바른 `ideaId`에 고정되고, 선택 후 탭 변경에도 대상이 변하지 않는지 확인한다.
  - 존재/미존재 Design Style과 Mockup에 따라 `@` 결과와 `/` 생성 안내가 올바르게 달라지는지 확인한다.
  - `/시안생성`이 새 시안 + substantive Design Brief를 한 번만 만들고 새 탭을 활성화하는지, `/디자인스타일생성`과 `/목업생성`이 현재 또는 명시된 시안만 갱신하는지 확인한다. `[stale 2026-07-13 → 15.215: 현행 visible label은 `/디자인스타일작성`]`
  - 레퍼런스 카드, 텍스트 인용, 선택 요소의 현행 선택·해제·전송이 바뀌지 않고 `@` 목록에 중복 노출되지 않는지 회귀 검증한다.
  - 한글 IME, Enter 전송, Shift+Enter 줄바꿈, dropdown 키보드 탐색, 명령/언급 chip 삭제, 요청 취소 후 composer 초기화를 확인한다. `[stale 2026-06-30 → 15.157: chip 삭제 대신 textarea inline token 삭제 시 metadata clearing을 확인]`
  - TypeScript, 변경 파일 ESLint, `git diff --check`, production build와 실제 provider를 통한 command별 라이브 요청을 검증한다.
- 구현/검증 결과:
  - `src/lib/session/chat-composer.ts`에 공용 command/mention 계약과 검색 normalization을 추가하고, `ChatInput`에 `/`·`@` dropdown, 키보드/IME 처리, 구조화 chip, slash toolbar 버튼을 연결했다.
  - 메시지/메모리 입력/review turn/API prompt에 command와 mention metadata를 보존하고, `/api/chat`이 명시적 command를 planner intent보다 우선하도록 연결했다. `/시안생성`은 기존 시안이 있어도 새 `CREATE_NOTE` 결과를 새 시안으로 materialize하며 명시적 command turn에는 자연어 style-fork 휴리스틱을 적용하지 않는다. `[stale 2026-07-13 → 15.215: 현행 빈 새 시안 추가는 `/새시안추가`/`create_blank_idea`, 현재 시안 Brief 작성은 `/디자인브리프작성`/`create_idea`로 분리됨]`
  - 빈 채팅 catalog와 제품 투어를 새 문법으로 갱신했다. 레퍼런스/텍스트/선택 요소의 기존 citation UI는 변경하지 않았다.
  - `./node_modules/.bin/tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 warning만), `git diff --check`, `npm run build` 통과. Build의 기존 presentation route NFT trace warning은 유지. 실제 provider command별 end-to-end와 한글 IME dropdown 조작은 라이브 확인이 필요하다.

### 15.109 레퍼런스 해석을 메인 메모리 인코딩 전 단계로 분리 `[implemented 2026-06-23]`

`[stale 2026-06-23 → 15.110: link source를 metadata와 대화만으로 해석하던 범위를 URL/선택 이미지의 유형별 lazy source analysis artifact까지 확장함]`

- 배경: 15.100은 source를 메인 encoder 전에 텍스트 형태로 모았지만, link/text/UI는 메타데이터와 원문을 포맷하는 데 그쳤다. 레퍼런스가 layout, IA, behavior, tone, visual style 중 무엇을 뜻하는지와 durable/mission-specific/negative 범위인지는 여전히 메인 메모리 prompt의 Reference Handling 규칙이 직접 판단했다.
- 수정:
  - reference source가 있는 turn은 user input, agent output, structured source를 선행 normalizer가 함께 읽고 source summary, interaction use, relevant aspects, agent interpretation, scope, scope rationale, negative evidence를 JSON으로 해석한 뒤 bounded text context로 만든다.
  - 첨부 image의 visible fact 설명도 같은 multimodal normalization 호출에 통합한다. source가 없는 turn은 추가 모델 호출을 하지 않으며, normalization 호출이나 JSON parse가 실패하면 raw source text로 폴백해 메모리 생성을 막지 않는다.
  - 메인 memory encoder의 상세 Reference Handling 판단 규칙을 제거하고 normalized interpretation을 근거로 사용하되 mission-specific/negative evidence를 전역 선호로 확장하지 않는 계약만 남겼다.
  - normalization version을 2로 올리고 fingerprint에 source뿐 아니라 bounded input/output도 포함한다. 따라서 source가 같아도 interaction 해석이 달라지면 재정규화하고, 완전히 같은 재처리만 저장된 결과를 재사용한다.
  - client memory input에서 cited text/reference/UI의 문자열 복제를 제거했다. 원 사용자 요청과 command/mention metadata는 input에 두고 cited material은 structured sources → normalized context 한 경로로만 전달한다.
- 검증: `./node_modules/.bin/tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 page warning만), `git diff --check`, `npm run build` 통과. Build의 기존 presentation route NFT trace warning은 유지. 실제 reference cite/delete/search, cited text, selected UI, attached image turn에서 normalized interpretation과 scope가 draft에 저장되고 같은 요청 재호출 시 sourceNormalizedAt이 유지되는지는 라이브 확인이 필요하다.

### 15.110 링크 레퍼런스의 유형별 source analysis와 공용 lazy cache `[implemented 2026-06-23]`

- 배경: 15.109의 interaction normalizer는 link title, URL, description, rationale와 agent output을 근거로 참고 의도를 판단했지만 실제 linked source를 유형별로 읽지는 않았다. 검색 경로에서 생성한 referenceMode, provider, purpose, card image도 memory sources에서 유실돼 case study의 개별 사례, live app의 기능/포지셔닝/시각 근거, curation image의 실제 내용이 메모리 근거에 남지 않았다.
- 수정:
  - memory link source 계약에 image URL, reference mode, search provider, selected purpose/label, source analysis를 추가하고 cite/search/manual add/delete 경로가 같은 변환 helper를 사용하도록 통합했다.
  - 메모리 draft가 link를 처음 필요로 할 때 URL/image/mode/provider 기반 fingerprint로 user별 reference source analysis cache를 조회한다. cache miss만 분석하고 결과를 즉시 별도 문서에 저장하므로 뒤의 memory encoding이 실패해도 같은 source 분석을 반복하지 않는다.
  - product/article link는 web search로 해당 URL을 확인해 source type, 구체 case 목록, capabilities, positioning, UX/IA patterns, visual evidence, limitations를 분리한다. style/curation link는 선택된 card image 자체를 vision으로 분석하며 사용자 선호는 이 단계에서 추론하지 않는다.
  - 저장된 source artifact를 interaction normalizer에 전달해, 여러 case 중 사용자가 지목한 case나 기능/포지셔닝/스타일 중 이번 turn에서 원한 측면은 user input과 agent output을 결합하는 다음 단계에서 선택한다.
  - source 분석 실패 시 기존 metadata fallback을 저장하고 memory encoding은 계속한다. 분석 fingerprint/version과 사용한 artifact 목록을 draft 및 장기 memory metadata로 승격한다.
- 검증: `./node_modules/.bin/tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 page warning만), `git diff --check`, `npm run build` 통과. Build의 기존 presentation route NFT trace warning은 유지. 실제 article/case study, live product, Pinterest/curation image 각각에서 cache artifact와 normalized interaction context가 의도대로 분리되는지는 provider 연결 환경에서 라이브 확인이 필요하다.

### 15.111 during-session semantic interpretation 제거 `[implemented 2026-06-23]`

- 배경(QA Note `Semantic Interpretation 값 삭제`): interaction마다 사용자 성향을 과감하게 추론해 semantic과 confidence를 강제 생성하던 15.63 동작은 현재 활용 대비 과해석과 데이터 복잡도가 컸다.
- 범위 결정:
  - 신규 during-session turn의 speculative semantic interpretation만 제거한다. `[stale 2026-06-28 → 15.135: 의도는 interpretationConfidence 제거였고 semantic 자체 삭제가 아니므로, 신규 during-session turn은 semantic을 다시 생성·저장한다]`
  - before-session profile에서 사용자가 직접 제공한 durable preference/constraint를 구조화하는 semantic과 기존 저장 memory의 읽기 호환성은 유지한다.
- 수정:
  - `MEMORY_ENCODE_PROMPT`에서 Semantic Interpretation 섹션, semantic paraphrase 규칙, semantic/confidence output field를 제거하고 keyword + factual episode만 반환하도록 축소했다. `[stale 2026-06-28 → 15.135: confidence만 제거하고 semantic output field는 복구했다]`
  - draft parser에서 semantic/confidence parse와 clamp를 제거했다. draft 저장 시 Firestore update mask delete로 semantic, semanticJson, interpretationConfidence를 실제 필드 삭제해 같은 interaction 재생성 시 구 값도 남지 않게 했다. `[stale 2026-06-28 → 15.135: semantic/semanticJson parse·저장을 복구하고 delete mask는 interpretationConfidence로 축소했다]`
  - session complete는 신규 semantic 없는 memory document에서 semantic/confidence 필드를 삭제하며 embedding은 keyword, episode, original interaction content를 사용한다. 과거 draft에 실제 semantic이 있으면 session completion 호환을 위해 semantic 자체는 승격하되 confidence는 제거한다. `[stale 2026-06-28 → 15.135: promoted memory도 semantic/semanticJson을 유지하고 confidence만 제거한다]`
  - memory item/session summary/agent/session review 전달 타입과 매핑에서 interpretationConfidence를 제거하고 detail panel의 semantic 유무 badge 및 confidence/과해석 badge를 제거했다. 기존/profile semantic 본문은 호환 표시한다.
  - 공용 Firestore patch helper에 optional delete field mask를 추가해 별도 요청 없이 필드를 삭제할 수 있게 했다.
- 검증: `./node_modules/.bin/tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 page warning만), `git diff --check`, `npm run build` 통과. Build의 기존 presentation route NFT trace warning은 유지. 신규 interaction draft와 promoted memory에 semantic/confidence field가 없고 기존/profile semantic retrieval이 유지되는지는 실제 세션에서 라이브 확인이 필요하다. `[stale 2026-06-28 → 15.135: 현행은 semantic/semanticJson을 생성·저장하고 interpretationConfidence만 저장하지 않는다]`

### 15.112 Final Design 최종 선택 하나만 메모리로 확정 `[implemented 2026-06-23]`

- 배경(QA Note `Final Design 최종으로 누른 것만 메모리에 저장되게`): Final Design card를 클릭할 때마다 artboard별 memory draft를 즉시 만들어, 사용자가 비교하며 선택을 바꾸면 모든 중간 선택이 장기 메모리 후보로 누적됐다.
- 수정:
  - Final Design card 클릭은 `finalArtboardId` UI/session state만 변경하고 memory draft를 만들지 않는다.
  - 세션 종료 시 session snapshot을 먼저 저장한 뒤 현재 final artboard와 owner idea를 확인해 `final-design-selection-{artboardId}` draft 하나를 생성하고, 그 요청 완료 후 memory completion을 호출한다.
  - final selection draft 생성 실패는 성공으로 삼키지 않고 세션 종료를 중단한다. 사용자가 재시도하면 같은 final draft ID를 갱신하므로 최종안 메모리 없이 세션만 완료되는 상태를 막는다.
  - 종료 API는 session document의 `finalArtboardId`를 source of truth로 읽는다. 새 final selection draft가 있으면 그것만 승격하고, rollout 전 누적된 legacy `final-design-{artboardId}` draft는 새 draft가 없을 때 현재 선택과 일치하는 하나만 호환 승격한다.
  - 현재 선택과 다른 final-design draft 및 최종 선택 해제 상태의 draft는 `skipped_superseded`와 completion timestamp로 닫아 session review와 장기 memory에서 제외한다.
- 불변식: 한 session completion에서 `final_design_select` memory는 최대 하나이며, 최종 디자인이 없으면 0개다.
- 검증: `./node_modules/.bin/tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 page warning만), `git diff --check`, `npm run build` 통과. Build의 기존 presentation route NFT trace warning은 유지. A→B→C 선택 변경 후 종료, 선택 해제 후 경고 종료, legacy draft가 있는 진행 중 세션 종료는 라이브 확인이 필요하다.

### 15.113 목업 캔버스 height reporter의 viewport layout 보존 `[implemented 2026-06-23]`

- 배경(QA Note `이미지가 목업에서 뭔가 잘 반영이 안되는 건에 대하여`): 같은 artboard가 raw HTML을 고정 viewport로 축소하는 Final Design에서는 정상인데, 캔버스에서는 이미지 grid가 세로로 길게 늘어나고 Fit 결과가 10%의 가느다란 열처럼 보였다.
- 원인:
  - 캔버스 전용 `injectHeightReporter`가 resize feedback loop를 막기 위해 원본 `html/body`를 `height: auto`로 강제하고 `h-screen`/`min-h-screen` 계열을 auto/0으로 무효화했다.
  - full-screen hero와 image grid가 viewport 높이 및 percentage height 기준을 잃어 intrinsic image 높이로 늘어났고, 동적 artboard height와 Fit scale도 함께 과대 계산됐다. Final Design은 이 injection 없이 raw HTML을 1280×900 또는 390×844로 렌더해 정상으로 보였다.
- 수정:
  - height reporter가 artboard device viewport width/height를 명시적으로 받도록 변경했다.
  - 원본 `html/body` height override를 제거하고, `h-screen`/`h-dvh`/`h-svh`/`h-lvh` 및 min-height variants만 device viewport pixel 값에 고정한다.
  - `window.innerWidth/innerHeight`와 inline/style tag의 vh units도 실제 iframe resize 값이 아니라 전달된 design viewport를 기준으로 freeze해 feedback loop 방지는 유지한다.
  - Tailwind CDN처럼 늦게 삽입되는 runtime style도 scheduled measurement 직전에 다시 freeze한 뒤 overflow height를 계산한다.
  - canvas render path는 이미 계산한 artboard viewport를 wrapper width, iframe width, height reporter에 공통 사용해 device 기준 불일치를 막는다.
- 검증: isolated helper fixture에서 1280×900 viewport 고정, 기존 auto override 제거, width freeze를 확인했다. `./node_modules/.bin/tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 page warning만), `git diff --check`, `npm run build` 통과. Build의 기존 presentation route NFT trace warning은 유지. 문제를 재현한 실제 Stitch HTML에서 canvas/Final Design 레이아웃 일치와 긴 scroll page의 overflow height 측정은 라이브 확인이 필요하다.

### 15.114 Planner에 관련 클러스터 요약 주입 `[implemented 2026-06-23]` `[stale 2026-07-11 → 15.206: userClusterSummaries 제거, retrieved semantic memory 직접 입력으로 대체]`

- 배경(QA Note `답변 실행 전에 어떤 행동할지 결정하는 단계에서도 메모리가 들어가는지`): planner(행동 결정) 입력에는 메모리 개수(`profileMemoryCount`, `interactionMemoryCount`)만 들어가고 실제 내용은 답변 실행 단계에서만 주입돼, planner가 유저 특화 액션(intent/needs)을 고를 근거가 없었다. `[13.4의 Planner 입력 목록 stale 2026-06-23 → 15.114]`
- 결정: 풀 컨텐츠를 또 넣어 요약 LLM을 돌리는 대신, 세션 종료 시 이미 생성·캐시된 persona cluster summary를 재사용한다. planner엔 짧은 요약, 답변 단계엔 기존 풀 컨텐츠로 역할을 분리한다.
- 데이터 흐름: `/api/memory/retrieve`가 매 턴 검색 결과의 각 메모리에 소속 cluster의 `clusterId`/`clusterLabel`/`clusterSummary`를 부착한다. 이 필드는 `memoryContext`를 타고 `/api/chat`까지 전달되고, planner 입력에 distinct summary 최대 3개(`userClusterSummaries`)로 들어간다. chat 핫패스에는 새 Firestore 읽기를 추가하지 않는다. `[stale 2026-07-11 → 15.206/15.230: planner는 userClusterSummaries 대신 retrieved semantic memory 최대 10개를 직접 받음]`
- 매핑/폴백: retrieve의 memory doc id와 cluster `itemIds`는 둘 다 `memories_0_1_2` 문서 id라 직접 매칭된다. cluster를 `loadLatestStoredClusters`로 best-effort 로드하며(LLM 재생성 없음), 캐시가 없거나 매칭 실패 시 `userClusterSummaries`는 빈 배열이 되어 기존 카운트 기반 동작으로 자연 폴백한다. `[stale 2026-07-11 → 15.206: planner 입력에서 userClusterSummaries fallback 제거]`
- 적용 범위: planner 규칙은 cluster summary를 요청이 애매할 때 intent/needs를 가르는 데만 쓰고, 콘텐츠·스타일·레퍼런스 선택(답변 실행 단계의 역할)에는 쓰지 않도록 제한한다. 요청이 이미 명확하면 무시한다.
- 변경 파일: `src/lib/server/memoryClustering.ts`(`loadLatestStoredClusters`, `clusterSummaryByItemId` 추가), `src/app/api/memory/retrieve/route.ts`(요약 부착), `src/app/api/chat/route.ts`(`userClusterSummaries` 추출·주입), `src/lib/prompts.ts`(planner 규칙), `src/app/main/[missionId]/page.tsx`(`MemoryRecord` 타입). `[stale 2026-07-11 → 15.206: /api/chat의 userClusterSummaries 추출·주입은 제거]`
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error) 통과. 런타임 효과는 cluster 캐시가 있는 유저(최소 1세션 완료 후)로 라이브 확인이 필요하다.

### 15.115 before-session 메모리 주입·인코딩을 during-session과 정렬 `[implemented 2026-06-23]`

- 배경(QA Note `before-session 데이터 실행 단계에서 메모리 주입 시 변경 사항`): 답변 실행 단계에서 during-session 메모리는 episodic+semantic compact JSON으로 주입되는데, before-session 메모리만 `input` 원문을 bullet로 주입하고 있어 4장(1~9장)의 prompt 주입 계약(profile compact JSON은 episodic/semantic 배열만 포함)과도 어긋났다.
- 답변 단계 변경: `/api/chat`의 profile 메모리 주입을 `compactMemoryContext`로 통일해 episodic/semantic만 넣는다. `chatProfileMemoryPrompt`는 bullet lines 대신 compact JSON을 받고 before-session 배경임을 설명한다. 이로써 코드가 4장 prompt 주입 계약과 일치한다(기존 input bullet 방식이 drift였음).
- 인코딩 변경: before-session 유닛은 앞선 interaction이 없으므로 인코딩 입력에 사용자가 시작하려는 mission(title/brief)을 함께 넣고, `PROFILE_MEMORY_ENCODE_PROMPT`가 episodic을 미션 시작 전 사용자가 제공한 사전 정보로 프레이밍하도록 했다. mission 정보가 비면 프레이밍을 생략한다. mission title/brief는 클라이언트의 profile POST body로 전달한다(기존 chat route와 동일하게 클라이언트가 mission context를 넘기는 패턴).
- 저장 계약: doc의 `input` 필드 저장은 그대로 둔다(admin/원문 보기 용도). 변경은 답변 주입과 인코딩 프레이밍에 한정된다.
- 변경 파일: `src/app/api/chat/route.ts`(profile 주입을 compact JSON으로), `src/lib/prompts.ts`(`chatProfileMemoryPrompt`, `PROFILE_MEMORY_ENCODE_PROMPT`), `src/app/api/memory/profile/route.ts`(mission context 스레딩), `src/app/main/[missionId]/page.tsx`(profile POST에 missionTitle/brief 추가).
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 page warning만) 통과. 실제 인코딩 episodic 프레이밍 품질과 답변 단계 주입 결과는 라이브 확인이 필요하다.

### 15.116 세션 시작 시 빈 디폴트 시안 1 시드 `[implemented 2026-06-23]`

- 배경(QA Note `튜토리얼에 드래그해서 인용하기 기능 설명 추가` 논의 중 파생): 시안이 0개로 시작하다 보니 튜토리얼에서 탭/시안 구조를 가르치기 어렵고, 빈 시안 상태 투어의 "시안의 구성" 스텝이 직전 "시안 작업 공간"과 같은 idea-workspace를 중복 하이라이트했다. 또 작업 도중 시안이 갑자기 생겨 사용자가 혼란스러울 수 있다.
- 결정: 세션을 빈 디폴트 시안 1로 시작한다. 워크스페이스·탭·Brief/Style/Mockup 구조가 처음부터 노출되어 투어가 정상 IDEA_STEPS 경로로 설명 가능하고, 시안이 중간에 불쑥 생기는 혼란도 사라진다.
- 시드: 세션 로드 시 저장된 시안이 없고 read-only/완료 세션이 아니면 description·designStyle·artboard가 없는 시안 1을 만들어 active로 둔다. 상태로만 두고 세션 시작/스냅샷 저장 시 영속화되며, 재개 시 저장된 시안으로 로드된다.
- 첫 생성은 fill: `[CREATE_NOTE]`가 빈 shell(디자인 스타일만 있는 기존 shell 또는 시드된 빈 디폴트)일 때 append 대신 그 시안을 채우도록 조건을 확장했다. 덕분에 빈 시안 1 + 채워진 시안 2 같은 중복이 생기지 않는다. mockup/designSpec 우선 생성도 active(디폴트) 시안에 붙으므로 추가 빈 시안이 생기지 않는다.
- 투어 영향: 디폴트 시안 덕에 `hasIdeas`가 사실상 항상 true → IDEA_STEPS 사용. EMPTY_IDEA_STEPS는 read-only 빈 세션 같은 예외에만 남는 fallback이 됐고, 그 안의 중복 하이라이트는 후속 정리 대상으로 남겨둔다.
- 변경 파일: `src/app/main/[missionId]/page.tsx`(세션 로드 시 디폴트 시안 시드, CREATE_NOTE 빈 shell fill 조건 확장).
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 page warning만), `npm run build` 통과. 신규/재개 세션에서 디폴트 시안 노출, 첫 brief의 fill 동작, 빈 시안으로 세션 종료 시 동작은 라이브 확인이 필요하다.

### 15.117 세션 리뷰 세션 이전 탭에서 episodic과 semantic 함께 표시 `[implemented 2026-06-23]`

- 배경(QA Note `세션 리뷰 UI`): 리뷰의 세션 이전 탭 memory card가 `memorySummaryText`로 semantic 한 줄만 보여줬다. before-session 메모리가 episodic/semantic을 갖게 된 15.115 이후로는 episodic도 함께 노출하는 게 맞다.
- 변경: `MemoryCard`에 선택적 `fields`(label/value 배열) prop을 추가해, 있으면 단일 summary 대신 라벨된 섹션을 렌더한다. 세션 이전 탭에서는 memory의 episodic과 semantic을 각각 Episodic/Semantic 필드로 넘긴다. 둘 다 없으면 기존 summary로 폴백한다. 원본 입력 원문은 기존대로 탭 상단의 원래 입력한 내용 블록에 한 번만 표시한다.
- 범위: `MemoryCard`는 이 탭에서만 사용되므로 다른 화면 영향 없음.
- 변경 파일: `src/components/memory/memory-card.tsx`(fields prop), `src/app/main/[missionId]/page.tsx`(세션 이전 탭에서 episodic/semantic 전달).
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 page warning만) 통과. 실제 리뷰 화면 표시는 라이브 확인이 필요하다.

### 15.118 CHAT_AGENT_BASE_PROMPT에 메모리 참조 지침 추가 `[implemented 2026-06-23]`

- 배경(QA Note `메모리 반영 강화`): base prompt에 과거 메모리를 활용하라는 지침이 없어, 주입된 메모리를 답변에 적극 반영하지 않을 수 있었다.
- 변경: `CHAT_AGENT_BASE_PROMPT` 끝에 한 줄 추가 — 과거 메모리가 주어지면 그것을 활용해 개인화된 최선의 답변을 하되, 관련 없을 때 억지로 메모리에 엮지는 말 것. (영문으로 작성)
- 변경 파일: `src/lib/prompts.ts`.
- 검증: `npx tsc --noEmit`, ESLint(0 error) 통과.

### 15.119 @ 언급 시 해당 artifact로 작업 범위 한정 강화 `[implemented 2026-06-23]`

- 배경(QA Note `언급 기능 강화`): @디자인브리프를 언급했는데도 디자인 스타일과 목업 생성까지 수행하는 경우가 있었다. 강제까지는 아니고 프롬프트 표현 강화로 언급된 요소 안에서 작업하도록 유도한다.
- 변경: `/api/chat`의 mention system 메시지에 kind별 대상 라벨(idea/design_brief/design_style/mockup)과 범위 한정 지침을 추가했다. 언급된 artifact 자체에 대해 그 종류에 맞는 액션을 우선하고, 사용자가 이번 턴에 명시적으로 요청하지 않는 한 다른 artifact나 무관한 액션(예: 디자인 브리프 언급 시 스타일·목업 생성)으로 분기하지 말라고 명시. planner의 explicit 명령 우선 규칙과 별개로 답변 단계 표현만 강화.
- 변경 파일: `src/app/api/chat/route.ts`.
- 검증: `npx tsc --noEmit`, ESLint(0 error) 통과. 실제 @ 언급 turn 동작은 라이브 확인이 필요하다.

### 15.120 클러스터링 입력 variant 비교 복원 (compact-context / full-context) `[implemented 2026-06-24]`

- 배경: 15.105/15.106(커밋 30915a0)에서 클러스터링 입력을 keyword+episodic+semantic 단일로 통합했는데, 입력 종류에 따라 clustering이 어떻게 달라지는지 다시 비교하고 싶다는 요구가 생겼다.
- 결정: variant 비교를 복원하되 과거 3개 중 `semantic-only`는 제외하고 2개만 둔다 — `compact-context`(keyword+episodic+semantic, 기본), `full-context`(compact + 원문 interaction + link).
- 클러스터링 코어(`memoryClustering.ts`): `CLUSTERING_INPUT_VARIANTS`/타입/`normalizeClusteringInputVariant` 복원, `embeddingText`·`embedItems`·`generateAndStoreClusters`·`clusteringMethodVersion`·`clusterCacheId`·`clusterDocumentPath`에 variant 인자 추가. 기본값은 compact-context.
- 캐시 호환: compact-context의 method version 문자열을 기존과 동일(`...:compact-context`)하게 유지해 기존 캐시와 planner cluster summary(15.114)가 그대로 동작. full-context만 별도 캐시 네임스페이스.
- planner/retrieve 영향 차단: `loadLatestStoredClusters`에 variant 인자(기본 compact-context)를 추가하고 `clusteringInputVariant`로 필터링해, 여러 variant 캐시가 섞여도 planner는 항상 compact-context만 사용.
- 라우트: self `GET/POST /api/memory/clusters`와 admin `.../memory/clusters`가 GET은 `?variant=`, POST는 body `variant`를 받아 처리.
- UI: `/agent`(self·admin 공용) 헤더에 variant 탭 추가. 탭 전환 시 해당 variant 캐시 GET, 재생성은 선택 variant로 POST.
- 변경 파일: `src/lib/server/memoryClustering.ts`, `src/app/api/memory/clusters/route.ts`, `src/app/api/admin/users/[uid]/memory/clusters/route.ts`, `src/app/agent/page.tsx`.
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error), `npm run build` 통과. full-context 탭의 실제 클러스터 생성·비교는 라이브 확인이 필요하다.

### 15.121 목업 캔버스 full-bleed 이미지 stretch / 높이 피드백 루프 차단 `[implemented 2026-06-24]`

- 배경(QA Note `이미지가 목업에서 뭔가 잘 반영이 안되는 건에 대하여`, mission-20260611-202001 / user p0jQQQdzsLPnOmhLfC0Wvvg421y1): Final Design 미리보기에서는 멀쩡한 hero 이미지가 목업 캔버스에서는 세로로 길게 늘어난 얇은 띠로 깨졌다.
- 차이 원인: Final Design 셀렉터(`final-design-selector.tsx`)는 원본 HTML을 device 크기(예: 1280x900) iframe에 그대로 두고 CSS scale로 축소한다. 반면 목업 캔버스(`page.tsx`)는 전체 문서가 보이도록 iframe 높이를 측정된 문서 높이(수천 px)로 키운다. iframe이 커지면 vh 기준 이미지의 CSS viewport도 같이 커져 이미지가 늘어난다.
- 실제 깨진 시안(Design 2)의 구조: hero 컨테이너가 arbitrary value `h-[80vh]`이고 그 안의 img가 `w-full h-full object-cover`다. iframe이 커지면 80vh 컨테이너가 함께 커지고 그 안의 이미지도 늘어난다.
- vh-freeze로 막지 못한 이유: Tailwind Play CDN(`cdn.tailwindcss.com`)은 규칙을 CSSOM `insertRule`로 넣고 자기 스타일시트를 다시 생성하므로, `<style>` textContent 치환도, CSSOM `cssRules`를 직접 rewrite하는 것도 유지되지 않는다. 또 `.h-screen` 계열 override는 `h-[80vh]` 같은 arbitrary 값을 못 잡는다. 그 결과 iframe 성장 → 컨테이너·이미지 성장 → 문서 높이 재증가의 피드백 루프가 남았다.
- 핵심 수정(`src/lib/session/mockup-html.ts`의 `injectHeightReporter`): CDN 스타일시트를 고치는 대신, iframe이 아직 device 높이일 때(= 첫 높이 보고 전에) 영향받는 요소의 box를 인라인 px(`!important`)로 직접 고정한다. 인라인 선언은 클래스 규칙을 specificity로 이기므로 스타일시트 재생성과 무관하게 유지된다. 대상은 (1) vh를 쓰는 요소(`[class*="vh"], [style*="vh"]`, 예: h-[80vh] 컨테이너)의 height, (2) 모든 이미지의 width/height. 높이 보고는 `load` 이후 두 animation frame까지 미루고(외부 리소스 미발화 대비 3초 fallback) 그 시점에 고정하므로 캡처 시 iframe은 항상 device 높이다. 늦게 로드되는 이미지는 너비(고정 iframe 폭에만 의존)와 natural aspect로 높이를 산출해 고정한다. `[stale 2026-07-13 → 15.232: srcdoc 템플릿 리터럴 안의 vh regex 이스케이프를 보강하고, vh box pinning은 height와 min-height를 함께 고정한다]`
- 재마운트 보강(`src/app/main/[missionId]/page.tsx`): 보드의 `htmlUpdatedAt`이 갱신되면(목업 재생성/편집) 저장된 grown 높이를 drop해, 재마운트된 iframe도 device 높이에서 시작하고 box 고정이 올바른 크기를 캡처하도록 한다.
- 검증: 실제 저장 HTML(Design 2)을 실제 srcdoc iframe + 부모 성장 하니스로 headless Chrome에서 렌더해 비교. 수정 전에는 hero 이미지가 759x10152로 늘어나고 보고 높이가 3258 → 5616 → 7974 → 10332 → 12690으로 발산했고, 수정 후에는 이미지가 759x720으로 고정되고 보고 높이가 3258 한 번으로 안정했다. 스크린샷으로 hero가 Final Design과 동일한 첫 화면 레이아웃임도 확인. `npx tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 page warning 6건만), `npm run build` 통과.
- 이력: 1차 시도는 이미지 box만 고정해 sliver는 막았으나 `h-[80vh]` 컨테이너가 계속 부풀어 빈 박스+높이 발산이 남았고, vh 요소 box 고정을 추가해 루프를 완전히 차단했다.

### 15.122 관리자 사용자 카드 미션 순서·진행상황 통합 `[implemented 2026-06-24]`

- 배경(QA Note `관리자 페이지 관련 UI`): 사용자 카드에서 유저별 랜덤 미션 순서와 아래 세션/리뷰 chip 목록이 분리돼 같은 미션 정보를 두 번 읽어야 했고, 각 미션의 현재 진행상황도 바로 알 수 없었다.
- 변경: `missionOrder`를 먼저 유지하고 participant/session에만 존재하는 미션을 뒤에 보완한 단일 `미션 순서 · 진행상황` 목록으로 합쳤다. 카드 폭에 따라 1~2열로 표시하며 각 행에 순번, 미션 제목, 상태 배지를 둔다. 상단에는 완료 수/전체 수를 요약한다.
- 상태 계약: `completedSessionMissionIds`면 `완료`, session 또는 participant 기록이 있으면 `진행 중`, 어느 기록도 없으면 `시작 전`이다. 완료 행에만 review 링크를 제공하고, 일반 제목 링크는 read-only viewAs 세션으로 이동한다.
- 온보딩: 이미 카드 상단에 별도 상태 배지가 있으므로 통합 미션 목록에서는 onboarding mission을 제외해 기존 중복 chip과 잘못 붙던 review 링크를 제거했다.
- 변경 파일: `src/components/admin/admin-user-card.tsx`.

### 15.123 관리자 사용자 카드 1열 배치와 온보딩 미션 복원 `[implemented 2026-06-24]`

- 후속 피드백: 통합 목록에서도 온보딩 미션을 열 수 있어야 하고, 사용자 카드는 2열이 아니라 1열 전체 폭으로 보여야 한다. `[15.122의 온보딩 목록 제외 결정 stale 2026-06-24 → 15.123]`
- 변경: 사용자 목록의 `lg:grid-cols-2`를 제거했다. 통합 미션 ID의 첫 항목에 onboarding mission을 항상 넣어 제목 링크로 read-only viewAs 화면을 열 수 있게 했다.
- 상태: onboarding status가 completed면 `완료`, participant/session 기록이 있으면 `진행 중`, 그 외에는 `시작 전`으로 표시한다. 완료 수 요약과 완료 행 review 링크에도 같은 상태 판정을 사용한다.
- 변경 파일: `src/app/admin/page.tsx`, `src/components/admin/admin-user-card.tsx`.

### 15.124 Lobby와 Admin 미션 진행상태 판정 통합 `[implemented 2026-06-24]`

- 문제: Lobby는 session activity와 timer/duration으로 화면 상태를 파생하고, Admin은 completed status 또는 session/participant 문서 존재 여부만 사용했다. 특히 activity가 있으면서 duration이 없는 세션은 Lobby가 `완료`, Admin이 `진행 중`으로 표시했다. 준비중, 시간 초과, participant만 있는 상태도 서로 달랐다. `[15.123의 Admin 3단계 상태 계약 stale 2026-06-24 → 15.124]`
- 공통 계약: `missionProgressFromSession`이 activity/timer/status snapshot을 만들고 `deriveMissionProgressStatus`가 `대기`/`준비중`/`진행중`/`시간 초과`/`완료`를 판정한다. 완료는 오직 persisted status가 completed인 경우다. activity가 있고 duration이 없으면 완료로 추정하지 않고 진행중이다.
- 데이터: Admin도 session mission 문서 ID만 보지 않고 각 문서의 snapshot을 `missionProgressById`에 저장한다. participant record만 있고 session activity가 없으면 Lobby와 동일하게 대기다. mission별 duration은 Admin mission 설정에서 전달한다.
- 온보딩: 양쪽 모두 user profile의 onboardingCompleted를 synthetic completed progress로 취급하고, 미완료는 대기로 표시한다. `[stale 2026-06-24 → 15.125: Admin도 Lobby처럼 온보딩 미완료 시 실제 세션 진행(진행중/준비중/시간 초과)을 반영하도록 변경]`
- 변경 파일: `src/lib/mission-progress.ts`, `src/app/lobby/page.tsx`, `src/app/admin/page.tsx`, `src/components/admin/admin-user-card.tsx`.

### 15.125 Admin 사용자 카드에 Lobby 온보딩 status·순차 잠금 규칙 적용 `[implemented 2026-06-24]`

- 배경: 일반 미션 status 배지는 이미 Admin도 Lobby와 동일한 `deriveMissionProgressStatus`(duration 포함)로 표시 중이었으나, 두 가지가 어긋났다. (1) 온보딩 미션은 Admin이 onboardingStatus만 보고 완료/대기로만 표시했고(Lobby는 실제 세션 진행 반영), (2) Lobby의 순차 잠금(현재/잠김) 상태가 Admin 사용자 카드에는 전혀 없었다.
- 온보딩 정렬: `adminMissionProgress`의 온보딩 분기를 Lobby와 동일하게 `missionProgressById[onboarding] ?? (onboardingStatus===completed ? synthetic completed : null)`로 바꿔, 온보딩도 진행중/준비중/시간 초과까지 표시한다. 완료 판정(잠금 계산용)은 Lobby처럼 onboarding profile flag만 사용한다.
- 순차 잠금: `isMissionCompleted` 헬퍼로 미션별 완료 플래그 배열을 만들고 `currentMissionIndex`(첫 미완료)를 구한다. `index===current`는 `현재`, `!completed && (current===-1 || index>current)`는 `잠김`으로 Lobby와 같은 규칙으로 표시한다. Admin은 관리/조회용이라 잠금은 배지+흐릿(opacity) 표시만 하고 viewAs 링크는 그대로 둔다. 완료 수 집계도 라벨 매칭 대신 완료 플래그 기준으로 바꿨다.
- 변경 파일: `src/components/admin/admin-user-card.tsx`.
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error), `npm run build` 통과. 온보딩 진행중 유저와 순차 잠금 표시는 라이브 확인이 필요하다.

### 15.126 Admin 세션 진행 누락 수정 (phantom parent 열거 문제) `[implemented 2026-06-24]`

- 증상: 같은 유저인데 Lobby는 6/10 완료로 보이고 Admin 사용자 카드는 1/10 완료(온보딩만)로, 완료한 미션이 전부 대기/잠김으로 표시됐다. 15.124에서 판정 계약은 통합했지만 Admin이 읽는 진행 데이터 자체가 비어 있었다.
- 원인: 세션 진행은 `sessions/{uid}/missions/{missionId}`에만 기록되고 부모 `sessions/{uid}` 문서는 필드 없이 비어 있다(Firestore phantom parent). Admin은 `getDocs(collection("sessions"))`로 부모를 열거해 유저를 찾은 뒤 그 하위 missions를 읽었는데, 부모가 컬렉션 쿼리에 안 잡혀 해당 유저의 mission 문서를 하나도 못 읽었다. Lobby는 로그인한 본인 uid로 `sessions/{uid}/missions`를 직접 구독하므로 영향이 없었다.
- 수정(`src/app/admin/page.tsx` loadUsers): 부모 컬렉션 열거 결과에만 의존하지 않고, 이미 모은 모든 known user id(registered + participants + missionOrder)와 실제 존재하는 sessions 부모 문서 id를 union한 뒤, 각 uid의 `sessions/{uid}/missions`를 직접 읽어 `missionProgressById`/`completedSessionMissionIds`/`sessionMissionIds`를 채운다. 빈 서브컬렉션은 건너뛴다.
- 결과: Admin도 Lobby와 동일하게 완료/시간 초과/진행중을 반영하고, 그 위에서 15.125의 순차 잠금(현재/잠김)이 올바르게 계산된다.
- 변경 파일: `src/app/admin/page.tsx`.
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 warning만), `npm run build` 통과. 실제 Admin 카드의 완료 수가 Lobby와 일치하는지 라이브 확인이 필요하다.

### 15.127 Admin 사용자 카드 중복 리뷰 링크 제거 `[implemented 2026-06-24]`

- 배경(QA Note 피드백): 완료 미션 행의 미션 제목 링크(`viewAs`)와 `리뷰` 링크(`viewAs&review=1`)가 사실상 같은 화면을 열어 차이가 없다는 지적.
- 확인: `review=1`(`isReviewMode`)이 동작에 영향을 주는 곳은 우측 패널 초기 탭 선택 한 군데뿐(`isReviewMode ? before : chat`). 읽기 전용/리뷰 주석/리뷰 탭 노출은 모두 `isReadOnly`/`showReviewAnnotations`/`isViewingAsAdmin`로 게이팅되는데 admin이 `viewAs`로 열면 `review=1` 유무와 무관하게 이미 true다. 즉 admin 맥락에서 두 링크의 유일한 차이는 처음 열리는 탭(chat vs before)뿐이고 어느 쪽이든 탭 전환으로 같은 내용을 본다.
- 수정: 중복인 `리뷰` 링크를 제거하고 미션 제목 링크만 남겼다(`/main/{id}?viewAs={uid}`). 리뷰 회고는 거기서 before/리뷰 탭으로 보면 된다.
- 변경 파일: `src/components/admin/admin-user-card.tsx`.
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error) 통과.

### 15.128 Final Design memory input 보강 (후보 비교·HTML 특징·채팅 선호) `[implemented 2026-06-25]`

- 배경(QA Note 384d 0623 NEW): 클릭 단위 저장을 세션 종료 단위 저장으로 바꾸는 일은 15.112에서 끝났으나, 남은 요구는 input을 잘 제공해 semantic이 선호 이유를 추론하게 하는 것이었다. 기존 final-design draft의 input/output은 라벨·시안명·생성일뿐이라 선택 이유나 화면 특징이 없었다.
- 결정: semantic 생성 프롬프트는 건드리지 않고 input만 보강한다(문서 철학). 세션 종료 시 비교 대상 목업 전체와 세션 채팅을 서버 enrichment LLM 패스 1회로 보내 사실 위주의 풍부한 input 텍스트를 만들고, 그 결과를 memory draft input으로 쓴다.
- 후보 범위: Final Design 셀렉터에 실제 노출된 목업(=목업이 있는 모든 시안의 board) 전체. 목업 없는 시안은 선택 불가였으므로 후보가 아니다(제외).
- HTML 조사: Design Style 메타데이터는 무시하고 각 board HTML을 직접 읽어 문구/구조/UI 스타일을 정리한다. 한 시안에 목업이 여럿이고 스타일이 균일 적용 안 될 수 있어서다. 선택안은 HTML을 크게(12000자), 나머지 후보는 작게(5000자) 자른다.
- 채팅: cleaned된 최근 16턴을 보내 사용자가 실제로 언급한 선호/반응을 추출한다. 명확한 선호가 없으면 없다고 적는다(억지 추론 금지).
- 역할 분리: enrichment 패스는 사실(무엇이 있었나)만 정리하고, 선호 이유 해석은 기존 MEMORY_ENCODE_PROMPT semantic 단계가 한다.
- 동작: enrichment 실패/데이터 없음 시 null을 반환하고 호출자가 보낸 단순 input(`최종 디자인 확정: {label}`)으로 폴백한다. final-design payload가 없는 기존 draft 호출은 동작 변화 없음.
- 변경 파일: 신규 `src/lib/memory-final-design.ts`(공유 타입), `src/lib/server/finalDesignMemoryInput.ts`(enrichment 패스, gpt-5.4-mini), `src/lib/prompts.ts`(`FINAL_DESIGN_INPUT_PROMPT`), `src/app/api/memory/drafts/route.ts`(optional `finalDesign` 수신 후 input 대체), `src/app/main/[missionId]/page.tsx`(`encodeMemoryDraft`에 finalDesign 인자 추가, 세션 종료 시 boards+chat 수집·전달).
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 warning 유지) 통과.

### 15.129 레퍼런스 검색 정정 턴 반영 (사용자 입력 우선·제외 의도) `[implemented 2026-06-25]`

- 배경(QA Note 389d): "브랜드 말고 개인 포트폴리오"처럼 방향을 트는 입력을 보내도 검색 쿼리가 이전과 거의 같았다.
- 원인: 실제 검색 쿼리는 `buildReferenceSearchQuery`가 `missionTitle + optionContext(페르소나 title+설명+content 240자) + device + baseQuery` 순으로 조립하는데, 앞쪽 고정 컨텍스트가 길고 매 턴 동일해 사용자의 새 의도(맨 뒤 baseQuery)를 희석했다. 또한 파이프라인이 덧붙이기만 해서 "말고/제외" 의도를 표현할 수 없었고, 쿼리 빌더 단계에 사용자의 raw 입력이 전달되지도 않았다(전달되는 customQuery는 에이전트가 쓴 FETCH_REFERENCES 내용).
- 수정 1(정정 턴 우선): `isCorrectiveReferenceTurn`로 정정/전환 신호(말고/아니라/대신/instead 등)를 감지해, 그 턴에서는 `buildReferenceSearchQuery`가 baseQuery(새 의도)를 앞세우고 긴 페르소나 컨텍스트는 빼고 옵션 title만 남긴다.
- 수정 2(제외 의도 처리): raw 사용자 입력을 `userRequest`로 references 라우트까지 흘려보내 쿼리 빌더 user 메시지에 "Current user request (authoritative; may contain corrections or exclusions)"로 명시하고, `referenceQueryBuilderPrompt`에 정정/부정이 있으면 거부된 방향 X를 버리고 요청한 대안 Y로 피벗하라는 규칙을 추가했다. 이 라인이 assembled context·preference context보다 우선한다.
- 변경 파일: `src/app/main/[missionId]/page.tsx`(`isCorrectiveReferenceTurn`, `buildReferenceSearchQuery` corrective 분기, `fetchReferences`에 `userRequestText` 추가, 두 호출부에서 raw text·corrective 전달), `src/app/api/references/route.ts`(`userRequest` 수신→`buildSearchQueries`), `src/lib/prompts.ts`(`referenceQueryBuilderPrompt` 제외/정정 규칙).
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error, 기존 warning 유지) 통과.

### 15.130 메모리 클러스터 화면 좌측 상세 패널화 `[implemented 2026-06-27]`

- 배경(Notion `메모리 리뷰 개편` Request 1): 기존 화면은 cluster list가 비교적 넓고 cluster summary·선택됨 badge를 표시하며, detail panel이 graph 오른쪽에 붙어 있었다. 리뷰 UI를 붙일 여지를 만들고 cluster/detail 탐색 흐름을 왼쪽에 모으기 위해 배치와 밀도를 조정했다.
- 변경: `/agent`와 `/admin/users/[uid]/memory` 공용 `MemoryClusterPage`의 본문 순서를 cluster list → cluster detail panel → similarity graph로 바꿨다. `MemoryClusterSidePanel`은 좌측 배치에 맞게 오른쪽 border를 사용한다.
- cluster list: 폭을 줄이고 summary 문장을 제거했다. 각 cluster button은 색상 점, label, memory count만 표시하고 선택 상태는 배경/border 변화로만 표현한다. 별도 `선택됨` badge는 제거했다.
- 변경 파일: `src/app/agent/page.tsx`, `src/components/memory/memory-cluster-list.tsx`, `src/components/memory/memory-cluster-side-panel.tsx`, `dev_document.md`.
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error), `npm run build` 통과. Build의 기존 presentation route NFT trace warning은 유지.

### 15.131 메모리 리뷰하기 우측 패널 추가 `[implemented 2026-06-27]`

- 배경(Notion `메모리 리뷰 개편` Request 2): 완료 세션의 메모리 리뷰 화면 오른쪽에 별도 UI처럼 보이는 `메모리 리뷰하기` 영역을 추가하고, 세션별 저장 품질과 cluster 품질을 사용자가 직접 답변할 수 있어야 했다. 특정 cluster나 단위 memory를 답변 맥락에 붙일 수 있는 `@` 언급형 참조도 필요했다.
- 변경: `MemoryReviewPanel`을 추가해 `/main/[missionId]`의 `SessionMemoryDiff` overlay에서 cluster list → detail panel → graph → review panel 순서로 배치했다. 리뷰 패널은 graph 오른쪽에 rounded card + shadow 형태로 dock된다. 질문은 `세션별로 기억해야 할 정보`와 `메모리 클러스터` 두 섹션으로 나누고 각 질문에 textarea를 제공한다. `[stale 2026-06-30 → 15.155: 질문지는 두 섹션 없이 7개 단일 번호 목록으로 변경됨]`
- mention 선택: 입력창 커서 앞에 pending `@` token이 있으면 review panel이 mention mode를 켠다. dropdown 후보를 만들지 않고 실제 메모리뷰의 cluster list와 detail panel memory card를 amber 선택 상태로 바꾸며, 사용자가 항목을 클릭하면 `@cluster(...)` 또는 `@memory(...)`가 해당 답변 안에 삽입된다. graph node 클릭도 선택 모드에서는 같은 memory mention으로 동작한다. 삽입된 mention token은 굵은 amber text로 표시되고, token 클릭 시 cluster는 해당 cluster를 선택하고 memory는 포함 cluster를 열어 해당 memory card를 선택/scroll focus한다. Esc는 선택 모드를 취소한다. `[updated 2026-06-28: 문제 표시/자동 연결 방식 대체]`
- 저장: `/api/memory/review-feedback`는 Firebase ID token으로 본인 uid를 검증하고 `users/{uid}/memoryReviewFeedback/{missionId}`에 `{ schemaVersion: 1, answers, updatedAt, submittedAt }`를 저장한다. `answers[questionId]`는 `{ text, mentions[] }`이며 mention은 `{ type, id, label, start, end }`를 가진다. UI는 draft autosave를 수행하고, `제출` 버튼은 contenteditable DOM의 최신 payload를 수집한 뒤 POST 완료를 await하고 성공 시 같은 문서의 `submittedAt`을 갱신한다.
- 변경 파일: 신규 `src/components/memory/memory-review-panel.tsx`, 신규 `src/app/api/memory/review-feedback/route.ts`, `src/app/main/[missionId]/page.tsx`, `dev_document.md`.
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint(0 error), `npm run build` 통과. Build의 기존 presentation route NFT trace warning은 유지.

### 15.132 SessionMemoryDiff keyword/weight 표시 분리 `[implemented 2026-06-28]`

- 배경(Page Feedback `/main/mission-20260611-103001?review=1`): 메모리 변화 overlay의 `MemoryClusterSidePanel`에서 Keyword 영역에 실제 keyword가 아니라 `weight ...`, `delta ...` 문자열이 보였다.
- 원인: `/main/[missionId]`의 review graph item mapping이 `keyword`/`keywords` 배열을 weight badge 대용 문자열로 채웠고, `/api/memory/session-summary`의 `graphMemories` 응답도 실제 keyword를 내려주지 않았다.
- 수정: `/api/memory/session-summary`가 memory document의 `keyword`와 `keywords`를 합쳐 dedupe한 배열을 `graphMemories.keyword`/`graphMemories.keywords`에 포함한다. `/main` review graph item은 이 값을 그대로 넘기고 `weight`는 `ClusterGraphItem.weight`에만 둔다. `MemoryClusterSidePanel` 선택 상세는 Keyword chip 블록과 Weight progress 블록을 분리한다.
- 변경 파일: `src/app/api/memory/session-summary/route.ts`, `src/app/main/[missionId]/page.tsx`, `src/components/memory/memory-cluster-side-panel.tsx`, `dev_document.md`.
- 검증: `npm run lint` 통과(0 error, 기존 warning 유지).

### 15.133 단위 memory card 접힌 상태 간소화 `[implemented 2026-06-28]`

- 배경(Notion `메모리 리뷰 개편` Request 4): 단위 memory card는 접힌 상태에서 미션 출처, 생성 시간, source/action 태그, 사용자 입력만 남기고 weight는 눌렀을 때 상세에서만 보여야 했다. source/action 태그도 영어 대신 한글이어야 했다.
- 변경: `MemoryClusterSidePanel` card header를 미션 라벨 + 시간으로 정리하고, source label을 `세션 전`/`세션 중`으로 한글화했다. action은 `references_fetch → 레퍼런스 검색` 등으로 매핑하며 `referenced`/`promoted`/`archived` 같은 리뷰 상태 토큰은 action tag에서 숨긴다. `이번 세션 신규` 텍스트 배지는 제거하고 상태는 얇은 색 막대로만 남겼다.
- 데이터: `/api/memory/session-summary`의 `graphMemories`에 `agentActionCategory`를 포함하고, `/main` review graph item이 실제 action token과 keyword를 side panel에 전달하도록 보정했다. `/agent`, `/admin`, `/main`은 가능한 경우 미션 제목을 card 출처 라벨로 넘긴다.
- 변경 파일: `src/components/memory/memory-cluster-side-panel.tsx`, `src/components/memory/memory-cluster-types.ts`, `src/app/api/memory/session-summary/route.ts`, `src/app/main/[missionId]/page.tsx`, `src/app/agent/page.tsx`, `src/app/admin/page.tsx`, `dev_document.md`.
- 검증: `npx tsc --noEmit`, `npm run lint` 통과(0 error, 기존 warning 유지).

### 15.134 메모리 리뷰하기 CTA 직접 진입 `[implemented 2026-06-28]`

- 배경(Notion `메모리 리뷰 개편` Request 5): 사용자가 `메모리 리뷰하기`를 누르면 바로 메모리뷰가 보여야 하고, 기존 우측 리뷰탭의 `메모리 변화` 탭은 제거해야 했다.
- 변경: `ChatPanel`의 리뷰 탭을 `세션 이전`/`채팅` 두 개로 줄이고, 상단 타이머 오른쪽에 `메모리 리뷰하기` CTA를 추가했다. CTA는 기존 `SessionMemoryDiff` full-screen overlay를 바로 열며, overlay 안에서 graph와 review panel을 함께 본다.
- 제거: `/main/[missionId]`의 우측 `메모리 변화` 탭 전용 요약/리스트 UI를 삭제했다. 채팅 숨김 조건도 `세션 이전` 탭에만 적용하도록 단순화했다.
- 변경 파일: `src/components/session/chat-panel.tsx`, `src/app/main/[missionId]/page.tsx`, `dev_document.md`.

### 15.135 during-session semantic 복구 + interpretationConfidence 단독 제거 `[implemented 2026-06-28]`

- 배경: 15.111의 의도는 과해석 confidence UI/필드 제거였지만, 구현에서 during-session memory의 `semantic`/`semanticJson` 생성·저장까지 같이 제거됐다. Final Design memory input prompt는 여전히 별도 semantic 단계가 있다고 설명하고 있어 실제 동작과도 어긋났다.
- 수정:
  - `MEMORY_ENCODE_PROMPT`가 `keywords`, `episode`, `semantic`을 반환하도록 복구했다. `interpretationConfidence`는 출력하지 않는다.
  - `/api/memory/drafts`의 parser와 Firestore 저장에 `semantic`/`semanticJson`을 복구하고 delete mask는 `interpretationConfidence`만 남겼다.
  - `/api/memory/complete-session`은 draft semantic을 promoted memory의 `semantic` 및 호환용 `semanticJson`으로 승격하고, `interpretationConfidence`만 삭제한다.
  - 4.7 Current Snapshot과 15.111 stale 마커를 갱신해 현행 계약이 semantic 생성 + confidence 미저장임을 명시했다.
- 검증: `npx tsc --noEmit`, `npm run lint` 통과(0 error, 기존 warning 20개 유지).

### 15.136 메모리 action 표시 라벨 공통 한국어화 `[implemented 2026-06-28]`

- 배경: action 값은 Firestore와 내부 계약상 `references_fetch`, `final_design_select` 같은 영어 token으로 유지하되, 메모리 UI chip 표시가 일부 화면에서 그대로 영어로 노출됐다.
- 수정: `memory-action-labels.ts`를 추가해 action token → 한국어 표시 라벨과 `promoted`/`referenced`/`archived` 상태 token 숨김 규칙을 공통화했다. 현행 UI 플로우에서 제거된 `presentation_create`도 표시 chip에서는 숨긴다. `style_image_preference`는 첨부 이미지가 주도한 목업 생성 후 derivedDesignStyle을 별도 memory evidence로 남기는 내부 category라 `첨부 이미지 스타일`로 표시한다. `MemoryClusterSidePanel`, `MemoryClusterDetail`, `MemoryClusterGraph` inline detail이 모두 이 formatter를 사용한다.
- 검증: `npx tsc --noEmit`, `npm run lint` 통과(0 error, 기존 warning 20개 유지).

### 15.137 레퍼런스 검색 memory context 줄바꿈 저장 `[implemented 2026-06-29]`

- 배경(Notion `UI` 0626 추가): 레퍼런스 검색 memory에서 reference search context가 비어 보이거나 title/tag/url/description/rationale이 한 줄에 붙어 보여 읽기 어려웠다.
- 수정: `formatReferenceMemoryDetail`이 각 reference의 title, tag, url, imageUrl, mode, provider, purpose, card description, rationale, agent rationale을 줄 단위로 저장하도록 변경했다. 검색 결과 memory output의 섹션명도 `reference search context:`로 맞췄다.
- 검증: `npx tsc --noEmit`, `npm run lint` 통과(0 error, 기존 warning 20개 유지).

### 15.138 admin 유저 카드 온보딩 배지 제거 `[implemented 2026-06-29]`

- 배경: 전체 참가자 세션/메모리 초기화 후 `users/{uid}`의 `onboardingCompleted`/`onboardingCompletedAt`도 삭제하기로 결정하면서, `/admin`의 유저 카드와 참가자 목록에 별도 `온보딩 필요` 배지를 표시하는 의미가 약해졌다.
- 수정: `AdminUserCard`와 `/admin` 참가자 목록에서 온보딩 상태 배지 렌더링을 제거했다. 온보딩 미션 자체의 진행 상태와 잠김/현재/완료 표시는 기존 mission progress 계산을 그대로 사용한다.
- 검증: `npx tsc --noEmit`, `npm run lint` 통과(0 error, 기존 warning 유지).

### 15.139 admin 세션 백업 후 삭제 버튼 제거 `[implemented 2026-06-29]`

- 배경: 전체 참가자 세션/메모리 데이터는 별도 백업 후 스크립트로 초기화했으며, admin 유저 카드에 destructive `세션 백업 후 삭제` 버튼을 계속 노출하면 운영 중 실수로 재실행될 수 있다.
- 수정: `AdminUserCard`에서 `세션 백업 후 삭제` 버튼을 제거하고, `/admin` 클라이언트의 해당 요청 핸들러/상태/destructive dialog 분기를 정리했다. 서버 API와 스크립트는 필요 시 명시적으로 실행할 수 있도록 유지한다.
- 검증: `npx tsc --noEmit`, `npm run lint` 통과(0 error, 기존 warning 유지).

### 15.140 admin 미션 row 세션 시간 메타 표시 `[implemented 2026-06-29]`

- 배경: `/admin` 유저 카드의 미션 진행 row에서 각 세션이 언제 시작/종료됐고 몇 분 걸렸는지 확인하고 싶지만, 기존 한 줄 레이아웃은 `온보딩현재대기`처럼 상태 badge가 붙어 보여 여유 공간이 부족했다.
- 수정: `MissionProgress`가 `endedAt`을 포함하고 `timerStartedAt`이 없으면 legacy `startedAt`도 읽도록 했다. `AdminUserCard`의 미션 row는 제목/상태 badge 첫 줄과 `시작 ... · 종료 ... · 소요 ...` 작은 메타 줄로 나뉘며, 종료 전 세션은 `경과 ...`로 표시한다. 시간이 없는 미션은 메타 줄을 숨긴다.
- 검증: `npx tsc --noEmit`, `npm run lint` 통과(0 error, 기존 warning 유지).

### 15.141 레퍼런스 재검색 weak kept context 억제 `[implemented 2026-06-29]`

- 배경: 레퍼런스 검색 결과가 빗나간 뒤 사용자가 `실제 ... 판매하는 웹사이트 없나?`처럼 현재 요청을 교정해도, 남아 있는 기존 reference 카드들이 `Kept (weak signal)`로 raw prompt와 `/api/references` query builder에 들어가 다음 검색을 흐릴 수 있었다.
- 수정: `buildReferencePreferenceContext`가 현재 user request를 받아 `실제`/`공식`/`판매`/`찾아`/`real`/`official`/`store` 등 교정·구체화 신호가 있으면 weak kept references를 제외한다. 사용자가 실제로 메시지에 인용한 cited references와 삭제된 negative references는 계속 전달한다.
- 검증: `npx tsc --noEmit`, `npm run lint` 통과(0 error, 기존 warning 유지).

### 15.142 세션 이전 memory 참고 여부 표시 제거 `[implemented 2026-06-29]`

- 배경(Notion `38dd5dc81f6680598f23c4068183182f`): 메모리 리뷰의 `세션 이전 항목` 영역에서 `세션 중 참고됨` 카운트와 카드 강조가 표시되어 채팅 영역 카드와 UI 결이 달랐다. 사용자는 세션 중 참고 여부를 별도로 표시하지 않아도 된다고 판단했다.
- 수정: `세션 중 참고됨` 통계 카드와 `세션 이전 항목` count 카드를 제거하고, 세션 이전 memory 카드의 referenced 파란 강조/상태 라벨/weight delta 표시를 없앴다. `MemoryCard`의 status bar는 라벨/weight가 있을 때만 표시되며, 목록 정렬도 referenced 우선이 아니라 weight 기준으로만 정렬한다.
- 검증: `npx tsc --noEmit`, `npm run lint` 통과(0 error, 기존 warning 20개 유지).

### 15.143 main/review 왼쪽 패널 디자인 톤 정리 `[implemented 2026-06-29]`

- 배경(Notion `UI 38dd5dc81f6680308d6fc65258f8d0e2`): main 화면의 왼쪽 작업 패널을 첨부 예시처럼 더 통일된 패널 디자인으로 정리해야 했다.
- 수정: main 왼쪽 content panel에 은은한 slate 배경과 sticky top tab bar를 적용하고, Mission/Reference/Workspace/Final 외곽 카드를 `rounded-2xl border bg-white shadow-sm p-5` 톤으로 통일했다. 추가 피드백에 따라 세션 리뷰 overlay(`SessionMemoryDiff`)의 body도 slate 배경 + padding을 적용했다. `MemoryClusterList`는 review presentation에서 shadcn sidebar 토큰(`bg-sidebar`, `border-sidebar-border`, `sidebar-accent`)을 사용하며, 둥근 패널 안에 왼쪽 컬러 숫자 블록이 있는 클러스터 카드로 표시한다. shadcn `ScrollArea` wrapper가 중첩 레이어처럼 보일 수 있어 해당 목록은 native overflow scroll을 사용하고, 패널/아이템의 중첩 shadow는 제거해 border/selected ring 중심으로 상태를 표현한다. 기존 섹션 구조와 내부 동작은 유지한다.
- 검증: `npx tsc --noEmit`, `npm run lint` 통과(0 error, 기존 warning 유지).

### 15.144 전체 메모리 데이터 보기 클러스터 미표시 수정 + 워딩 변경 `[implemented 2026-06-29]`

- 배경(Notion QA `메모리 싱크` 38dd5dc81f668093996bdb07e898ed08): 같은 사용자의 메모리가 리뷰하기 화면에는 클러스터로 보이는데 로비의 `전체 메모리 데이터 보기`(`/agent`)에는 안 떴다. 또한 평가/리뷰는 리뷰하기 화면에서만 하므로 `평가하기` 워딩이 부적절했다.
- 원인 확정(2026-06-28 백업 데이터로 검증):
  - 두 화면 모두 `users/{uid}/memories_0_1_2`를 읽고 memory item set 자체는 동일했다(weight null 0개, 300 상한 미달).
  - 차이는 cluster cache 조회 방식이었다. session-summary(리뷰)는 `memoryClusters` 컬렉션을 variant 무관/signature 무관하게 best-effort로 골라 보여줬고, `/api/memory/clusters` GET(전체보기)은 15.24 결정대로 `(MEMORY_VERSION, 현재 itemSignature, variant)` 정확 일치 문서만 조회해 mismatch면 빈 배열을 반환했다.
  - 그 결과 메모리가 추가/아카이브되어 signature가 drift되거나, cluster가 다른 variant(예: full-context)로만 생성된 사용자는 전체보기에서 클러스터가 통째로 사라졌다.
- 수정:
  - `memoryClustering.ts`에 `loadLatestStoredClusterDoc(uid, token, variant)` 추가(해당 variant 최신 cache 문서를 graphClusters/graphEdges/generatedAt/itemSignature까지 반환). 기존 `loadLatestStoredClusters`는 이 헬퍼를 호출하도록 재구성.
  - user/admin `/api/memory/clusters` GET 양쪽에서 정확 signature 문서가 없으면 빈 배열 대신 `loadLatestStoredClusterDoc`로 fallback하고 응답에 `stale` 플래그를 추가했다. signature 일치 시 `stale: false`. 클라이언트는 item id가 전혀 안 맞을 때만 `hasStaleCache` 경고를 띄우므로 부분 일치 시에는 클러스터가 조용히 표시된다. `[stale 2026-06-29 → 15.147: 정확 signature 우선 로직 제거, 항상 latest-per-variant 반환]`
  - 워딩: 로비 버튼 `에이전트 메모리 평가하기` → `전체 메모리 데이터 보기`, `/agent` 헤더 `에이전트 기억` → `전체 메모리 데이터`.
  - 의도 확인: 리뷰하기 그래프가 기본적으로 세션 변화분(`memoryGraphFilter="changed"`, phase `before`)만 보여주는 것은 의도된 동작이라 변경하지 않았다. `[stale 2026-06-29 → 15.148: /agent와 단일 세션 클러스터 비교가 가능하도록 기본 필터를 전체로 변경]`
- 검증: `npx tsc --noEmit` 0 error.

### 15.145 리뷰 클러스터 variant 탭 추가 `[implemented 2026-06-29]`

- 배경: 리뷰하기(`?review=1` overlay)가 보여주는 클러스터는 `clusteringInputVariant`를 보지 않고 `sourceItemCount`가 가장 근접한 cache 문서를 골랐다. 그래서 사용자는 그 클러스터가 compact-context(keyword·episodic·semantic)인지 full-context(…input·output·link)인지 알 수 없었고, 전체보기(`/agent`)처럼 둘을 비교할 수도 없었다.
- 수정:
  - `/api/memory/session-summary`가 cache 문서를 variant별로 그룹핑해 각 variant의 문서를 `clustersByVariant: { compact-context, full-context }`로 반환한다. 기존 `graphClusters`/`graphEdges`(variant 무관 default)는 호환용으로 유지. `[stale 2026-06-29 → 15.147: variant별 선택을 sourceItemCount 근접에서 latest-per-variant로 변경]`
  - main 리뷰 화면에 `reviewClusterVariant` state를 추가하고, `SessionMemoryDiff` 헤더 우측에 variant 탭(전체보기와 동일 라벨)을 둔다. 그래프/엣지는 선택 variant의 cache를 쓰되, 그 variant에 cache가 없으면 variant 무관 default로 폴백해 화면이 비지 않게 했다.
  - `SessionMemoryDiff`는 `headerActions`(헤더 우측 variant 탭)와 `toolbar`(헤더 아래 sub-bar) prop으로 분리했다. 세션 이전/이후 phase 토글은 전체보기(`/agent`)의 필터 bar와 같은 위치인 헤더 아래 sub-bar에 배치한다.
- 검증: `npx tsc --noEmit` 0 error.

### 15.146 세션 종료 시 두 클러스터 variant 자동 생성 `[implemented 2026-06-29]`

- 배경: 세션 종료 흐름의 클러스터 생성 호출(`POST /api/memory/clusters`)이 variant 없이 한 번만 불려 `compact-context`만 자동 생성됐다. `full-context`는 /agent·admin 재생성 버튼으로 수동 생성할 때만 존재해, 리뷰의 full-context 탭이 대부분 비어 있었다.
- 수정: 세션 종료(`completeSession`)에서 `compact-context`/`full-context` 두 variant에 대해 `POST /api/memory/clusters`를 병렬 호출하도록 변경(각 variant는 별도 cache 문서). clustering 실패는 기존대로 non-fatal. 메모리 3개 미만이면 양쪽 모두 생성되지 않는 제약은 유지.
- 검증: `npx tsc --noEmit` 0 error.

### 15.147 클러스터 문서 선택 규칙 통일 (latest-per-variant) `[implemented 2026-06-29]`

- 배경: 전체보기(`/agent`)와 리뷰가 같은 variant라도 서로 다른 cache 문서를 보여줄 수 있었다. 원인은 (1) variant당 cache 문서가 누적되고, (2) 두 화면의 선택 휴리스틱이 달랐기 때문이다 — 전체보기는 정확 시그니처 우선 후 fallback(15.144), 리뷰는 `sourceItemCount` 근접(15.145).
- 수정: 양쪽 모두 해당 variant에서 **`generatedAt`이 가장 최신인 cache 문서**를 고르도록 통일했다.
  - `/api/memory/clusters` GET(user/admin): 정확 시그니처 조회를 제거하고 항상 `loadLatestStoredClusterDoc(variant)` 결과를 반환한다. `items.length < 3` 조기 반환도 제거(리뷰처럼 문서가 있으면 보여줌). 현재 메모리 시그니처와 다르면 `stale: true`로 표시.
  - `/api/memory/session-summary`: `clustersByVariant`를 `sourceItemCount` 근접 대신 variant별 최신 문서로 선택.
- 효과: cache 문서가 몇 개든, 자동 생성이든 재생성 버튼이든, 같은 variant면 두 화면이 항상 같은 클러스터 문서를 본다. (노드/메모리 집합 차이는 리뷰의 의도된 필터라 별개로 유지.)
- 검증: `npx tsc --noEmit` 0 error, 변경 라우트 eslint 통과.

### 15.148 리뷰 overlay 기본 클러스터 필터 전체화 `[implemented 2026-06-29]`

- 배경: 리뷰 overlay와 `/agent`가 모두 compact/full variant 탭을 제공하고 최신 variant cache 문서를 공유해도, 리뷰 overlay는 내부 `memoryGraphFilter`가 `changed`로 고정되어 있었다. 필터 UI가 없어 사용자는 이를 바꿀 수 없었고, 단일 세션만 수행한 경우에도 before-session memory처럼 참조/생성/아카이브 상태가 아닌 항목은 리뷰 클러스터에서 빠져 `/agent`와 다르게 보였다.
- 수정: 리뷰 overlay의 기본 `memoryGraphFilter`를 `all`로 변경했다. 같은 variant와 같은 세션 범위에서는 cluster membership/count가 `/agent`와 비교 가능하게 유지된다. `세션 이전` phase에서 해당 세션 promoted memory를 제외하는 시간 비교 동작은 유지한다.
- 문서: 4.7 Current Snapshot에 리뷰 overlay의 기본 전체 필터와 단일 세션 비교 계약을 추가하고, 15.144의 `changed` 고정 의도 문구를 stale 처리했다.

### 15.149 /agent 세션 누적 필터 missionOrder 정렬 `[implemented 2026-06-30]`

- 배경: `/agent`에서 세션 필터를 선택하면 선택 세션까지의 누적 메모리를 보여주고, 선택 세션에서 새로 생성된 메모리를 다이아몬드로 표시한다. 그러나 누적 판정이 미션 ID 문자열 순서를 사용하고 있어, 유저별 랜덤 `missionOrder`가 ID 시간순과 다르면 세션 리뷰 overlay의 `세션 이후`와 다른 메모리 집합을 보여줄 수 있었다.
- 수정: `/agent`가 메모리 목록 API 응답의 `missionOrder`를 사용해 리뷰 화면과 같은 누적 판정 함수를 사용한다. 클라이언트 Firestore 직접 조회는 rules에 막힐 수 있으므로 쓰지 않는다. `missionOrder`를 읽지 못했거나 선택 미션이 order에 없으면 onboarding + 선택 미션만 보여주는 보수적 fallback을 사용한다.
- 효과: 같은 variant에서 `/agent`의 세션 필터와 해당 세션 리뷰 overlay의 `세션 이후`가 같은 cluster membership/count를 비교할 수 있다.

### 15.150 리뷰 그래프 embedding projection 입력 보존 `[implemented 2026-06-30]`

- 배경: `/agent`와 리뷰 overlay가 같은 cluster membership을 쓰더라도 점 위치가 달랐다. `/agent`는 `/api/memory/all`의 memory `embedding`을 `MemoryClusterGraph`에 전달해 PCA/similarity graph layout의 초기 좌표로 쓰지만, `/api/memory/session-summary`의 `graphMemories`는 `embedding`을 누락해 리뷰 overlay가 `0/N embedded points` fallback 좌표를 사용했다.
- 수정: `/api/memory/session-summary`의 compact memory/graph memory 응답에 `embedding`을 포함하고, `/main` 리뷰 graph item mapping에서 `MemoryClusterGraph`로 전달한다.
- 효과: 같은 item set과 같은 cluster/edge cache를 보는 `/agent` 세션 필터와 리뷰 overlay `세션 이후`가 같은 embedding projection 입력을 사용하므로 점 위치가 일관된다.

### 15.151 최종 디자인 선택 memory card 요약 축약 `[implemented 2026-06-30]`

- 배경(Notion `Card UI`): 세션 리뷰 timeline의 최종 디자인 확정 카드가 `artboardId`, 생성일 등 세부 정보를 카드 요약에 길게 노출했다. 해당 세부 정보는 Original input 영역에서 확인할 수 있으므로 카드에는 확정 대상만 보여주면 된다.
- 수정: `final_design_select` 이벤트 요약은 memory input의 첫 줄만 사용하고, `최종 디자인 확정: 시안 · 라벨`을 `최종디자인 시안 확정: 시안 * 라벨` 형태로 정리한다. output의 `artboardId / 시안 / 생성일` 상세는 카드 요약에서 사용하지 않는다.

### 15.152 Memory side panel minor UI 정리 `[implemented 2026-06-30]`

- 배경(Notion `UI minor`): 메모리 side panel 카드의 선택 상태와 weight/출처 정보가 중복되거나 과하게 보여 스캔성이 떨어졌다.
- 수정: included memory item 선택 시 `선택됨` visible badge를 제거하고 border/ring 상태만 유지한다. 새 기억을 나타내는 왼쪽 막대는 초록색 대신 검정 계열로 통일했다. 펼친 상세의 Weight는 게이지 없이 숫자만 표시하고, 카드 상단에 이미 미션명이 있으므로 하단의 중복 미션 라벨은 제거했다. Design Style 헤더의 `미정의`/`설정됨` badge를 제거하고 empty-state padding도 Design Brief empty-state와 맞췄다. `/agent`의 onboarding mission label은 raw id 축약(`onboarding…`) 대신 `온보딩`으로 표시한다.

### 15.153 UPDATE_NOTE 얇은 Design Brief payload 복구 `[implemented 2026-06-30]`

- 배경(Notion `38ed5dc81f6680308818d1231aa47eb9`): 사용자가 디자인 브리프 생성을 요청했을 때 채팅 응답 본문에는 긴 브리프가 표시됐지만, 실제 Design Brief 영역에는 `Design brief updated...` 같은 짧은 상태 문구만 저장되는 사례가 있었다.
- 원인: 15.98의 한 줄 브리프 방어는 `CREATE_NOTE` 경로에만 적용됐다. 기존 빈 시안/활성 시안 갱신처럼 모델이 `UPDATE_NOTE`를 emit하는 경로에서는 payload가 얇아도 그대로 저장했고, action 밖 assistant 본문에 있는 실제 브리프를 저장 후보로 보지 않았다.
- 수정: note action 저장 전에 공통 `resolveDesignBriefPayload()`를 거치게 했다. payload가 실질 브리프가 아니면 먼저 action block을 제거한 assistant 응답 본문에서 실질 브리프를 복구하고, `CREATE_NOTE` 또는 디자인 브리프 생성/작성 성격의 `UPDATE_NOTE`에 한해 미션 맥락 기반 복구를 fallback으로 적용한다. 일반적인 의도적 짧은 `UPDATE_NOTE`는 그대로 허용한다.
- 문서: 4.6 Current Snapshot의 `CREATE_NOTE`/`UPDATE_NOTE` 저장 계약을 새 복구 순서에 맞게 갱신했다.

### 15.154 세션 초반 Design Style 생성 허용 `[implemented 2026-06-30]`

- 배경(Notion `38ed5dc81f6680989f97f4fc64078732`): `/디자인스타일생성`을 세션 초반부터 사용할 수 있어야 했다. `[stale 2026-07-13 → 15.215: 현행 visible label은 `/디자인스타일작성`]`
- 원인: runtime은 `CREATE_DESIGN_SPEC`가 현재 아이디어가 없을 때 빈 시안을 만들고 스타일을 저장할 수 있었지만, composer command UI가 Design Brief가 없으면 `/디자인스타일생성`을 비활성화했다. `[stale 2026-07-13 → 15.215: 현행 visible label은 `/디자인스타일작성`]`
- 수정: `/디자인스타일생성`은 현재 시안에 이미 Design Style이 있을 때만 비활성화한다. 빈 디폴트 시안 또는 Design Brief 없는 시안에도 먼저 스타일을 저장할 수 있고, 이후 첫 Design Brief는 기존 shell-fill 규칙으로 같은 시안을 채운다. `[stale 2026-07-13 → 15.215: 현행 visible label은 `/디자인스타일작성`]`
- 문서: 4.6 Current Snapshot의 `CREATE_DESIGN_SPEC` 계약을 Design Brief 선행 불필요 흐름에 맞게 갱신했다.

### 15.155 메모리 리뷰 질문지와 제출 흐름 업데이트 `[implemented 2026-06-30]`

- 배경(Notion `38ed5dc81f6680598a27e91069ce3e12`): 메모리 리뷰 질문지를 두 파트로 나누지 않고 번호만 붙인 7문항으로 바꾸고, 모든 칸 입력 전 제출을 막으며, 제출 확인 팝업 후 로비로 이동해야 했다.
- 수정: `MemoryReviewPanel`의 질문 배열을 새 7문항 단일 목록으로 교체하고 섹션 헤더를 제거했다. contenteditable 입력 변화가 제출 가능 상태에 반영되도록 completion revision을 추가했다.
- 제출: 모든 질문의 text가 비어 있지 않을 때만 제출 버튼을 활성화한다. 제출 클릭 시 `제출 완료하겠습니까?` 확인 팝업을 띄우고, feedback POST가 성공하면 `/lobby`로 이동한다.
- 문서: 4.1 Current Snapshot의 메모리 리뷰 질문/제출 계약을 갱신하고, 15.131의 두 섹션 질문지 설명을 stale 처리했다.

### 15.156 메모리 리뷰 완료 상태 표시 `[implemented 2026-06-30]`

- 배경: 리뷰 제출 후 유저와 관리자가 완료 여부를 어디서 확인할지 정해야 했다. 배지를 과하게 늘리지 않기 위해 완료된 항목에만 조용한 `리뷰 완료` 배지를 표시하기로 했다.
- 수정: 로비 완료 미션 카드는 `/api/memory/review-feedback`의 `submittedAt`을 확인해 제출 완료된 미션에만 상단 상태 배지 영역에 `리뷰 완료`를 표시한다. CTA는 오른쪽 아래에 유지하며, 제출 전에는 `리뷰하기`, 제출 후에는 `리뷰 보기`로 표시한다.
- 관리자: admin 참여자 팝업은 각 participant의 `memoryReviewFeedback/{missionId}.submittedAt`을 admin GET API로 조회하고, 제출 완료 row에만 작은 `리뷰 완료` 배지를 프로필 메타 영역에 표시한다. 오른쪽 액션 영역은 세션 보기, 리뷰, 삭제 같은 조작만 유지한다.
- source of truth: 완료 여부는 `users/{uid}/memoryReviewFeedback/{missionId}.submittedAt` 존재 여부다.

### 15.157 composer 명령/언급 inline token화 `[implemented 2026-06-30]`

- 배경(Notion `38ed5dc81f6680ebb58ad55c795fe1b0`): `@`/`/` 선택 후 선택값이 입력창 위 chip으로 올라가는 인터랙션이 어색했다. 사용자가 쓴 문장 안에 `@시안 1 ... 업데이트`처럼 자연스럽게 보이고, memory summary에도 `mentioned artifact`/`user input` 메타 라인이 아니라 실제 입력문만 보여야 했다.
- 수정: `ChatInput`의 자동완성 선택은 trigger text를 제거하지 않고 textarea 안에 `/명령` 또는 `@대상 라벨` inline token을 삽입한다. 별도 composer chip UI는 제거했다. token 부분은 textarea overlay highlight layer로 bold/color 처리한다. 사용자가 inline token을 지우면 구조화 `composerCommand`/`composerMention` metadata도 함께 clear된다.
- 메모리: chat turn의 memory draft input은 `explicit command`, `mentioned artifact`, `user input`을 합친 문자열 대신 사용자가 본 실제 `text`만 저장한다. 구조화 command/mention metadata는 기존처럼 `/api/chat` 요청과 user message 객체에 별도로 보존해 planner와 mention scoping에는 계속 사용한다.
- 문서: 4.6 Current Snapshot을 inline token 계약으로 갱신하고, 15.108의 composer chip 전제를 stale 처리했다.

### 15.158 assistant 처리 과정 Marker-style 정리 `[implemented 2026-06-30]`

- 배경: shadcn Marker 문서를 참고해 chatting interface의 assistant 진행 상태/phase 표시를 더 낮은 위계의 status row로 정리할 수 있는지 검토했다.
- 수정: `ChatBubble`의 `처리 과정 N개` disclosure 내부 phase 항목을 `ChatPhaseMarker`로 분리하고, active phase는 `role=status`, `aria-live=polite`, pulsing dot indicator를 가진 bordered row로 표시한다. 완료된 phase는 muted row + check indicator로 표시한다.
- 의도: assistant 본문/툴 action chip과 진행 상태가 섞여 보이지 않게 하고, streaming 중인 마지막 단계만 status marker처럼 강조한다. 기존 disclosure 저장/접기 동작과 `chatPhases` persistence는 유지한다.

### 15.159 assistant bubble surface 정리 `[implemented 2026-06-30]`

- 배경: shadcn Bubble 문서의 message variant 관점을 chatting interface에 적용할 수 있는지 검토했다. 기존 assistant bubble은 모든 응답이 회색 카드처럼 보여 phase, action chip, 본문이 한 덩어리로 무겁게 보였다.
- 수정: `ChatBubble`에서 user message는 기존 dark filled bubble을 유지하고, assistant message 기본 상태는 ghost surface로 전환했다. 선택된 assistant turn은 violet surface를 유지하고, error turn은 옅은 red surface를 부여해 상태 구분을 남긴다.
- 의도: assistant 응답 본문은 대화 흐름처럼 가볍게 읽히고, 실제로 주목해야 하는 선택 상태/오류/진행 상태만 별도 surface로 보이게 한다.

### 15.160 공용 Skeleton shimmer 적용 `[implemented 2026-06-30]`

- 배경(Notion `38ed5dc81f66802589d8e3b0923f7a39`): loading placeholder가 단순 pulse에 머물러 있어, mockup canvas pending artboard의 shimmer와 앱 전반의 skeleton 표현이 맞지 않았다. Notion page는 integration 권한 문제로 직접 fetch하지 못해 제목과 로컬 코드 기준으로 적용했다.
- 수정: `Skeleton` 공용 컴포넌트를 overflow-hidden surface + `vda-shimmer` sweep pseudo-element로 변경했다. 로비 미션 목록 loading placeholder는 수동 `animate-pulse` div 대신 공용 `Skeleton`을 사용한다.
- 의도: 페이지 로딩은 과한 entrance animation 없이 조용한 shimmer로 통일하고, mockup canvas의 도메인 맞춤 pending artboard shimmer는 유지한다.

### 15.161 세션 종료 진행 모달 문구 shimmer 적용 `[implemented 2026-06-30]`

- 배경: 세션 종료 버튼을 누른 뒤 메모리 저장, 클러스터 분석, 리뷰 준비를 기다리는 진행 모달의 상태 문구에도 shimmer 감각을 맞추고 싶었다.
- 수정: 전역 `vda-text-shimmer` 유틸을 색상 변수 기반으로 추가하고, 세션 종료 진행 모달의 진행 중 상태 문구에 slate shimmer를 적용했다. 최종 디자인 미선택 인라인 경고와 완료 상태 문구는 정적 텍스트로 유지한다.
- 의도: skeleton loading과 같은 큰 placeholder가 아니라, 실제 await 경계마다 바뀌는 진행 문구에만 은근한 sweep 강조를 준다.

### 15.162 메인 좌측 패널 sticky section nav 배경 제거 `[implemented 2026-06-30]`

- 배경(Page Feedback `/main/mission-20260611-103001`): 좌측 패널의 sticky section nav가 스크롤 중 헤더와 애매하게 떨어진 회색 배경 띠처럼 보여 떠 있는 느낌이 났다.
- 수정: sticky wrapper의 `border`, `bg-slate-50/95`, `backdrop-blur`를 제거하고 안쪽 segmented control만 유지했다.
- 의도: header에 붙은 별도 subheader처럼 보이게 만들기보다, 배경 띠를 없애 floating control로 가볍게 보이도록 한다.

### 15.163 ToolActionChip Marker-style row 정리 `[implemented 2026-06-30]`

- 배경(Page Feedback `/main/mission-20260611-103001`): `웹 검색 완료` 같은 assistant tool action chip이 shadcn Marker/Bubble 스타일과 따로 노는 작은 카드처럼 보여, 같은 marker visual language로 정리할 필요가 있었다.
- 수정: `ToolActionChip`을 rounded card chip에서 상태 indicator가 있는 Marker-style clickable row로 변경했다. 완료, 진행, 실패 상태는 indicator icon/tone으로 구분하고, row를 클릭하면 기존처럼 원문 action marker 세부 내용을 펼친다.
- 의도: assistant phase marker, web searched marker, action marker가 모두 같은 낮은 위계의 status row처럼 보이게 한다.

### 15.164 ChatInput source attachment tray 정리 `[implemented 2026-06-30]`

- 배경(Page Feedback `/main/mission-20260611-103001`): ChatInput 위 선택 요소, 텍스트 인용, 레퍼런스 인용, 스타일 이미지 UI가 각각 다른 배경 박스로 쌓여 composer와 어긋나 보였다. shadcn Attachment 문서의 item 구조를 참고해 한 줄 tray로 통일하기로 했다.
- 수정: `ChatInput`에 `ComposerAttachment` helper를 추가하고, selected element, cited text, selected reference, style image를 동일한 rounded attachment item으로 렌더한다. 각 item은 media/icon, title, description, remove action을 갖고, 여러 항목은 horizontal scroll tray에 놓인다. 텍스트/레퍼런스 다중 선택의 전체 해제 action은 trailing button으로 유지한다.
- 의도: composer가 가진 source context를 칩 묶음이 아니라 첨부 파일 목록처럼 읽히게 하고, 선택/해제 조작을 같은 패턴으로 맞춘다.

### 15.165 로비 완료 미션 리뷰 필요 배지 추가 `[implemented 2026-06-30]`

- 배경: 로비 완료 미션 카드에는 `리뷰 완료` 배지는 있었지만 아직 제출하지 않은 완료 미션의 `리뷰 필요` 상태가 상단 메타 영역에 보이지 않았다.
- 수정: `MissionCard`는 완료 미션이면 항상 리뷰 상태 배지를 표시한다. `submittedAt`이 있으면 `리뷰 완료`, 없으면 amber tone의 `리뷰 필요` 배지를 보여준다. CTA는 기존처럼 제출 전 `리뷰하기`, 제출 후 `리뷰 보기`를 유지한다.
- 의도: 완료 미션의 다음 행동 필요 여부를 CTA 영역뿐 아니라 카드 상단 상태 메타에서도 즉시 읽히게 한다.

### 15.166 admin 유저 카드 미션 row 리뷰 상태 배지 추가 `[implemented 2026-06-30]`

- 배경(Page Feedback `/admin`): admin 유저 카드의 미션별 list item에도 로비처럼 `리뷰 필요`/`리뷰 완료` 상태가 보여야 했다.
- 수정: admin user loading 시 완료 미션별 `/api/memory/review-feedback` 제출 상태를 hydrate해 `memoryReviewSubmittedByMissionId` map으로 저장한다. `AdminUserCard`는 완료된 미션 row에 `submittedAt` 여부에 따라 `리뷰 필요` 또는 `리뷰 완료` 배지를 표시한다.
- 의도: 관리자가 유저별 미션 진행 목록만 봐도 어떤 완료 세션에 리뷰가 남았는지 바로 알 수 있게 한다.

### 15.167 admin 참여자 모달 높이 제한 및 리뷰 상태 배지 정리 `[implemented 2026-06-30]`

- 배경(Page Feedback `/admin`): 참여자 모달이 긴 목록만큼 커져 viewport 위아래가 잘렸고, row에는 `리뷰 완료`만 보여 `리뷰 필요` 상태가 드러나지 않았다.
- 수정: 참여자 모달 overlay에 viewport padding을 주고, modal card를 `max-height: calc(100vh - 3rem)` flex column으로 바꿨다. 헤더는 고정하고 참여자 list 영역만 내부 스크롤한다. 각 참여자 row는 `submittedAt` 여부에 따라 `리뷰 필요` 또는 `리뷰 완료` 배지를 표시한다.
- 의도: 긴 참여자 목록에서도 모달 상단/하단 CTA가 잘리지 않고, admin이 리뷰 미제출 참여자를 바로 식별할 수 있게 한다.

### 15.168 /agent cluster list와 graph 색상 기준 통일 `[implemented 2026-06-30]`

- 배경(Page Feedback `/agent`): 세션 필터 선택 시 왼쪽 cluster list와 오른쪽 graph의 cluster 색이 서로 달랐다. 화면에서도 list는 `3개 클러스터`, graph는 `5 clusters`로 서로 다른 cluster 집합을 기준으로 렌더되고 있었다.
- 원인: list에는 `filteredClusters`를 전달했지만 graph에는 전체 `clusters`를 전달했다. 두 컴포넌트 모두 공용 `memoryClusterColor(index)`를 쓰지만, index를 계산하는 cluster 배열이 달라 색이 어긋났다.
- 수정: `/agent`의 `MemoryClusterGraph`도 `filteredClusters`를 받도록 변경했다.
- 의도: 세션 필터가 적용된 상태에서 list, side panel, graph가 같은 cluster 집합과 같은 색상 index를 공유하게 한다.

### 15.169 /agent·admin cluster list를 review presentation으로 통일 `[implemented 2026-06-30]`

- 배경(Page Feedback): main 세션 리뷰의 `MemoryClusterList`(`presentation="review"`)를 가리키며 이것처럼 해줘, `/agent`의 cluster list를 가리키며 이걸 — 즉 `/agent` cluster list를 review 스타일로 맞춰달라는 요청.
- 기존: `/agent`(와 이를 재사용하는 `/admin/users/[uid]/memory`)는 default presentation을 써서 폭 좁은 w-44 목록에 색상 점·label·count badge만 표시했다. main 세션 리뷰는 색상 count rail이 달린 rounded card와 좌측 접기 rail을 쓰는 review presentation이었다.
- 수정: `MemoryClusterPage`의 `MemoryClusterList`에 `presentation="review"`를 전달하고, 감싸는 행에 `gap-4 p-4`를 주어 floating rounded card에 여백을 확보했다. 오른쪽 detail/graph 영역도 main 리뷰처럼 rounded-2xl border bg-white shadow-sm 카드로 감쌌다.
- 영향 범위: `MemoryClusterPage`가 공용이라 `/agent`와 admin memory 진단 페이지 양쪽이 동시에 바뀐다.

### 15.170 /agent cluster list 재생성 버튼 제거 `[implemented 2026-06-30]`

- 배경(Page Feedback `/agent`): cluster list 안의 재생성 버튼을 없애달라는 요청.
- 수정: `MemoryClusterPage`의 `MemoryClusterList` 호출에서 `onRegenerate`를 더 이상 전달하지 않는다. `MemoryClusterList`는 `onRegenerate`가 없으면 버튼을 렌더하지 않으므로 추가 컴포넌트 변경은 없다.
- 결과: 클러스터가 이미 있을 때 list 상단의 재생성 트리거가 사라진다. clustering 재생성은 클러스터가 비어 있을 때의 `MemoryClusterEmptyState` 생성 버튼(`handleRegenerate`)으로만 남는다.
- 영향 범위: `MemoryClusterPage` 공용이라 `/agent`와 admin memory 진단 페이지 양쪽에서 버튼이 사라진다.

### 15.171 디자인 브리프 요청이 디자인 스타일로 분류되던 문제 수정 `[implemented 2026-06-30]`

- 배경(QA Note Bug): 사용자가 디자인 브리프 작성을 요청했는데 에이전트가 디자인 스타일(CREATE_DESIGN_SPEC)을 만들었다.
- 원인: planner intent 분류 프롬프트(`chatPlannerPrompt`)에 디자인 브리프(시안)와 디자인 스타일을 구분하는 규칙이 없었다. create_design_spec 규칙의 키워드 그물이 넓고, 디자인 브리프 작성 같은 요청이 디자인이라는 단어와 문서 작성 성격 때문에 create_design_spec으로 끌려갔다.
- 수정: planner 규칙에 디자인 브리프 = 제품/UX 시안(create_note 또는 update_note)이고 디자인 스타일 = 시각 스타일 레이어(create_design_spec)라는 분기를 명시했다. 디자인이라는 단어만으로 디자인 스타일을 의미하지 않는다는 점도 적었다.
- 메인 system prompt(CHAT_NOTE_ACTION_PROMPT 등)는 이미 둘을 구분하고 있어 그대로 두고, 분류 단계만 보강했다.

### 15.172 레퍼런스 검색에서 Serper 제거, OpenAI web search 원툴화 `[implemented 2026-06-30]`

- 배경(QA Note): Serper API가 free 계정에서 `400 Query pattern not allowed for free accounts`를 내고 사이트 검색도 막혀 style 레퍼런스 검색이 완전히 죽어 있었다. 사용자가 Serper를 제거하고 OpenAI API 원툴로 가자고 결정했다.
- 기존: product 모드만 OpenAI `web_search_preview`를 쓰고, style 모드는 Serper `/images` 이미지 검색과 `/search` 큐레이션(`site:` 연산자) 검색으로 이미지 후보를 모은 뒤 OpenAI로 재랭킹했다. free 플랜이 이 쿼리 패턴을 거부했다.
- 수정: style·product 모드를 모두 `searchWebReferences(mode, ...)` 단일 OpenAI `web_search_preview` 경로로 통합했다. 모드는 시스템 프롬프트(신규 `referenceStyleSearchPrompt` vs 기존 `referenceProductSearchPrompt`)와 저품질 필터만 다르게 고른다. 썸네일은 결과 페이지의 og:image를 `hydrateReferenceMetadata()`로 추출한다.
- 제거: `SERPER_API_KEY`, `CURATION_DOMAINS`, `searchImages`, `searchCurationSites`, 이미지 후보/재랭킹 파이프라인과 `serper-image` searchProvider. 모든 카드의 provider는 이제 `openai-web`. UI 타입(`reference-card.tsx`, `main/[missionId]/page.tsx`)과 `referenceSourceAnalysis`의 serper 분기도 정리했다.
- 트레이드오프: 전용 이미지 검색이 빠져 style 썸네일은 og:image 품질에 의존한다. 다만 기존 style 검색이 이미 깨져 있었으므로 net 개선이다.
- 후속: `scripts/reference_source_probe.mjs`와 `.env`의 `SERPER_API_KEY`는 빌드와 무관해 손대지 않았다 — 정리는 사용자 몫.

### 15.173 목업 annotation 버튼을 영역 선택으로 정리 `[implemented 2026-07-02]`

- 배경(Notion `minor`): 목업 toolbar의 `편집` 문구가 화면을 직접 수정하는 기능처럼 보였다. 실제 동작은 mockup iframe 안의 요소를 선택해 채팅 수정 요청의 target context로 넘기는 annotation/selection 모드다.
- 수정: `MockupCanvasToolbar`의 버튼 문구를 `편집`/`편집 중`에서 `영역 선택`/`선택 종료`로 바꾸고, 아이콘을 `Pencil`에서 `SquareDashedMousePointer`로 교체했다. product tour 문구도 `영역 선택 버튼`으로 맞췄다. 확장 캔버스의 토글도 `영역 선택 On/Off`로 변경했다. active 상태는 버튼 클릭 시 선택 모드를 끄는 action이므로 상태형 `선택 중` 대신 명령형 `선택 종료`를 쓴다. iframe selection script에는 hover preview(`data-vda-hovered`)를 추가해 클릭 전에 선택될 영역을 dashed outline으로 보여준다.
- 전달 방식: Stitch SDK의 `edit_screens`는 element/region 파라미터 없이 `selectedScreenIds`와 text prompt만 받는다. 그래서 선택된 요소의 `selector`, `outerHTML`, `textContent`, `xpath`, viewport 기준 `boundingRect`를 iframe에서 수집하고, chat selected-element context와 최종 Stitch edit prompt 양쪽에 target block으로 주입한다.
- 의도: 사용자가 이 기능을 직접 편집 도구가 아니라 선택/캡쳐 계열의 annotation 기능으로 이해하게 한다.

### 15.174 Stitch 생성 후 abort 실패 메시지 방어 `[implemented 2026-07-02]`

- 배경(QA 로그): `/api/stitch`가 `selected html length`와 `new screens this generation`까지 출력해 화면 HTML을 확보했는데, 클라이언트에는 `목업 생성 실패: signal is aborted without reason`이 노출됐다.
- 추가 QA: `/api/stitch 200 in 2.9min` 뒤에 `목업 생성 실패: Stitch 생성 실패`가 노출됐다. `abort("stitch-timeout")`처럼 문자열 reason으로 abort하면 fetch rejection이 `Error`가 아니라 문자열일 수 있는데, 클라이언트 fallback이 이를 unknown으로 처리했다. 또한 서버 응답 시간이 175초 client timeout과 너무 가까웠다.
- 추가 QA 2: `/api/stitch 200 in 3.5min` 뒤에 `목업 생성 실패: Stitch 응답 처리 시간이 초과되었습니다...`가 노출됐다. 210초로 늘린 client timeout도 성공 응답과 같은 시점에 경합해, 서버는 200을 반환했지만 client가 먼저 abort할 수 있었다.
- 원인 추정: 클라이언트 timeout abort가 reason 없이 발생하거나 문자열 reason으로 reject됐고, 이미지 기반 생성에서 HTML 확보 후 디자인 스타일 추출/design system 적용 후처리가 길어져 응답 반환 전에 abort될 수 있었다.
- 수정: 클라이언트 Stitch fetch의 자동 timeout abort를 제거하고, 수동 취소용 `AbortController`만 유지한다. 문자열 abort reason까지 abort-like error로 정규화했다. `/api/stitch`는 image-led 생성의 derived design style 추출과 design system 적용을 각각 12초로 timebox해, 후처리가 늦어도 HTML 응답을 우선 반환한다.
- 추가 수정: `/api/stitch`가 `htmlPending: true`를 반환하면 새 목업도 즉시 pending artboard를 만들고 background polling으로 HTML을 채운다. 기존에는 새 목업 경로에서 HTML을 먼저 기다리다 polling 한도를 넘으면 생성 실패처럼 보일 수 있었다. 클라이언트 HTML polling은 3회/1.5초 간격에서 10회/5초 간격으로 늘렸다.
- 추가 수정 2: edit 응답이 기존 `screenId`와 같은 id로 200/HTML을 반환해도 client active artboard id 또는 active idea가 어긋나 있으면 `targetId` 매칭만으로는 UI에 반영되지 않을 수 있었다. edit 결과 적용은 `targetId`, 응답 `screenId`, 원래 `editScreenId`를 모두 기준으로 기존 artboard를 찾고, 그래도 없으면 새 artboard를 만들어 활성화한다. 적용 대상 artboard의 `ideaId`로 active idea를 전환하고 canvas fit도 다시 호출한다.
- 추가 수정 3: edit 응답이 200이어도 `screen.getHtml()`가 raw/cached screen의 기존 HTML을 즉시 반환해 이전 artboard HTML과 완전히 같을 수 있었다. client가 이전 HTML hash를 `/api/stitch`에 보내고, 서버는 edit 결과 HTML hash가 같으면 fresh `getScreen`을 반복 재조회해 changed HTML을 기다린다.
- 의도: 목업 화면이 이미 생성된 상황을 실패로 오인하지 않게 하고, 늦은 style 후처리가 primary mockup delivery를 막지 않게 한다.

### 15.175 긴 채팅에서 우측 패널 overflow 보정 `[implemented 2026-07-02]`

- 배경(Notion `minor`): 채팅이 길어지면 우측 채팅 패널 일부가 viewport 밖으로 넘어가 보이지 않는 사례가 있었다.
- 원인: root는 `h-screen`이고 우측 패널은 flex column이지만, 상위 `main`, `ChatPanel`, 메시지 리스트에 `min-h-0`이 없어 flex item이 내용 높이만큼 커질 수 있었다. 이 경우 `overflow-y-auto`가 메시지 리스트에 걸려 있어도 리스트가 shrink하지 못해 입력창/하단부가 창 밖으로 밀린다.
- 수정: `/main/[missionId]`의 작업 `main`, before-session memory panel, messages scroll container에 `min-h-0`을 추가하고, `ChatPanel` shell도 `min-h-0`을 갖도록 했다. `ChatInput` root는 `shrink-0`으로 고정해 긴 대화에서는 메시지 리스트만 스크롤되게 했다.
- 의도: 긴 채팅에서도 우측 패널 전체 높이는 viewport 안에 유지하고, 메시지 영역만 안정적으로 스크롤한다.

### 15.176 채팅 입력 caret 위치 보정 `[implemented 2026-07-02]`

- 배경(QA screenshot): 긴 한국어 문장을 입력할 때 caret가 보이는 글자 위치와 어긋나 보이고, 브라우저 맞춤법 점선이 입력창 위에 섞여 보였다.
- 원인: composer가 실제 textarea 텍스트를 투명하게 만들고 별도 absolute highlight layer로 전체 텍스트를 다시 그렸다. 두 레이어의 wrapping/렌더링이 조금만 달라도 native caret 기준과 보이는 텍스트 기준이 어긋난다.
- 수정: textarea의 실제 텍스트를 다시 보이게 하고, command/mention overlay highlight layer를 제거했다. `spellCheck={false}`와 `autoCorrect="off"`도 추가해 입력 중 빨간 점선이 끼지 않게 했다.
- 의도: 채팅 입력의 caret, 선택 영역, 줄바꿈 기준은 native textarea 하나를 source of truth로 유지한다.

### 15.177 채팅 composer를 Lexical 기반 rich input으로 전환 `[implemented 2026-07-02]`

- 배경: native textarea는 일부 텍스트만 다른 스타일로 렌더링할 수 없어 overlay highlight를 쓰면 caret/wrapping 오차가 생겼고, overlay를 제거하면 `/`/`@` token highlight가 사라졌다. 사용자는 inline token highlight를 유지하길 원했다.
- 수정: `lexical`, `@lexical/react`를 추가하고 `ChatInput` 입력 영역을 Lexical composer로 교체했다. 입력 plain text는 기존 `inputText` state와 동기화하고, `/` command와 `@` mention token 구간은 Lexical TextNode style로 bold/color 처리한다. 자동완성, Enter 전송, Esc 닫기, 이미지 paste 첨부, 외부 focus 호출은 기존 동작을 유지한다.
- 의도: 보이는 텍스트와 caret가 같은 editor tree를 기준으로 동작하게 해 textarea overlay의 이중 렌더 문제를 피하면서 inline token highlight를 복원한다.

### 15.178 클러스터링 입력을 keyword episodic semantic link로 고정 `[implemented 2026-07-03]`

- 배경(Notion): clustering 입력을 keyword, episodic, semantic, link로 확정하고 현재 토글 버튼을 제거해달라는 요청.
- 수정: clustering embedding text를 keyword + episodic + semantic + link로 고정하고 원문 input/output 포함 분기를 제거했다. 고정 입력 이름은 `keyword-episodic-semantic-link`로 저장해 과거 compact-context/full-context cache와 섞이지 않게 했다.
- UI: `/agent`와 세션 리뷰 overlay의 입력 variant 토글을 제거했다. `/agent` 헤더에는 현재 고정 입력 구성만 작은 텍스트로 표시한다.
- API: self/admin cluster route는 query/body variant를 읽지 않고 항상 고정 입력 cache를 조회·생성한다. 세션 종료 시 cluster 생성도 한 번만 호출한다.
- 문서: 1~9장 Current Snapshot의 메모리 클러스터링 항목을 새 고정 입력 기준으로 갱신했다.

### 15.179 Mission 이미지 클릭을 인용으로 전환 `[implemented 2026-07-03]`

- 배경(Page Feedback `/main/mission-20260611-202001`): Mission 섹션의 콘텐츠 이미지를 클릭하면 확대보기만 열렸는데, 레퍼런스 카드처럼 이미지 클릭은 인용으로 쓰고 확대보기는 별도 버튼으로 분리해달라는 요청.
- 수정: `MissionBriefSection`의 asset image card를 `article` 구조로 바꾸고, 이미지 본문 클릭은 `onToggleAssetImage`를 호출해 채팅 입력의 선택 reference 경로에 넣는다. 선택된 이미지는 카드에 `인용됨` badge를 표시한다.
- 수정: 원본 preview dialog는 카드 하단의 작은 `확대보기` 버튼으로만 연다. 버튼은 `Maximize2` 아이콘과 텍스트를 함께 사용한다.
- 연결: `/main/[missionId]`는 미션 이미지를 `Reference` 호환 객체(`tag: 미션 이미지`, `url/imageUrl: asset URL`)로 변환해 `selectedReferences`에 넣는다. 따라서 composer attachment tray, `/api/chat`의 citedReferences, memory source link 경로를 기존 레퍼런스 인용과 공유한다.
- UI: `ChatInput` attachment tray는 `tag`가 `미션 이미지`인 항목을 `이미지 인용`으로 표시한다.

### 15.180 Mission 콘텐츠 이미지 로드 안정화 `[implemented 2026-07-03]`

- 배경(Page Feedback `/main/mission-20260611-202001`): Mission 섹션 콘텐츠 이미지 grid에서 새로고침할 때마다 깨지는 이미지가 달라지는 문제가 있었다.
- 추정 원인: `/api/mission-assets`가 각 이미지 요청마다 Firebase Storage response stream을 그대로 브라우저에 전달해, 여러 이미지 동시 로드 시 일부 요청이 불안정하게 실패할 수 있었다.
- 수정: `/api/mission-assets`가 Storage 응답을 완전히 `Buffer`로 받은 뒤 `Response`로 반환하도록 바꾸고, 10분 in-memory cache와 pending promise dedupe를 추가해 같은 asset의 동시 요청이 Storage에 중복으로 몰리지 않게 했다.
- 수정: `MissionBriefSection` grid 이미지는 로드 실패 시 cache-bust query로 최대 2회 재시도하고, 계속 실패하면 broken image 아이콘 대신 `이미지를 불러오지 못했습니다` placeholder를 표시한다.
- 검증: `npx tsc --noEmit`, 변경 파일 ESLint 통과.

### 15.181 Admin viewAs 세션 헤더 뒤로가기 정리 `[implemented 2026-07-04]`

- 배경(Page Feedback `/main/mission-20260611-201001?viewAs=...`): admin이 다른 사용자의 세션을 read-only로 볼 때 헤더의 `로비로 돌아가기` 버튼은 로비로 보내고, read-only banner에는 별도 `어드민으로 돌아가기` 링크가 있어 돌아가기 affordance가 중복됐다.
- 수정: admin viewAs 상태에서는 헤더의 기존 뒤로가기 버튼 문구를 `어드민으로 돌아가기`로 바꾸고 클릭 시 `/admin`으로 이동하게 했다.
- 수정: read-only banner 오른쪽의 별도 `어드민으로 돌아가기` 링크는 제거했다. 로그 CSV 버튼은 그대로 유지한다.
- 영향: 일반 사용자 진행/리뷰 모드의 헤더 버튼은 기존처럼 `로비로 돌아가기`와 `/lobby` 이동을 유지한다.

### 15.182 Memory graph node hover label을 side panel 카드 UI로 변경 `[implemented 2026-07-04]`

- 배경(Notion Request 6 / Page Feedback `/agent`): memory graph에서 node를 hover할 때 canvas 안에 semantic 텍스트 라벨만 단독으로 보이는 대신, 리뷰 우측 패널에서 쓰는 메모리 카드 형태로 보여달라는 요청.
- 수정: 공용 `MemoryClusterGraph`의 canvas text hover label을 제거하고, hover 위치에 `MemoryClusterSidePanel`의 item 카드와 같은 구성의 DOM tooltip을 띄우도록 바꿨다. Hover tooltip의 mission label은 side panel과 같은 `getMissionLabel` formatter를 받는다.
- 유지: 클릭/선택 후 우하단에 뜨는 inline selected memory detail은 기존 구조를 유지한다.
- 영향: `showInlineDetail`을 켠 `/agent` graph와 세션 리뷰의 작은 graph preview에서 hover label만 카드형으로 바뀐다. full-screen review overlay는 기존처럼 side panel detail을 사용한다.

### 15.183 메모리 리뷰 질문지 v2 반영 `[implemented 2026-07-04]`

- 배경(Notion `v2`): 메모리 리뷰 패널의 7개 질문 문구와 순서를 v2 문안으로 맞춰야 했다.
- 수정: `MemoryReviewPanel`의 `REVIEW_QUESTIONS`에서 저장되지 말았어야 하는 정보 질문을 2번으로, 빠진 정보 질문을 3번으로 배치했다.
- 수정: 3번을 `에이전트가 기억했어야 하는데 빠진 정보가 있나요? (있으면 무엇)`으로, 5번을 `메모리 클러스터가 묶인 단위가 적절한가요?...`로 갱신했다.
- 유지: 기존 answer id는 의미별로 유지해 이미 저장된 draft/feedback 구조와의 호환성을 보존한다.

### 15.184 Memory graph/count UI minor 정리 `[implemented 2026-07-04]`

- 배경(Notion `UI minor`): expanded cluster list의 selected 배경이 잘려 보이고 collapsed 상태와 색감이 다르며, 글자가 리뷰 화면 대비 살짝 크게 보였다. Graph 상단의 clusters/embedded/edges/layout badge는 좌측 panel로 옮기고, 세션 필터 변경 시 edge 수가 바뀌는지도 확인이 필요했다.
- 수정: review presentation cluster list 카드와 collapsed rail 숫자 버튼의 selected 외곽 ring을 제거해 좌우 border가 잘려 보이지 않게 했다. Cluster color는 collapsed selected 숫자 버튼과 expanded selected color rail에서 원색을 쓰고, expanded selected 카드 본문은 원색 전체 배경 대신 옅은 tint/border만 적용한다. Non-selected 상태에서는 collapsed 숫자 버튼과 expanded color rail 모두 `opacity-80`로 낮춘다. Left color rail의 폭과 label/count 글자 크기도 약간 줄였다.
- 수정: `MemoryClusterGraph`의 상단 count/layout badge를 제거하고, `MemoryClusterList` 제목 아래에 node/edge 수를 표시하는 optional props를 추가했다.
- 수정: `/agent`는 현재 visible memory node 기준으로 `clusterEdges`를 필터링해 graph와 edge count에 전달한다. 세션 필터를 바꾸면 edge 수가 visible node pair 기준으로 함께 바뀐다.
- 수정: memory cluster 화면의 clickable cluster card, collapsed rail, detail memory item, session filter, graph control, overlay/review action button에는 명시적으로 `cursor-pointer`를 적용하고 disabled action은 `cursor-not-allowed`로 표시한다.

### 15.185 첨부 스타일 이미지를 레퍼런스 검색 쿼리에 반영 `[implemented 2026-07-04]`

- 배경: 사용자가 이미지를 첨부하고 "이런 디자인 스타일이랑 비슷한 레퍼런스 찾아줘"라고 요청해도 기존 `/api/references`는 이미지 자체를 받지 않고 텍스트 요청과 미션 문맥만으로 검색했다.
- 수정: `fetchReferences`가 현재 턴의 `attachedStyleImage`를 `/api/references` payload에 포함한다.
- 수정: `/api/references`가 이미지 data URL을 형식과 크기로 제한 검증한 뒤 `gpt-5.4` vision 분석으로 검색용 스타일 단서를 생성하고, 이를 `Attached style image search cues:`로 `searchContext`, mode inference, query builder 입력에 합친다. 같은 단서는 API 응답에도 포함해 assistant chat bubble의 `이미지 스타일 검색 기준` 섹션에 노출한다.
- 폴백: 이미지 분석 실패, 지원하지 않는 이미지 형식, 5MB 초과 data URL은 검색 전체를 실패시키지 않고 기존 텍스트 기반 레퍼런스 검색을 계속 수행한다.

### 15.186 세션 리뷰 원문 입력 표시 스코프 수정 `[implemented 2026-07-05]`

- 배경(Notion `세션 이전 내용 이전`): 현재 미션 시작 전 사전 정보를 비워 두었는데, 세션 종료 후 리뷰의 `세션 이전` 탭에서 지난 세션 시작 전에 적은 원문이 보이는 사례가 있었다.
- 원인: 리뷰 패널의 `원래 입력한 내용` 박스가 현재 미션 `profile_memories/{missionId}` 원문이 비어 있으면 누적 before-session graph memory 중 첫 번째 `memory.input`으로 fallback했다. 누적 graph memory는 의도적으로 이전 미션 메모리까지 포함하므로, 과거 raw input이 현재 미션의 직접 입력처럼 표시될 수 있었다.
- 수정: review profile GET 응답의 `rawMarkdown`을 별도 state로 보관하고, `원래 입력한 내용`은 이 현재 미션 원문 또는 legacy `items[]`만 사용한다. 누적 graph memory의 `input`은 더 이상 원문 입력 fallback으로 쓰지 않는다.
- 유지: `세션 이전` 탭의 memory card 목록과 graph/diff는 기존 누적 before-session 모델을 유지한다. 바뀐 것은 현재 미션 직접 입력 원문 박스의 source scope뿐이다.

### 15.187 Before-session retrieval origin scope 보존 `[implemented 2026-07-05]`

- 배경: 이전 미션 시작 전에 입력한 before-session memory와 현재 미션 시작 전에 입력한 before-session memory가 retrieval 후보와 chat query 작성 context에서 모두 같은 `before_session` 항목처럼 전달되어, 모델이 "이번 세션 직전 입력"과 "지난 미션의 historical standing background"를 구분할 수 없었다.
- 수정: `/api/memory/retrieve`가 요청 body의 현재 `missionId`와 memory `source.missionId`를 비교해 before-session 항목마다 `beforeSessionScope`를 계산한다. 값은 `current_mission`, `prior_mission`, `unknown_mission`, `unknown_current_mission` 중 하나이며, 응답 item에는 `sourceMissionId`도 함께 포함한다.
- 수정: retrieval log에 `profileCurrentMissionItemCount`, `profilePriorMissionItemCount`, `profileItemScopes[]`를 저장한다. Admin retrieval log API/type도 이 값을 보존해 사후 분석에서 current/prior before-session retrieval을 구분할 수 있다.
- 수정: `/api/chat`의 compact memory JSON이 before-session 항목의 `beforeSessionScope`와 `sourceMissionId`를 버리지 않게 했고, `chatProfileMemoryPrompt`가 `current_mission`은 현재 미션 직전 입력, `prior_mission`은 이전 미션의 historical standing background로 해석하라고 명시한다. 따라서 레퍼런스 검색 query 작성처럼 chat model이 memory를 활용하는 단계에서도 둘을 구분할 수 있다.

### 15.188 Prior before-session memory 사용 제한 `[implemented 2026-07-05]` `[stale 2026-07-05 → 15.191: prior before-session semantic-only 제한과 강한 prompt 제약 제거]`

- 배경: 15.187로 current/prior origin은 보존됐지만, 이전 미션 before-session memory가 현재 미션에는 해당되지 않는 대상 사용자·도메인·일회성 조건일 수 있다. 이를 현재 미션 직전 입력과 동등하게 쓰면 query 작성이나 목업 생성 조건에 과거 미션 제약이 섞일 수 있다.
- Retrieval 정책: `/api/memory/retrieve` ranking에 small origin bias를 추가했다. `current_mission` before-session은 `+0.035`, `prior_mission` before-session은 `-0.025`를 ranking score에 적용한다. 반환되는 `similarity` 자체는 원래 cosine similarity로 유지하고, log에는 `retrievalRankingPolicy`를 저장한다.
- Prompt 정책: `/api/chat`은 before-session profile memory를 `currentMission`과 `historicalPriorMissions`로 분리해 compact JSON을 만든다. `currentMission`은 episodic+semantic을 유지하고, `historicalPriorMissions`는 semantic-only로 제한한다.
- Prompt 지시: `chatProfileMemoryPrompt`는 prior/historical memory를 durable preference, constraint, working pattern일 때만 사용하고 현재 미션 요구사항, target user, product domain, deliverable, source constraint, reference-search query term으로 취급하지 말라고 명시한다. 현재 user request나 mission context와 충돌하면 prior memory를 무시한다.

### 15.189 Current before-session setup을 retrieval/weight와 분리 `[implemented 2026-07-05]` `[stale 2026-07-05 → 15.190: current setup은 prompt에 항상 포함하되 retrieval 후보에서도 제외하지 않음]` `[stale 2026-07-10 → 15.199: current setup prompt 강제 포함 제거]`

- 배경: current mission before-session memory는 사용자가 이번 미션 전에 의도적으로 제공한 setup context라 prompt에는 항상 들어가야 한다. 하지만 retrieval top-k에 넣어 매번 weight/retrievedCount를 올리면 "관련 있어서 검색됨"과 "현재 setup이라 항상 포함됨"이 섞여 weight 측정이 왜곡된다.
- 수정: `/api/memory/retrieve`가 현재 미션 before-session memory 중 최신 `beforeSessionWriteBatchId`를 `currentBeforeSessionSetup`으로 별도 반환한다. 이 항목들은 retrieval ranking, `updateRetrievedWeights`, idle decay 대상에서 제외한다.
- 수정: top-k `retrieved`에는 current setup을 제외한 during-session/prior before-session 후보만 들어간다. 15.188의 current boost는 더 이상 사용하지 않고, prior before-session small penalty만 유지한다. Retrieval log에는 `includedCurrentSetupMemoryIds`, `includedCurrentSetupMemoryCount`, `includedCurrentSetupMemoryScopes`, `retrievalRankingPolicy.currentBeforeSession = always_included_setup_excluded_from_weight`를 저장한다.
- 수정: `/main/[missionId]`는 `currentBeforeSessionSetup`을 reference-search memory filter와 무관하게 항상 `memoryContext.semantic`에 합친다. 따라서 레퍼런스 검색 턴에서도 이번 미션 사전 입력은 빠지지 않고, prior/retrieved memory만 reference 관련성 필터를 탄다.
- 결과: current before-session은 항상 `currentMission` prompt block에 들어가고, prior before-session은 retrieval로 선별된 뒤 `historicalPriorMissions` semantic-only block에 들어간다.

### 15.190 Before-session retrieval ranking 동등화 `[implemented 2026-07-05]` `[stale 2026-07-10 → 15.199: current before-session 별도 currentBeforeSessionSetup 반환과 prompt 강제 포함 제거]`

- 배경: 15.189의 current setup 분리 정책은 prompt 포함과 weight 측정 분리를 엄격히 나눴지만, current before-session memory도 query와 실제로 관련되어 top-k에 retrieved되면 다른 memory처럼 weight/retrievedCount가 오르는 것이 더 자연스럽다. Prior before-session에도 별도 penalty를 두지 않고 다른 memory와 같은 similarity ranking을 적용하기로 했다.
- 수정: `/api/memory/retrieve`에서 prior before-session penalty를 제거하고, current/prior before-session/during-session 모두 같은 cosine similarity ranking 후보로 둔다. Top-k에 들어온 항목은 기존처럼 `updateRetrievedWeights`와 idle decay 경로를 탄다.
- 유지: 현재 미션 before-session latest batch는 여전히 `currentBeforeSessionSetup`으로 별도 반환해 prompt에 항상 포함한다. 다만 retrieval 후보에서도 제외하지 않으므로, top-k에 실제 retrieved되면 weight/retrievedCount가 오른다.
- 중복 방지: `/main/[missionId]`는 `currentBeforeSessionSetup`을 prompt context에 먼저 넣고, top-k `retrieved`에 같은 id가 있으면 prompt 삽입에서 중복 제거한다. 따라서 prompt 포함 경쟁에는 current setup이 의존하지 않지만, retrieval/weight 측정에는 정상 참여한다.

### 15.191 Prior before-session prompt 제한 완화 `[implemented 2026-07-05]`

- 배경: 15.188에서 추가한 `historicalPriorMissions` 분리, semantic-only 제한, "현재 미션 조건처럼 쓰지 말라"는 강한 지시는 원래 있던 동작이 아니고 현재 연구 UX에는 과한 제약일 수 있다. Prior before-session도 retrieved될 정도로 관련 있으면 episodic까지 참고할 수 있어야 한다.
- 수정: `/api/chat`의 profile memory compact JSON을 다시 단일 before-session context(`episodic`/`semantic`)로 통일했다. 각 item의 `beforeSessionScope`와 `sourceMissionId`는 보존하므로 모델은 current/prior 출처를 구분할 수 있다.
- 수정: `chatProfileMemoryPrompt`에서 prior를 semantic-only로 제한하거나 현재 미션 조건으로 쓰지 말라는 강한 문구를 제거했다. 대신 current/prior source metadata를 참고하되 현재 user request와 mission context를 존중하라는 일반 지시로 완화했다.
- 유지: current mission before-session setup은 retrieval 여부와 무관하게 항상 prompt에 포함되고, top-k retrieved memory와 id가 겹치면 prompt 삽입에서 중복 제거한다.

### 15.192 조건부 디자인 스타일 제안의 액션 태그 실행 차단 `[implemented 2026-07-06]`

- 배경: assistant가 "원하시면 디자인 스타일 형태로 정리해드릴게요"처럼 조건부 제안을 해야 하는 턴에서 `[CREATE_DESIGN_SPEC: ...]`를 예시처럼 함께 출력해 실제 디자인 스타일 생성/저장 액션으로 실행되는 사례가 있었다. 평문 payload 형태는 과거 대화 컨텍스트 정리에서도 완전히 축약되지 않아 재유입될 수 있었다.
- 수정: `CHAT_AGENT_BASE_PROMPT`와 `CHAT_DESIGN_SPEC_ACTION_PROMPT`에 조건부 제안, 예시, preview, template 안에는 bracket action tag를 절대 넣지 말라는 규칙을 추가했다.
- 수정: `/main/[missionId]`의 완료 응답 정규화 단계에서 `원하시면`, `필요하면`, `if you want` 등 조건부 제안 문맥에 붙은 `CREATE_DESIGN_SPEC` 블록을 저장/파싱 전에 제거한다. 함께 나온 가짜 상태 문구 `디자인 스타일 추가됨`도 제거해 최종 chat bubble이 일반 제안 문장으로 남게 했다.
- 수정: `cleanMessageContentForModel()`은 JSON payload뿐 아니라 평문/부분 `CREATE_DESIGN_SPEC` 블록도 균형 스캐너로 `[디자인 스타일 추가]`로 축약한다. ToolActionChip 렌더링은 액션 블록 직전의 중복 상태 라벨을 숨겨 chat bubble에 같은 상태가 텍스트와 chip으로 이중 표시되지 않게 했다.
- 문서: 1~9장 Current Snapshot의 액션 완료 보장과 `CREATE_DESIGN_SPEC` 계약에 조건부 제안 예외와 컨텍스트 축약 계약을 반영했다.

### 15.193 Admin review turn별 retrieval log 보기 `[implemented 2026-07-06]`

- 배경(Page Feedback `/main/onboarding?viewAs=...`): admin이 사용자의 리뷰 화면을 볼 때 `Raw prompt 보기`처럼 각 interaction에서 retrieval이 무엇을 가져왔는지 확인할 수 있어야 했다.
- 수정: `/api/memory/session-summary`가 mission-scoped `memoryRetrievalLogs`를 `retrievalLogs`로 함께 반환한다. 각 log에는 query, retrieved memory ids/similarities, retrieved memory 요약, current before-session setup memory, profile/current/prior count와 scopes, raw retrieval ranking policy를 포함한다.
- 수정: `/api/memory/retrieve`는 retrieval log에 `interactionId`(assistant message id)와 `userMessageId`를 저장한다. `/main/[missionId]`는 `interactionId`로 retrieval log를 해당 turn에 우선 매칭하고, 과거 log처럼 id가 없는 경우 assistant message createdAt과 다음 assistant message createdAt 사이의 timestamp fallback을 사용한다.
- 수정: admin viewAs 리뷰 화면에서 retrieval log가 매칭된 assistant bubble에는 `Retrieval 보기` 버튼을 표시한다. 모달은 retrieval query, retrieved/current setup counts, retrieved memory 목록, current setup 목록, raw retrieval log JSON을 보여준다.
- 유지: 일반 사용자 리뷰와 일반 진행 화면에는 retrieval debug 버튼을 노출하지 않는다. Raw prompt 버튼과 같은 admin viewAs debug 조건을 따른다.
- 문서: 4.7 Current Snapshot과 12.1.3 리뷰 화면 계약에 admin retrieval 보기 계약을 반영했다.

### 15.194 Memory embedding에서 원문 interaction content 제외 `[implemented 2026-07-06]`

- 배경: memory embedding(생성·retrieve)은 keyword + episodic + semantic 외에 Original interaction content(input/output)까지 넣고 있었다. 반면 clustering embedding은 이미 keyword + episodic + semantic + link만 쓰도록 고정돼 있어(15.178) 두 embedding의 입력 계약이 어긋났다. 또 link 라인은 retrieve 재생성 경로에만 있고 생성 경로엔 없어 계약이 둘로 갈렸다(실제로는 during-session `link`가 항상 null이라 효과는 없었음).
- 수정: 생성(`/api/memory/complete-session`)과 retrieve 재생성(`/api/memory/retrieve`)의 embedding 텍스트를 keyword + episodic + semantic + link로 통일하고 Original interaction content를 제거했다. 원문 interaction input/output/originalInteractionContent는 memory document 필드로는 계속 저장하되 embedding 벡터에서만 뺀다.
- 수정: 텍스트 계약이 바뀌었으므로 interaction embeddingSource 태그를 `during_session_record_text` → `during_session_record_text_v2`로 올리고 `ACCEPTED_EMBEDDING_SOURCES`에서 구 태그를 제외했다. retrieve 시 `ensureV2Embeddings`가 구 태그 embedding을 stale로 보고 새 계약으로 재생성한다.
- 유지: profile(before-session) embedding 계약(Source + keyword + episodic + semantic)과 `before_session_unit_text` 태그는 그대로 두어 프로필 재생성은 강제하지 않는다.
- 문서: 4.7 Retrieval MVP 항목에 memory embedding 입력 계약과 embeddingSource 버전업 규칙을 반영했다.

### 15.195 Before-session original input unit 강조 `[implemented 2026-07-07]` `[stale 2026-07-07 → 15.196: Original input 안의 unit bold highlight 제거]`

- 배경(Notion `세션 전에 입력한 내용 쪼개기`): before-session profile memory는 저장 시 여러 unit으로 분리되지만, memory detail panel의 `Original input`은 각 memory document의 `input`에 저장된 전체 rawMarkdown을 그대로 보여줘 어떤 memory가 어느 입력 조각에서 왔는지 구분하기 어려웠다.
- 원인: `/api/memory/profile`은 분리된 원문 조각을 `source.sourceText`에 저장하고, 호환용 전체 원문을 `input`에 저장한다. 하지만 `MemoryClusterSidePanel`은 before-session 여부와 무관하게 `item.input`만 카드 제목과 `Original input`에 사용했다.
- 수정: memory source 타입에 `sourceText`를 포함하고, before-session memory detail card의 제목은 `source.sourceText`를 우선 표시한다. `Original input` 필드는 전체 `input` rawMarkdown을 유지하되, 그 안에서 `source.sourceText`에 해당하는 분리 unit만 굵게 표시한다. `input`이 없으면 `sourceText`로 fallback한다.
- 유지: Firestore schema와 profile memory 생성/embedding 계약은 바꾸지 않았다. 이미 저장된 before-session memory도 `source.sourceText`가 있으면 새 표시 규칙을 바로 탄다.

### 15.196 Before-session original input 강조 제거 `[implemented 2026-07-07]`

- 배경(Page Feedback): `Original input` 안에서 쪼개진 source unit을 굵게 표시하는 효과가 기대와 맞지 않았다.
- 수정: `MemoryClusterSidePanel`의 `Original input`은 다시 plain text로만 렌더링한다. Before-session memory card 제목은 `source.sourceText` 우선 표시를 유지하고, `Original input`은 전체 `input` rawMarkdown을 그대로 보여준다.
- 유지: graph tooltip/detail에서 before-session headline/input fallback에 `source.sourceText`를 쓰는 타입 보강은 유지한다.

### 15.197 Session cluster snapshot 분리 `[implemented 2026-07-10]`

- 배경: 세션 리뷰 overlay의 `세션 이전`/`세션 이후`가 같은 최신 cluster cache의 label/summary를 공유하고 node만 필터링해, 이전/이후가 둘 다 최신 클러스터 해석처럼 보였다. Cluster labeler도 각 cluster의 최신순 `itemIds.slice(0, 8)`만 LLM에 넘겨 큰 클러스터에서 최근 표현에 끌릴 수 있었다.
- 수정: `users/{uid}/memoryClusterSnapshots/{missionId}_{before|after}` 문서를 추가했다. 세션 완료 시 `/api/memory/session-clusters`가 유저별 `missionOrder` 기준으로 before snapshot(온보딩+이전 미션+현재 미션 before_session)과 after snapshot(before+현재 세션 memory)을 각각 생성해 cluster label/summary/membership/edge를 저장한다.
- UI: `/api/memory/session-summary`는 snapshot을 `clusterSnapshots.before/after`로 반환하고, main 리뷰 overlay는 phase toggle에 따라 snapshot의 clusters/edges/itemIds를 바꿔 렌더한다. Snapshot이 없는 과거 세션은 기존 latest cache fallback을 사용한다.
- 라벨링 안정화: `memoryClustering.ts`의 cluster label input은 최신 8개 대신 오래된 항목, 최신 항목, 중간 지점 항목을 섞은 최대 8개 샘플로 구성해 recency bias를 줄인다.
- 정리 경로: 사용자 전체 삭제/백업과 미션 기록 삭제에서 `memoryClusterSnapshots`도 함께 백업 또는 삭제한다.
- 검증: `npm run lint`, `npx tsc --noEmit` 통과. 기존 warning만 유지.

### 15.198 Cluster labeler temperature 고정 `[implemented 2026-07-10]`

- 배경: before/after snapshot 비교에서 같은 cluster membership이라도 label/summary 표현이 샘플링으로 흔들리면 변화 해석이 어려워진다.
- 수정: `memoryClustering.ts`의 cluster label/summary 생성 호출에 `temperature: 0`을 명시했다. Embedding similarity graph, label propagation, merge 로직은 그대로다.

### 15.199 Current before-session prompt priority 제거 `[implemented 2026-07-10]`

- 배경: current mission before-session memory는 retrieval ranking boost/penalty는 없었지만, `/api/memory/retrieve`가 최신 batch를 `currentBeforeSessionSetup`으로 별도 반환하고 `/main`이 이를 retrieved memory 앞에 항상 붙였다. 따라서 top-k에 들지 않아도 prompt에 들어가는 prompt inclusion priority와 reference-search filter 우회가 남아 있었다.
- 수정: `/api/memory/retrieve`에서 `currentBeforeSessionSetup` 별도 선별/응답을 제거하고, retrieval log의 `currentBeforeSession` policy를 `same_similarity_ranking_no_forced_prompt_inclusion`으로 변경했다. 호환 필드는 빈 배열/count 0으로 남긴다.
- 수정: `/main/[missionId]`는 `/api/chat`에 넘길 memory context를 retrieved top-k만으로 구성한다. Reference search turn에서도 current before-session memory가 별도 우회하지 않고, retrieved된 경우에만 기존 reference relevance filter를 탄다.
- 수정: `chatProfileMemoryPrompt` wording을 "retrieved for this turn" 기준으로 바꿔 current/prior before-session memory 모두 retrieved된 경우에만 활용되는 것으로 맞췄다.

### 15.200 Admin actual raw prompt 표시 `[implemented 2026-07-10]`

- 배경(Notion `Sanitized raw prompt 수정`): admin viewAs 리뷰 화면의 `Raw prompt 보기` 모달이 sanitized copy만 보여줘, 실제 모델에 보낸 prompt를 확인할 수 없었다.
- 수정: `/api/chat`이 `reviewTurns/{turnId}`에 모델 호출에 사용한 원본 `rawPromptActual`을 함께 저장한다. 기존 sanitized `rawPrompt`, `rawPromptSanitization`, `rawResponseMeta`는 유지한다.
- UI: `PromptViewer`는 admin-only 모달에서 `Actual prompt sent to model`을 먼저 보여주고, `rawPromptActual`이 있는 경우 sanitized copy를 별도 섹션으로 표시한다. 기존 reviewTurn에는 `rawPromptActual`이 없으므로 sanitized `rawPrompt`로 fallback한다.

### 15.201 Retrieval clustering 저장 embedding 공유 `[implemented 2026-07-10]`

- 배경(Notion `Memory embedding backfill` Part 4): retrieval과 clustering이 같은 memory를 보면서도 각각 embedding API를 호출하면, 같은 항목의 vector 계약이 갈라질 수 있고 clustering 재생성마다 불필요한 embedding 비용이 발생한다.
- 수정: `src/lib/server/memoryEmbedding.ts`를 공용 helper로 추가해 memory embedding text 생성, embedding 생성, stale 검사, Firestore write-back을 한 곳으로 모았다. During-session은 `during_session_record_text_v2`, before-session은 기존 `before_session_unit_text` 계약을 유지한다.
- 수정: `/api/memory/complete-session`, `/api/memory/profile`, `/api/memory/retrieve`가 모두 공용 helper를 사용한다. Retrieve는 query embedding만 새로 만들고, memory candidate의 저장 embedding이 없거나 source 계약과 맞지 않을 때만 재생성한다.
- 수정: `loadUserMemoryItems`와 `loadClusterInputItems`가 path, link, sourceType, source, embedding, embeddingSource를 clustering으로 넘긴다. `memoryClustering.ts`는 저장 embedding을 우선 사용하고 누락·stale 항목만 공용 helper로 보정해 같은 memory document에 저장한다.
- 캐시: clustering method version을 `similarity-graph-v4-stored-memory-embedding`으로 올려 v3 persona-summary cache와 섞이지 않게 했다. 표시용 input variant 이름은 `keyword-episodic-semantic-link`를 유지한다.

### 15.202 Archived memory current graph 제외 `[implemented 2026-07-11]`

- 배경: Part 4 데이터 검증 중 최근 세션의 before/after cluster snapshot과 current graph 입력에 `archivedAt`이 있는 duplicate memory가 섞여 있었다. Archived memory는 삭제된 것이 아니라 사라짐/감사 표현을 위해 데이터로 남아야 하지만, 현재 기억 상태를 보여주는 client cluster graph에는 node로 나타나면 안 된다.
- 수정: `loadUserMemoryItems`의 기본값을 active memory only로 바꿔 `archivedAt`이 있는 memory를 `/api/memory/all`, admin memory API, self/admin clustering 입력, 앞으로 생성되는 session cluster snapshot에서 제외한다. 필요하면 `includeArchived` 옵션으로 명시적으로 포함할 수 있게 했다.
- 유지: Firestore memory document와 admin archived/forgetting 조회, session-summary의 archive status 기반 리뷰 표현은 유지한다. 즉 archived memory는 데이터로 남지만 current graph/clustering source item에는 들어가지 않는다.

### 15.203 citedTexts 이중 라벨링 제거 `[implemented 2026-07-11]`

- 배경(Notion `citedTexts 이중 라벨링`): `/api/chat`이 cited text마다 `[인용 N]`을 붙인 뒤 `chatCitedTextsPrompt`가 다시 같은 라벨을 붙여 최종 system prompt에 `[인용 1] [인용 1] ...`처럼 중복 표시됐다.
- 수정: `/api/chat`은 cited text를 truncate한 raw excerpt 배열로만 `chatCitedTextsPrompt`에 전달하고, 인용 번호 라벨은 prompt helper 한 곳에서만 붙인다. Client는 `citedTexts` state와 ref를 함께 갱신해 텍스트 인용 직후 바로 `/레퍼런스검색` 같은 composer command를 보내도 user message, memory source, `/api/chat` payload가 같은 cited text snapshot을 사용한다.
- 영향: prompt compact 저장용 `citedTexts`는 기존처럼 raw text truncate 배열을 유지한다. Reference citation flow는 바뀌지 않는다.

### 15.205 citedTexts presence 기반 prompt 주입 `[implemented 2026-07-11]`

- 배경(raw prompt 점검): 사용자가 미션 패널 텍스트를 드래그해 인용했는데도 `/레퍼런스검색` raw prompt에 cited text block이 없었다. Client race 보완 후에도 서버의 context planner가 `citedTexts: false`를 반환하거나 explicit composer command force path가 `citedTexts` needs를 세팅하지 않으면, `/api/chat`의 `shouldIncludePlannedContext("citedTexts")`에서 인용 텍스트가 빠질 수 있었다.
- 수정: `/api/chat`은 request body에 `citedTexts`가 1개 이상 있으면 planner confidence/intent와 무관하게 cited text context를 raw prompt에 포함한다. `fetch_references` forced intent와 explicit composer command force path도 cited text count가 있으면 `needs.citedTexts`를 true로 유지한다.
- 영향: 사용자가 명시적으로 붙인 텍스트 인용은 reference search 같은 standalone command에서도 prompt에 들어간다. 인용 번호 라벨은 계속 `chatCitedTextsPrompt` 한 곳에서만 붙인다.

### 15.206 Planner analysis와 memoryRelevance 도입 `[implemented 2026-07-11]`

- 배경(Notion `Planner`): planner가 gpt-5.4 non-reasoning 호출인데 output에서 `reason`이 맨 뒤에 있어 intent/needs 결정 전 사고를 유도하기 어려웠다. 또한 planner input의 `userClusterSummaries`보다 retrieved semantic memory 자체가 짧고 유의미했고, `interactionMemory` bool은 memory를 넣을지 말지만 결정해 반영 강도를 조절하지 못했다.
- 수정: `chatPlannerPrompt` output shape를 `analysis → intent → confidence → memoryRelevance → needs` 순서로 바꿨다. 내부 `ChatPlan.reason` 필드는 review/debug 호환을 위해 유지하되 parser는 `analysis`를 우선 읽고 legacy `reason`으로 fallback한다.
- 수정: planner input의 `recentMessages`를 6개에서 3개로 줄이고 `userClusterSummaries`를 제거했다. 대신 이미 retrieved/filter를 통과한 `memoryContext`에서 semantic memory를 `semantic`, `similarity`, `signal`로 넣는다. signal 실험값은 similarity 0.48 이상 high, 0.39 이하 low, 그 사이는 mid다. `[stale 2026-07-13 → 15.230: planner semantic memory cap은 retrieval top-k와 맞춰 최대 10개로 조정됨]`
- 수정: planner output에서 `needs.interactionMemory`를 제거하고 `memoryRelevance`를 `light | medium | strong`으로 추가했다. Memory context는 retrieved/filter를 통과해 있으면 prompt에 주입하고, `chatProfileMemoryPrompt`와 `chatInteractionMemoryPrompt`가 memoryRelevance별 instruction을 붙인다.
- 유지: 15.199의 before-session retrieval/filter 계약은 유지한다. Planner semantic memory input은 retrieval/filter 우회가 아니라 `/main`이 넘긴 `memoryContext`의 compact view다.

### 15.207 Assistant response feedback memory draft `[implemented 2026-07-13]`

- 배경(Notion `채팅마다 good or bad response 체크할 수 있게`): 사용자가 개별 assistant response에 좋아요/싫어요와 선택적 이유를 남기고, 그 평가를 기존 memory creation pipeline으로 학습 신호화해야 했다. 별도 memory infra를 만들지 않고 기존 draft encode/complete-session 경로를 재사용하는 방향으로 결정했다.
- UI: assistant bubble 하단에 `ThumbsUp`/`ThumbsDown` icon button을 추가했다. 버튼은 스트리밍 중이거나 read-only/admin viewAs, 에러 답변에서는 비활성화된다. 클릭 시 채팅 입력창이 아니라 화면 레벨 dialog를 열고, evaluated answer preview와 optional reason textarea를 보여준다. 제출 성공 후 message의 마지막 `assistantFeedback` 상태를 갱신해 선택된 vote를 표시한다.
- Draft 입력 계약: client는 `feedback-{assistantMessageId}` interactionId로 `/api/memory/drafts`를 호출한다. input은 `답변 평가: 좋아요/싫어요`, optional reason, 평가된 답변의 원래 질문(최대 1000자)이고 output은 evaluated assistant answer를 `cleanMessageContentForModel`로 정리해 최대 6000자로 보낸다. 같은 message에 재투표하면 같은 draft id를 덮어써 최종 상태만 남긴다. `[stale 2026-07-13 → 15.231: 사용자-facing input prefix는 선호 표시로 변경]`
- Encoding: `/api/memory/drafts`는 `assistantFeedback` payload가 있으면 `MEMORY_FEEDBACK_ENCODE_ADDENDUM`을 `MEMORY_ENCODE_PROMPT` 뒤에 붙인다. Addendum은 episode를 평가 사실 한 문장으로 쓰고 semantic은 답변 내용 요약이 아니라 평가 신호에서 파생하라고 지시한다. dislike without reason은 좁고 조심스러운 hypothesis로 제한한다.
- Activity/review: session `activityLog`에는 `section: feedback`, `action: submit` 이벤트를 남겨 좋아요/싫어요와 이유를 타임라인에서 볼 수 있게 했다. Memory draft/promoted event의 action category도 `assistant_feedback`으로 분류해 기존 action tag 재해석과 섞이지 않게 했다. `[stale 2026-07-13 → 15.231: 새 category는 preference_signal이고 assistant_feedback은 legacy alias]`

### 15.208 Retrieved memory prompt 통합 `[implemented 2026-07-13]`

- 배경(Notion `[updated] retrieval 메모리 prompt에 들어가는지 확인`): 15.199에서 current before-session always-on 주입은 제거했지만, `/api/chat`은 retrieved memory를 다시 before-session/profile과 during-session/interaction으로 분리해 `chatProfileMemoryPrompt`와 `chatInteractionMemoryPrompt`를 따로 붙이고 있었다. 이 때문에 retrieval은 단일 top-k 경쟁인데 chat prompt 단계에서 다시 source별 특권처럼 보일 여지가 남았다.
- 수정: `chatProfileMemoryPrompt`와 `chatInteractionMemoryPrompt`를 제거하고 `chatRetrievedMemoryPrompt` 단일 helper로 통합했다. `/api/chat`은 `memoryContext` 전체를 `compactMemoryContext`로 한 번만 변환하고, `selectedContextKeys`에도 `retrievedMemory` 하나만 기록한다.
- 수정: planner compact input의 UI count도 `profileMemoryCount`/`interactionMemoryCount` 대신 `retrievedMemoryCount` 하나로 바꿨다. Planner가 보는 semantic memory 목록은 retrieval/filter를 통과한 항목이다. `[stale 2026-07-13 → 15.230: 최대 5개 cap은 retrieval top-k 10과 맞춰 최대 10개로 조정됨]`
- 유지: before-session 항목의 `beforeSessionScope`와 `sourceMissionId`는 compact JSON에 계속 남겨 모델이 출처를 참고할 수 있게 했다. 단, prompt 문구는 이 metadata를 자동 미션 요구사항이나 검색 query term으로 쓰지 말고 retrieval-selected evidence로만 다루도록 설명한다.
- 유지: `/api/memory/retrieve`의 호환 응답 필드 `currentBeforeSessionSetup: []`와 retrieval log의 profile count/debug fields는 이번 변경에서 건드리지 않았다. Top-k limit 조정은 15.209에서 별도 처리했다.

### 15.209 Memory retrieval top-k 10 적용 `[implemented 2026-07-13]`

- 배경(Notion `검색되는 메모리 수 k=10 ←5 으로 늘리기`): unit memory retrieval에서는 k=10 전후가 더 일반적이고, top 5로는 before-session memory가 관련 있어도 prompt에 들어오지 않을 확률이 높았다. 15.199/15.208로 before-session forced inclusion과 source별 prompt split을 제거했으므로 retrieval top-k 자체를 10으로 올리는 방향이 자연스럽다.
- 수정: `/api/memory/retrieve`의 `DEFAULT_LIMIT`을 5에서 10으로 올렸다. route는 기존처럼 body `limit`을 1~10으로 clamp하므로 최대 retrieval budget은 그대로 10이다.
- 수정: `/main/[missionId]`의 memory retrieve 호출이 명시적으로 `limit: 10`을 보내도록 변경했다. 클라이언트가 값을 보내지 않는 다른 호출도 서버 기본값 10을 따른다.
- 수정: `/api/chat`의 retrieved memory prompt compact cap을 episodic/semantic 각각 8에서 10으로 올려, top 10 retrieved memory가 prompt 단계에서 임의로 8개로 잘리지 않게 했다.
- 수정: planner input의 `semanticMemories`도 retrieval top-k와 맞춰 최대 10개를 본다. 실제 답변 prompt에도 `chatRetrievedMemoryPrompt`를 통해 top 10 retrieval context가 들어간다.

### 15.210 Assistant feedback 기반 memory weight 조정 `[implemented 2026-07-13]`

- 배경(Notion `좋아 싫어요 weight 반영`): assistant 답변에 좋아요/싫어요를 남길 때, 평가 memory draft만 만들고 끝내면 실제로 그 답변에 사용된 retrieved memory의 점수가 변하지 않았다. 스펙은 좋아요 `+0.08`, 싫어요 `-0.04`를 해당 답변에 호출된 memory들에 반영하라는 내용이었다. `[stale 2026-07-13 → 15.229: retrieval 단계가 이미 사용된 memory를 강화하므로 feedback delta 자체는 좋아요 +0.04, 싫어요 -0.08로 보정함]`
- 수정: `src/lib/server/memoryFeedbackWeights.ts`를 추가해 feedback 대상 assistant message의 `reviewTurns/{messageId}.retrieved`를 우선 읽고, 없으면 같은 mission의 `memoryRetrievalLogs`에서 `interactionId` 또는 `userMessageId`로 fallback해 target memory id를 찾는다.
- 수정: `/api/memory/drafts`는 `assistantFeedback` payload가 있는 draft 저장 시 target memory weight를 clamp 0..1 범위에서 조정한다. `archivedAt`이 있거나 `weight <= 0`인 inactive memory는 건드리지 않는다.
- 재투표/재저장: 같은 `feedback-{messageId}` draft를 다시 저장할 때 기존 `assistantFeedbackWeightAdjustment`를 읽어 이전 적용분과 새 적용분의 차이만 반영한다. 같은 vote에서 reason만 바꾼 경우 weight는 재적용되지 않는다.
- 관측성: draft document에 `assistantFeedbackWeightAdjustment`를 저장해 적용된 vote, deltaPerMemory, target memory ids, per-memory before/after delta, skippedReason을 확인할 수 있게 했다.

### 15.211 Weight 0 기반 forgetting 자동화 `[implemented 2026-07-13]`

- 배경(Notion `forgetting 자동화`): 기존 forgetting은 admin forgetting 탭을 열면 low-weight/duplicate 후보를 `archivedAt` 기반으로 soft archive하는 레거시 흐름이었다. 새 계약은 별도 admin archive 액션보다 memory `weight`가 0이 되면 비활성화되고, 그 상태 자체로 검색/클러스터에서 제외되는 방식이다.
- 수정: `memoryActivity.ts`를 추가해 active memory 기준을 `archivedAt` 없음 + `weight > 0`으로 공통화했다. `loadUserMemoryItems`, `/api/memory/retrieve`, `memoryForgetting` 후보 산출, assistant feedback weight 조정이 이 기준을 사용한다.
- 수정: weight 0 memory는 retrieval 후보에서 제외되어 prompt에 들어가지 않고, retrieval weight/retrievedCount도 더 이상 바뀌지 않는다. Self/admin current graph와 clustering 입력도 `loadUserMemoryItems` 기본 필터를 통해 weight 0 memory를 제외한다.
- 수정: `/api/memory/archive-status`가 `inactive`, `inactiveReason`, `weight`를 반환한다. Review turn에 이미 저장된 retrieved memory는 데이터로 남아 있으므로, main review side panel에서 inactive memory를 회색 카드와 `inactive` badge로 표시한다.
- 수정: `GET /api/admin/users/[uid]/memory/forgetting`은 더 이상 후보를 자동 archive하지 않고 후보/archived 기록만 조회한다. Admin forgetting view 문구도 자동 archive 완료가 아니라 후보 조회로 바꿨다. PATCH 기반 manual archive route는 legacy/debug API로 유지한다. `[stale 2026-07-13 → 15.241: route와 admin forgetting/archived tab 제거]`

### 15.241 Forgetting idle decay floor 0 and legacy admin removal `[implemented 2026-07-13]`

- 배경(Notion `RE forgetting` 0713): weight 0이면 inactive가 되는 계약은 있었지만 idle decay가 floor 0.1에서 멈춰 사용되지 않는 memory가 0까지 내려가지 않았다. 또한 `IDLE_DECAY_WEIGHT_LOSS = 0.01`과 `IDLE_DECAY_MAX_WEIGHT_LOSS = 0.006` 조합 때문에 memory count multiplier가 항상 max cap에 막혀 dead code가 됐다. Admin forgetting 후보/수동 archive route와 탭도 레거시로 남아 있었다.
- 수정: `/api/memory/retrieve`의 idle decay 파라미터를 `IDLE_DECAY_WEIGHT_LOSS = 0.006`, `IDLE_DECAY_MAX_WEIGHT_LOSS = 0.012`, `MIN_MEMORY_WEIGHT = 0`으로 조정했다. 이제 retrieve되지 않은 memory는 idle decay만으로도 0까지 내려가 inactive가 될 수 있고, 60/120/200개 이상 multiplier가 실제 loss에 반영된다.
- 제거: `/api/admin/users/[uid]/memory/forgetting` route와 admin memory modal의 forgetting/archived tab, 후보 load state/effect를 제거했다. Low-weight 후보를 수동 archive하는 레거시 경로 대신 `weight <= 0` inactive 계약을 source of truth로 둔다.

### 15.212 Planner intent 이름 정리 `[implemented 2026-07-13]`

- 배경(Notion `Planner Prompt intent 수정`): planner intent 이름이 내부 action tag 이름(`create_note`, `update_note`, `generate_mockup`)과 섞여 있어 UI/UX 도메인 용어와 맞지 않았고, legacy `presentation`/`clarify` intent도 남아 있었다.
- 수정: planner intent union을 `answer | create_design_brief | edit_design_brief | create_mockup | edit_mockup | fetch_references | create_design_spec`로 정리했다. `presentation`과 `clarify`는 planner output에서 제거했다.
- 호환: parser는 legacy planner output의 `create_note`, `update_note`, `generate_mockup`을 각각 새 intent로 alias 처리하고, legacy `presentation`/`clarify`는 `answer`로 fallback한다. Composer command id와 실행 action tag는 기존 계약을 유지한다.
- 수정: `chatPlannerPrompt` output schema와 intent rules를 새 이름으로 바꾸고, 불명확한 요청은 `clarify` intent 대신 `answer` intent에서 짧은 확인 질문을 하도록 지시했다.
- 수정: `CHAT_PRESENTATION_ACTION_PROMPT`와 router의 presentation action 지시를 제거했다. `presentationSlideImagePrompt`와 `/api/presentation` route는 현재 planner 경로 밖의 legacy API라 이번 변경에서는 삭제하지 않았다.
- 유지: `create_design_spec`는 디자인 스타일을 생성하거나 교체하는 단일 action 계약으로 남겼다. 별도 `edit_design_spec` intent는 아직 도입하지 않았다. `[stale 2026-07-13 → 15.213: 기존 디자인 스타일 일부 수정용 edit_design_spec intent와 EDIT_DESIGN_SPEC action tag를 도입함]`

### 15.213 edit_design_spec intent/action 도입 `[implemented 2026-07-13]`

- 배경: `create_design_spec` 하나로 최초 작성, 완전 교체, 기존 스타일 일부 수정, 새 스타일 variant까지 모두 처리하면 planner/router/review에서 사용자의 의도를 분리할 수 없었다. 특히 "기존 스타일 일부만 수정", "style revision", "새 스타일 variant"를 구분하려면 기존 스타일을 읽고 갱신하는 별도 edit intent가 필요했다.
- 수정: planner intent union에 `edit_design_spec`를 추가했다. 기존 디자인 스타일의 일부 수정, 보강, 제거, revision 저장은 `edit_design_spec`로 분류하고 `designSpec` context를 요구한다. 새 variant, 다른 visual direction, 다른 mood/reference direction은 `create_design_spec` 쪽으로 남겨 기존 스타일을 덮어쓰지 않는 새 시안 방향으로 처리하게 했다.
- 수정: 실행 action tag `[EDIT_DESIGN_SPEC: {"content":"full updated markdown content"}]`를 추가했다. Payload는 diff가 아니라 저장될 전체 최신 디자인 스타일이다. 세션 runtime은 기존 `designStyle` 슬롯을 갱신하되 chip label은 "디자인 스타일 수정됨", memory action category는 `design_spec_edit`로 남긴다.
- 호환: legacy planner output `edit_design_style`은 `edit_design_spec`으로 alias 처리한다. `[CREATE_DESIGN_SPEC]` 파서와 동일하게 JSON, loose string field, plain markdown payload 복구를 지원하고, 조건부 제안 문맥에서는 실행 action으로 저장하지 않는다.
- 유지: 실제 revision history 저장소와 style variant UI/data model은 아직 별도 구현하지 않았다. 이번 변경은 그 기능을 붙일 수 있도록 planner/action taxonomy와 review/memory 기록을 먼저 분리한 것이다.

### 15.214 Chat prompt block 순서와 mockupHtml compact `[implemented 2026-07-13]`

- 배경(Notion `Chat Prompt`): OpenAI prompt caching 효율을 위해 매 turn 동일하거나 덜 변하는 prompt block을 위로 올리고, 매 turn 바뀌는 command/mention/actionInstruction/currentRequest를 아래쪽으로 내려야 했다. 또한 `mockupHtml` 12000자 truncate가 Tailwind/SVG/script 보일러플레이트에 예산을 많이 쓰고 있었다.
- 수정: `/api/chat` system message 조립 순서를 `CHAT_AGENT_BASE_PROMPT` → mission(+device) → activeIdea → designSpec → mockupHtml → retrievedMemory → cited/selected/reference context → mentionedArtifact → requestedCommand → actionInstruction → currentRequest로 재배치했다. builtMessages는 기존처럼 system message 뒤에 붙는다.
- 수정: target device는 별도 system prompt block에서 mission prompt 하위 라인으로 합쳤다. 이에 따라 `selectedContextKeys` 초기값에서 `device`를 제거하고 mission context가 device까지 포함하는 계약으로 바꿨다.
- 수정: `compactHtmlForModel()`을 추가해 모델 prompt에 넣는 mockupHtml에서 HTML 주석, script, base64 image data URI, inline SVG 내부, 과도한 공백을 제거한 뒤 12000자로 자른다. 이 compact는 chat prompt 전용이며 Stitch 편집 API로 전달되는 원본 HTML에는 적용하지 않는다.
- 유지: cited reference는 system context에 넣으면서도 기존처럼 builtMessages의 최신 user message 앞에 인용 레퍼런스 제목을 덧붙인다. retrieved memory는 15.208의 단일 `chatRetrievedMemoryPrompt` 경로를 유지한다.

### 15.215 Design Brief command 분리와 style shell fill `[implemented 2026-07-13]`

- 배경: 디자인 스타일을 먼저 만든 경우 활성 시안은 Design Style만 있고 Design Brief가 비어 있는 shell이 된다. 이 상태에서 기존 `/시안생성` 라벨은 새 시안을 만들라는 뜻처럼 보여, 사용자가 "현재 시안에 Design Brief만 작성"하려는 상황과 충돌했다.
- 수정: 기본 command 순서는 `/새시안추가`, `/디자인브리프작성`, `/디자인스타일작성`, `/목업생성`, `/레퍼런스검색`으로 둔다. 빈 새 시안 추가 command는 `/새시안추가` / `create_blank_idea`로 유지하고, 현재 시안의 Design Brief 작성 command는 `/디자인브리프작성` / `create_idea`로 유지한다. 새 시안 추가와 Design Brief 작성을 한 번에 묶는 별도 shortcut command는 제거했다.
- 수정: Design Brief와 Design Style은 둘 다 텍스트 산출물이므로 visible label의 동사를 `작성`으로 통일했다. 이에 따라 Design Style command label은 `/디자인스타일작성`이고 내부 command id는 기존 `create_design_style`을 유지한다.
- 수정: 빈 새 시안 추가는 LLM 호출 없이 클라이언트에서 처리해 Design Brief 또는 Design Style 중 원하는 것부터 작성할 수 있게 한다.
- 수정: 디자인 스타일만 있고 Design Brief와 artboard가 없는 활성 시안에서는 명시적 `create_idea` command로 온 `[CREATE_NOTE]`도 새 시안을 만들지 않고 해당 style shell의 Design Brief를 채운다.
- 문서: 4.6 Current Snapshot과 15.157 decision log의 `/시안생성` 설명을 stale 처리하고 새 label/동작 계약을 기록했다.

### 15.216 Stitch asset-led URL text generation 기본화 `[implemented 2026-07-13]`

- 배경: Stitch SDK 생성 API는 복구됐지만, mission asset-led 경로에서 `project.upload`로 만든 IMAGE screen을 `edit_screens` 대상으로 넘기면 `Request contains an invalid argument`가 반복됐다. 이 실패는 2분 이상 걸린 뒤 같은 URL text fallback으로 내려가므로 사용자 대기 시간이 과도했다.
- 수정: `/api/stitch`의 `isAssetLed` 분기는 더 이상 mission asset을 다운로드해 Stitch에 업로드한 뒤 `edit_screens`를 호출하지 않는다. 대신 asset URL과 note manifest를 `generate_screen_from_text` prompt에 직접 넣고, 각 URL을 `img src`로 그대로 쓰라고 지시한다.
- 유지: URL text generation이 인증 실패하면 API key 클라이언트로 새 Stitch project를 만들어 재시도하고, API key 경로도 인증 실패하면 OpenAI direct HTML fallback을 사용한다. 이 direct HTML 결과는 실제 Stitch screen이 아니므로 `screenId`/`projectId` 없이 저장한다.
- 문서: 4.4 Current Snapshot의 콘텐츠 자산 주도 생성 계약과 15.89 구현 로그를 URL text generation 기준으로 갱신했다.

### 15.217 Stitch asset-led invalid-argument direct fallback `[implemented 2026-07-13]`

- 배경: Stitch 공식 upload-image 문서/SDK 구현을 확인한 결과 `project.upload(filePath)`는 이미지 파일을 UI 생성 입력으로 넘기는 API가 아니라 `screens:batchCreate`로 `IMAGE` screen canvas를 만드는 API다. 그래서 mission asset을 업로드한 뒤 그 IMAGE screen을 `edit_screens` 대상으로 쓰는 방식은 asset-led 생성 계약과 맞지 않는다.
- 관찰: asset URL manifest를 `generate_screen_from_text` prompt에 넣는 경로도 일부 요청에서 `Request contains an invalid argument`로 거부된다. 이 경우에는 Stitch 안에서 asset URL을 보존한 screen을 만들 수 없으므로 500을 반환하지 않고 OpenAI direct HTML fallback으로 내려간다.
- 수정: `/api/stitch`의 asset-led 분기는 URL text generation이 `invalid argument`로 실패하면 즉시 OpenAI direct HTML fallback을 사용한다. 인증 실패로 API key fallback project를 만든 뒤에도 인증 오류 또는 `invalid argument`가 나면 동일하게 direct HTML fallback으로 내려간다.
- 문서: 4.4 Current Snapshot에서 asset-led의 upload/edit 제외 사유와 direct fallback 조건을 갱신했고, Stitch 일시 실패 복구 설명에서 asset-led upload 전제를 제거했다.

### 15.218 Stitch asset-led HTML coverage guard `[implemented 2026-07-13]`

- 배경: Stitch `generate_screen_from_text`가 200으로 성공하고 screen HTML을 반환해도 mission asset URL을 실제 `img src`로 쓰지 않고 다른 이미지를 넣는 사례가 확인됐다. 이 상태를 성공으로 저장하면 asset-led의 핵심 계약인 실제 콘텐츠 이미지 보존이 깨진다.
- 수정: `/api/stitch`는 asset-led Stitch 결과 HTML을 받은 뒤 각 mission asset의 URL, Storage path, URL-encoded path가 HTML에 포함되는지 검사한다. 모든 asset이 매칭되지 않으면 Stitch 결과를 버리고 OpenAI direct HTML fallback을 생성해 반환한다.
- 로그: 정상 보존 여부는 `[stitch] asset-led HTML asset coverage: N/M`으로 남긴다. `N/M`이 전체 매칭이 아니면 `[stitch] asset-led Stitch result did not preserve every mission asset; generating direct HTML fallback` 이후 `openai-asset-fallback-*` screen id가 반환된다.
- 문서: 4.4 Current Snapshot의 asset-led 계약에 Stitch 성공 후 HTML coverage guard를 추가했다.

### 15.219 OpenAI asset fallback synthetic id 정리 `[implemented 2026-07-13]`

- 배경: asset-led coverage guard가 OpenAI direct HTML fallback으로 내려갔을 때 fallback screen id가 빈 문자열로 로그에 찍혔다. 이는 실제 Stitch screen이 아니라는 의미였지만, 클라이언트 상태/로그에서는 추적이 어렵고 빈 `stitchScreenId`가 저장될 수 있다.
- 수정: OpenAI asset fallback은 자체 HTML에도 모든 asset URL/path가 포함되는지 검사한 뒤 `openai-asset-fallback-*` synthetic id를 반환한다. 이 id는 앱 내부 식별용이며 Stitch project 안에 존재하는 screen이 아니다.
- 보호: 클라이언트가 기존 아트보드를 수정할 때 `openai-asset-fallback-*` id는 `/api/stitch`의 `screenId`로 보내지 않는다. 따라서 fallback HTML을 이후 수정해도 fake id를 Stitch `edit_screens` 대상으로 오인하지 않는다.
- 문서: 4.4 Current Snapshot에 synthetic id와 edit 제외 계약을 반영했다.

### 15.220 Asset-led first-design-then-edit probe `[implemented 2026-07-13]`

- 배경: Stitch 공식 SDK 예제의 edit 흐름은 `project.generate(...)`로 만든 기존 DESIGN screen을 `screen.edit(...)`로 수정하는 구조다. 기존 asset-led upload/edit 경로는 first DESIGN screen 없이 `project.upload(image)`로 만든 IMAGE screen을 바로 `edit_screens` 대상으로 써서 `invalid argument`가 날 가능성이 높았다.
- 수정: asset-led 신규 목업은 먼저 `generate_screen_from_text`로 asset URL manifest가 포함된 first DESIGN screen을 만든다. 이 결과 HTML이 asset coverage를 통과하면 그대로 Stitch screen을 반환한다.
- 수정: first DESIGN screen의 coverage가 부족하면 즉시 OpenAI fallback으로 가지 않고, 방금 생성된 DESIGN screen을 `edit_screens` 대상으로 한 번 더 보정한다. 보정 prompt는 누락된 mission asset URL을 `img src`에 직접 넣고, 중요한 상품 이미지는 자르지 말고 필요 시 `object-fit: contain`을 쓰라고 지시한다.
- 실패 처리: 보정 edit이 실패하거나 보정 HTML도 coverage를 통과하지 못하면 기존 OpenAI direct HTML fallback으로 내려간다. 이 fallback은 synthetic id를 쓰므로 공식 Stitch screen은 아니며, first DESIGN/edited DESIGN이 성공한 경우에만 공식 Stitch project에 남는다.
- 문서: 4.4 Current Snapshot의 asset-led 계약을 generate-first, edit-repair 순서로 갱신했다.

### 15.221 Asset fallback HTML upload to Stitch `[superseded 2026-07-13 → 15.222]`

- 배경: 실제 로그에서 asset-led first DESIGN screen coverage가 `0/6`, generated DESIGN screen edit 보정 후 coverage도 `0/6`으로 확인됐다. 이 경우 OpenAI direct HTML fallback은 asset URL을 보존하지만 synthetic id라 공식 Stitch 웹에 남지 않았다.
- 수정: OpenAI asset fallback HTML이 coverage 검사를 통과하면, 서버가 HTML을 임시 `.html` 파일로 저장하고 `project.upload(..., { title: "Asset fallback mockup" })`로 현재 Stitch project에 업로드한다. HTML upload는 SDK 구현상 `DOCUMENT` screen이므로 이미지 upload의 `IMAGE` screen edit 문제를 피한다.
- 반환: HTML upload가 screen id를 반환하면 해당 Stitch screen id와 현재 project id를 그대로 반환한다. 따라서 fallback 결과도 공식 Stitch project/web에 남을 수 있다.
- 안전장치: HTML upload가 실패하거나 screen id를 반환하지 않는 마지막 경우에만 기존 `openai-asset-fallback-*` synthetic id로 돌아간다. synthetic id는 클라이언트에서 Stitch edit 대상에서 제외된다.
- 문서: 4.4 Current Snapshot의 asset-led fallback 계약을 synthetic-only에서 HTML upload 우선으로 갱신했다.

### 15.222 Asset fallback HTML upload 제거 `[implemented 2026-07-13]`

- 배경: HTML upload fallback은 SDK의 `project.upload(.html)`가 지원하는 DOCUMENT screen import를 이용한 우회였지만, Stitch가 공식적으로 제공하는 생성/수정 루트는 `generate_screen_from_text`와 `edit_screens`이며 HTML import를 생성 결과 대체 경로로 쓰는 것은 목표와 어긋났다.
- 수정: OpenAI asset fallback HTML을 Stitch project에 `.html`로 업로드하는 경로를 제거했다. fallback은 다시 앱 표시용 standalone HTML과 `openai-asset-fallback-*` synthetic id만 반환한다.
- 유지: asset-led는 먼저 `generate_screen_from_text`로 first DESIGN screen을 만들고, coverage가 부족하면 그 DESIGN screen을 `edit_screens`로 한 번 보정한다. 이 두 Stitch 경로가 coverage를 통과할 때만 실제 Stitch screen을 최종 결과로 반환한다.
- 문서: 4.4 Current Snapshot을 HTML upload 우선 설명에서 direct HTML fallback 설명으로 되돌렸다.

### 15.223 선택 요소 수정 요청의 generate 오분류 방어 `[implemented 2026-07-13]`

- 배경: 사용자가 목업 iframe에서 `img.product-img`를 인용한 뒤 "여기 안에 들어가는 이미지를 꽉 차게 만들어줘"처럼 선택 요소 편집을 요청했는데, assistant action이 `[GENERATE_MOCKUP]`으로 나오면 클라이언트가 새 목업 생성으로 처리했다. 이 경우 `/api/stitch` 로그가 `generating screen for prompt`로 찍히고 기존 screenId 없이 `generate_screen_from_text`를 호출하므로 Stitch가 이미지까지 새로 생성할 수 있었다.
- 수정: 선택 요소가 있고 해당 artboard가 존재하며 사용자가 새 시안/새 화면을 명시하지 않았으면 `[GENERATE_MOCKUP]`도 edit action처럼 처리한다. 이때 선택 요소가 속한 artboard를 edit target으로 우선 사용해 기존 screenId를 `/api/stitch`에 전달한다.
- 이미지 보존: 선택 요소가 `img`이거나 이미지를 포함하면 Stitch prompt에 기존 `img src`를 그대로 보존하라고 명시한다. "꽉 차게/fit/crop/align" 계열 요청은 이미지 교체가 아니라 object-fit, width, height, aspect ratio, overflow 같은 CSS 수정으로 제한한다.

### 15.224 Stitch edit no-op 실패 처리 `[implemented 2026-07-13]`

- 배경: 15.223 이후 선택 요소 수정 요청이 `editing screen` 경로로 들어가는 것은 확인됐지만, Stitch가 200 응답과 같은 screen id를 반환하면서 HTML은 기존 artboard와 동일한 사례가 있었다. 서버는 기존 HTML hash와 달라질 때까지 여러 번 재조회했지만 끝까지 동일했고, 클라이언트는 이를 성공처럼 처리해 화면이 바뀌지 않았다.
- 수정: edit 요청에 `previousHtmlHash`가 있고 재조회 결과 HTML hash가 끝까지 동일하면 `/api/stitch`가 409와 `stitch-edit-unchanged`를 반환한다. 클라이언트는 기존 `stitchResponseError` 경로로 이 메시지를 표시하고 artboard를 동일 HTML로 덮어쓰지 않는다.
- 의도: Stitch가 실제로 수정하지 않은 no-op 응답을 성공 결과로 저장하지 않는다. 이후 필요하면 이 실패 조건에서 OpenAI HTML edit fallback이나 CSS-only local patch를 별도 계약으로 추가한다.

### 15.225 선택 요소 편집 원문/selector 보존 강화 `[implemented 2026-07-13]`

- 배경: `div.col-span-2 이거 없애줘`처럼 사용자가 selector와 삭제 의도를 직접 준 요청이 planner를 거치며 `Remove the decorative icon and its container...`처럼 의미 기반 영어 action으로 바뀌었다. 이 action은 사용자 원문의 selector 삭제 의도를 약화시키고, Stitch가 선택된 container 자체가 아니라 장식 icon 정도로 해석할 여지를 만들었다.
- 수정: chat action prompt에 선택 요소 편집 시 selector 또는 XPath와 사용자의 구체 operation을 `[EDIT_MOCKUP]` 안에 보존하라는 규칙을 추가했다. 삭제/제거 계열 요청은 선택된 element 자체를 제거하라고 명시한다.
- 수정: 클라이언트가 Stitch에 넘기는 최종 edit prompt에도 사용자 원문 요청, selector, XPath, 선택 HTML을 함께 넣는다. 원문이 remove/delete/없애/삭제/제거/빼/지워 계열이면 "선택된 HTML element 자체와 그 selected container를 제거하라"는 지시를 추가한다.
- 의도: assistant가 만든 user-visible action이 다소 추상화되더라도 downstream Stitch edit에는 원문과 정확한 target이 남아 no-op 또는 잘못된 부분 편집 가능성을 낮춘다.

### 15.226 Stitch edit prompt 희석 제거와 no-op 추적 로그 `[implemented 2026-07-13]`

- 배경: 15.225 이후에도 `div.col-span-2 이거 없애줘` 요청이 `editing screen`으로 들어갔지만, Stitch가 동일 HTML을 반환해 409 no-op으로 끝났다. 이 경우 원문/selector 보존 외에도, edit prompt에 active design brief가 다시 붙어 국소 삭제 지시가 전체 brief 유지 신호와 섞이는 문제가 있었다. 또한 `edit_screens` raw response를 보지 못해 Stitch가 텍스트/제안만 반환했는지, 기존 screen만 반환했는지, 새 screen 후보를 반환했는지 추적하기 어려웠다.
- 수정: edit 호출에서는 `buildMockupPrompt`에 active idea를 넘기지 않는다. 신규 생성만 active design brief와 mission brief를 붙이고, 기존 screen edit은 사용자의 edit instruction과 선택 요소 target block 중심으로 보낸다.
- 추적: `/api/stitch`의 edit 경로가 prompt 길이와 앞부분 sample을 서버 로그에 남긴다. `edit_screens` raw response는 projectId, sessionId, output component keys, text/suggestion 일부, 반환된 screen id 목록으로 요약 로그를 남긴다.
- 의도: 다시 no-op이 발생했을 때 "프롬프트가 약했는지", "Stitch가 거절/제안 텍스트를 반환했는지", "새 screen을 반환했는데 복구하지 못했는지"를 로그만으로 구분할 수 있게 한다.

### 15.227 선택 요소 삭제 no-op 로컬 fallback `[implemented 2026-07-13]`

- 배경: `이거 없애줘` 요청에서 Stitch `edit_screens` raw response는 text-only로 "bg-brand-accent/5 tint layer를 삭제했다"고 설명했지만 design screen을 반환하지 않았고, 기존 screen HTML 재조회도 8회 모두 동일했다. 즉 프롬프트 이해 문제라기보다 Stitch가 텍스트 응답만 성공처럼 반환하고 실제 HTML persistence를 하지 않은 케이스다.
- 수정: `/api/stitch`가 `stitch-edit-unchanged` 409를 반환했고, 원 요청이 선택 요소 삭제/제거 계열이면 클라이언트가 현재 artboard HTML을 `DOMParser`로 파싱해 선택 요소 XPath를 우선 제거한다. XPath가 실패하면 selector와 선택 HTML 매칭으로 fallback한다.
- 보호: 로컬 fallback이 적용된 artboard는 `stitchScreenId`를 `local-edit-fallback-*` synthetic id로 바꾼다. 클라이언트는 synthetic id를 이후 `/api/stitch`의 `screenId`로 보내지 않으므로, 앱 HTML과 공식 Stitch 원본 screen이 갈라진 상태에서 원본 screen을 다시 편집 대상으로 삼지 않는다.
- 범위: 현재 fallback은 단순 선택 요소 삭제/제거 요청에만 적용한다. 크기/색/이미지 fit 같은 수정은 Stitch no-op이면 여전히 실패로 드러내고, 필요 시 별도 deterministic patch 또는 OpenAI HTML edit fallback을 설계한다.

### 15.228 Toast 좌측 하단 배치 `[implemented 2026-07-13]`

- 배경: Notion `39cd5dc81f6680efbbf3e8f456d336bb`에서 답변 평가 저장 toast가 채팅 영역과 겹치지 않도록 `우측하단→좌측하단`으로 옮기는 요청이 있었다.
- 수정: 전역 Sonner `Toaster` 기본 position을 `bottom-left`로 설정했다. Assistant feedback reason dialog 위치는 기본 중앙 배치를 유지한다.
- 의도: 우측 고정 채팅 패널과 채팅 입력창을 toast가 가리지 않게 한다.

### 15.229 Assistant feedback weight delta 재보정 `[implemented 2026-07-13]`

- 배경: Notion `39bd5dc81f66802ea0b4f06e3b4301b8`의 0713 피드백. 답변 생성 전에 `/api/memory/retrieve`가 사용된 memory weight를 기본적으로 올리기 때문에, feedback에서 좋아요 `+0.08`, 싫어요 `-0.04`를 그대로 더하면 최종 효과가 좋아요는 과하게 커지고 싫어요는 거의 상쇄된다.
- 수정: `memoryFeedbackWeights.ts`의 feedback delta를 좋아요 `+0.04`, 싫어요 `-0.08`로 조정했다.
- 의도: retrieval reward를 포함한 최종 효과가 대략 좋아요 `+0.08`, 싫어요 `-0.04`가 되게 한다. 재투표/재저장은 기존 `assistantFeedbackWeightAdjustment.deltaPerMemory`와 새 desired delta의 차이만 적용하므로 중복 누적은 기존처럼 막는다.

### 15.230 Planner semantic memory cap 10 정렬 `[implemented 2026-07-13]`

- 배경: Notion `39cd5dc81f66808e9b70f56e1367da48` 지적. 15.209에서 retrieval top-k와 answer prompt cap은 10으로 올렸지만, `/api/chat` planner compact input의 `semanticMemories`는 `.slice(0, 5)`로 남아 있어 planner는 검색된 10개 중 5개만 봤다.
- 수정: `compactPlannerSemanticMemories()`의 cap을 5에서 10으로 올렸다.
- 의도: planner intent/needs/memoryRelevance 판단이 answer prompt에 들어갈 top 10 retrieved memory와 같은 후보 범위를 보게 한다. 이 cap은 retrieval/filter 우회가 아니라 이미 선택된 `memoryContext`의 compact view에만 적용된다.

### 15.231 좋아요/싫어요 태그 표현을 선호 표시로 변경 `[implemented 2026-07-13]`

- 배경: Notion `39cd5dc81f6680cd9f8ad72a02411b18` 요청. assistant response feedback이라는 표현이 연구/리뷰 UI에서 답변 품질 평가처럼 보이므로, 좋아요/싫어요가 사용자 선호 신호임을 드러내는 표현이 필요했다.
- 수정: 새 memory draft의 `agentActionCategory`는 `preference_signal`이 아니라 표시 대상 assistant 답변의 원래 action category로 저장한다. 예를 들어 디자인 스타일 답변에 좋아요를 누르면 action은 `design_spec_create`로 유지되고, 좋아요/싫어요 여부는 `preferenceSignal` metadata에 별도 저장된다.
- 수정: 기존 저장 데이터의 `assistant_feedback`/`preference_signal` action은 review/timeline 표시 단계에서 legacy preference alias로만 읽는다. Cluster detail/side panel/graph에서 `선호 표시`는 일반 action chip과 분리된 rose badge로 렌더링해 source/action 태그를 대체하지 않게 했다.
- 유지: `feedback-{messageId}` interaction id, `assistantFeedback` payload, `assistantFeedbackWeightAdjustment` metadata는 기존 저장/재투표/weight adjustment 호환을 위해 그대로 둔다.

### 15.232 목업 iframe vh regex 이스케이프와 min-height pinning 보강 `[implemented 2026-07-13]`

- 배경: Notion `39cd5dc81f6680fc8f39caae8afac511`의 목업 렌더링 버그. 하단에서는 정상인데 상단 목업 캔버스에서 긴 빈 영역/늘어난 영역이 나타났고, srcdoc 내부 `unitRe`가 `/(d*.?d+)(svh|dvh|lvh|vh)/g`처럼 백슬래시가 빠진 상태로 들어가는 증거가 있었다.
- 원인: `injectHeightReporter`의 주입 script는 TypeScript template literal 안에 있으므로 regex literal의 `\d`와 `\.`가 한 번 더 이스케이프되어야 한다. 한 겹만 쓰면 실제 srcdoc에서는 `d`와 `.`처럼 변해 `80vh`/`min-h-[80vh]`를 px로 치환하지 못한다.
- 수정: `replaceVh()`의 regex source를 `\\d*\\.?\\d+` 형태로 이중 이스케이프해 실제 srcdoc에 `\d*\.?\d+`가 남도록 했다.
- 수정: `setBox()`가 inline `height`뿐 아니라 `min-height`도 같은 px 값으로 `!important` 고정한다. `min-h-[80vh]`처럼 min-height 기반인 Tailwind arbitrary class가 iframe 성장 후 clamp 규칙으로 다시 커지는 것을 막기 위함이다.
- 검증: node 문자열 확인으로 실제 주입 문자열에 `\d`가 남는 것을 확인했다. `npx tsc --noEmit`, `git diff --check`, 변경 파일 lint 통과.

### 15.233 Artboard HTML 저장 보존과 Stitch HTML polling 내성 `[implemented 2026-07-13]`

- 배경: viewAs로 `/main/mission-20260611-202001`에 접근했을 때 artboard가 `화면을 불러오지 못했습니다` 상태로 보였고, 로그에는 `/api/stitch/html?...screenId=...` 500이 찍혔다. 원인은 세션 저장 시 `stitchScreenId`가 있는 artboard의 `html`을 무조건 빈 문자열로 비워 저장해, 새로고침/viewAs 복원이 Stitch `getHtml()` 재조회 성공에 전적으로 의존한 것이다.
- 수정: 세션 snapshot에 artboard `html`을 보존한다. 저장된 HTML이 있으면 reload/viewAs에서 즉시 iframe을 렌더하고, Stitch 재조회는 HTML이 비어 있는 기존/extra/pending screen에만 사용한다.
- 수정: `openai-asset-fallback-*`/`local-edit-fallback-*` synthetic screen id는 Stitch 재조회 대상으로 보지 않는다.
- 수정: `/api/stitch/html`은 `getScreen`/`getHtml`/HTML URL fetch 실패를 내부 retry하고, 일시 실패나 빈 HTML은 500 대신 `{ htmlPending: true }` 202로 반환한다. 영구적인 screen id 오류로 보이는 경우는 404, `The caller does not have permission` 같은 권한 실패는 403으로 즉시 반환한다.
- 한계: 이미 예전 snapshot에서 `html`이 빈 문자열로 저장된 artboard는 Stitch 재조회가 계속 실패하면 앱 쪽에 복구할 HTML 원본이 없다. 이 경우 새로 생성/편집해 HTML이 다시 저장되어야 한다.

### 15.234 메모리 클러스터 mean-centering 1차 적용 `[implemented 2026-07-13]`

- 배경(Notion `거대 클러스터 없애기 - 클러스터링 로직 수정`): 기존 similarity graph는 저장 embedding을 그대로 사용하고, node별 KNN 3개 edge와 label propagation을 결합했다. 디자인 작업 memory는 portfolio/mockup/design style 같은 공통어와 embedding 입력 boilerplate가 많아 baseline similarity가 높고, A-B-C-D chaining이 커지면 label propagation이 dense graph를 하나의 giant community로 합치는 문제가 있었다.
- 수정: clustering graph를 만들기 전에 저장 embedding 전체 평균 벡터를 빼고 다시 L2 normalize한다. 이 mean-centering은 clustering-time transform일 뿐 Firestore의 `memories_0_1_2.embedding` 값은 바꾸지 않는다.
- 유지: label propagation, KNN 3개 edge, 최대 16개 centroid merge 상한은 그대로 둔다. raw embedding 시절의 strong/min 고정 threshold는 15.237에서 centered vector 분포 기반 adaptive threshold로 대체하고, 고정 16개 merge cap은 15.240에서 node 수 기반 dynamic cap으로 대체한다. 34% community 재분할과 farthest-anchor 강제 split은 의미 품질에 부작용이 있을 수 있어 이번 1차 적용에서는 넣지 않는다.
- 캐시: clustering method version을 `similarity-graph-v5-centered-embedding`으로 올리고, latest cache fallback도 current method version만 읽게 해 기존 v4 cache와 섞이지 않게 했다. 저장 memory 삭제나 re-embedding 없이 cluster 재생성만으로 새 로직을 확인할 수 있다.
- 진단: `graphDiagnostics.graph.meanCentered`를 남겨 재생성 결과가 centered vector 기반인지 확인할 수 있게 했다.

### 15.237 메모리 클러스터 adaptive threshold 보정 `[implemented 2026-07-13]`

- 배경(Notion `RE`): 15.234에서 mean-centering을 적용한 뒤에도 raw embedding 시절의 `0.58/0.74` 고정 threshold를 유지해 centered similarity graph가 과도하게 끊길 수 있었다. 실제 진단에서 69 nodes에 18 edges처럼 edge 밀도가 너무 낮아지고, label propagation보다 최대 16개 merge cap이 cluster membership을 사실상 결정하는 상태가 관찰됐다.
- 수정: `similarityEdges`가 현재 clustering 실행의 전체 pairwise similarity 분포를 계산한 뒤 min threshold는 p85, strong threshold는 p97 분위수로 도출한다. 강한 edge와 node별 KNN 후보 필터는 이 adaptive threshold를 사용한다.
- 캐시: clustering method version을 `similarity-graph-v6-centered-adaptive-threshold`로 올려 v5 centered-fixed-threshold cache와 섞지 않는다. 저장 memory embedding은 그대로 두고 cluster 재생성만 필요하다.
- 진단: `graphDiagnostics.graph.minSimilarity`와 `strongSimilarity`는 이번 실행에서 실제 계산된 threshold 값을 저장하고, `thresholdMode`, `minSimilarityQuantile`, `strongSimilarityQuantile`도 함께 남겨 후속 튜닝 근거를 확인할 수 있게 했다.

### 15.235 Archived memory graph detail 보강 `[implemented 2026-07-13]`

- 배경(Notion `39cd5dc81f6680109d69d9500b1265b3`): archived memory는 current clustering 입력에서 제외되므로 cluster cache의 `itemIds`에 없을 수 있다. 이 상태에서 graph node를 눌러도 side panel은 선택 cluster의 item만 렌더해 삭제된 memory의 상세가 비어 보였다. 또한 세션 리뷰에서는 전체 memory 보기와 달리 archived memory가 session snapshot filter에 막혀 보이지 않는 경우가 있었다.
- 수정: `MemoryClusterSidePanel`이 선택된 memory id를 cluster item 목록에서 찾지 못하면 `memories` 목록에서 fallback item을 만들어 단독 detail card로 보여준다. 따라서 cluster cache에 포함되지 않은 archived/inactive memory도 클릭하면 semantic, episodic, original input, keyword, weight를 확인할 수 있다.
- 수정: 세션 리뷰 graph의 after phase에서는 해당 세션에서 생성된 archived memory와 referenced/promoted/duplicate 관계로 사라진 archived memory를 snapshot `itemIds` 밖에 있어도 visible node 후보에 포함한다. 이런 node는 기존처럼 임시 unclustered cluster에 묶이고, cluster list에는 이번 세션에서 추가된 node `+n`과 삭제된 node `-n`을 함께 표시한다.
- 표시: archived/inactive graph node는 옅은 회색과 낮은 alpha로 렌더하고, side panel card도 더 흐린 배경/텍스트와 `삭제됨` 또는 `비활성` badge를 사용한다.

### 15.238 Memory graph layout edge normalization `[implemented 2026-07-13]`

- 배경: clustering은 15.237에서 centered adaptive threshold로 바뀌었지만 client graph layout은 raw embedding 시절의 `0.58/0.28` weight normalization을 계속 사용했다. centered graph edge는 0.58보다 낮을 수 있어 layout engine이 실제 연결을 약한 edge처럼 취급했고, repulsion과 hard coordinate clamp가 결합해 node가 사각형 경계에 일렬로 붙는 현상이 생겼다.
- 수정: `MemoryClusterGraph`의 force layout과 edge drawing이 현재 edge weight 분포의 p05~p95 범위로 strength를 정규화한다. 그래서 server threshold가 바뀌어도 client layout은 해당 graph 안의 상대적 강도를 기준으로 spring distance, force, edge alpha/width를 계산한다.
- 수정: layout simulation의 `[-2.2, 2.2]` hard position clamp를 제거하고, soft boundary force와 velocity clamp로 과한 drift만 완화한다. 최종 화면 fit은 기존처럼 canvas padding 안에 맞추되, 물리 좌표가 벽에 잘려 같은 x/y 값으로 쌓이지 않게 한다.

### 15.239 Memory cluster color preservation `[implemented 2026-07-13]`

- 배경(Notion `색 보존 알고리즘 추가하기`): cluster id와 color가 `graph-cluster-01` 같은 정렬 index에 묶여 있어, 재생성 후 같은 의미의 cluster라도 크기/순서가 바뀌면 색이 바뀌었다. Split된 경우 두 cluster가 같은 색을 공유하면 구분성이 떨어지므로 계승 규칙이 필요했다.
- 수정: `MemoryCluster`에 `colorIndex`를 추가하고 cluster 저장 직전 이전 cluster doc과 새 cluster의 `itemIds` overlap을 비교한다. 가장 큰 overlap을 가진 이전 cluster의 colorIndex를 새 cluster가 계승하며, 같은 이전 cluster가 여러 새 cluster로 split되면 overlap이 가장 큰 successor 하나만 기존 색을 가져간다. 나머지 신규/split cluster는 현재 사용 중이지 않은 palette slot을 우선 배정한다.
- 적용: 일반 `/api/memory/clusters` 및 admin cluster cache 생성은 latest cluster doc을 color source로 사용한다. 세션 리뷰 snapshot은 before snapshot이 latest cluster doc 색을, after snapshot이 before snapshot 색을 이어받아 phase 전환 시 같은 cluster가 가능한 한 같은 색으로 보인다.
- 표시: `MemoryClusterList`와 `MemoryClusterGraph`는 배열 index 대신 `cluster.colorIndex`를 우선 사용하고, 값이 없는 legacy cluster는 기존처럼 index fallback을 사용한다.

### 15.240 Dynamic memory cluster merge cap `[implemented 2026-07-13]`

- 배경: `MAX_GRAPH_CLUSTER_COUNT = 16`을 모든 node count에 그대로 적용하면 작은 memory set에서도 최대 16개까지 cluster가 유지되어 과분할처럼 보일 수 있고, 반대로 diagnostics에서 16개가 나오면 cap이 binding 중인지 해석하기 어려웠다.
- 수정: `MAX_GRAPH_CLUSTER_COUNT`는 점근 상한으로 유지하고, 실제 merge target은 `dynamicMaxClusterCount(nodeCount) = max(1, min(16, max(floor(nodeCount / 5), floor(1.5 * sqrt(nodeCount)))))`로 계산한다. 작은 node set에서는 `1.5 * sqrt(nodeCount)`가 early lift를 제공하고, 큰 node set에서는 `nodeCount / 5`가 지배해 70 nodes → 14, 100 nodes → 상한 16에 가까워진다.
- 진단: `graphDiagnostics.graph.maxClusterCount`에 이번 실행에서 적용된 dynamic cap을 저장해, `rawCommunityCount`, `cappedCommunityCount`와 함께 merge cap 개입 여부를 확인할 수 있게 했다.

### 15.242 Memory review v3 two-step flow `[implemented 2026-07-13]`

- 배경(Notion `v3`): 세션 종료 후 곧바로 클러스터 그래프가 있는 메모리 리뷰 화면으로 들어가면, 사용자가 먼저 오늘 세션을 복기하고 앞으로 기억할 내용을 자유롭게 적기 어렵다. 또한 이 첫 질문지는 채팅을 보며 작성해야 하므로 채팅을 blur나 backdrop으로 가리면 안 된다.
- 수정: 사용자용 `리뷰 보기`와 리뷰 모드의 `메모리 리뷰하기` CTA는 먼저 Part 1 패널을 연다. 이 패널은 1~7점 척도 2문항과 자유기입 1문항을 받고, 척도에는 `1 전혀 아니다`/`4 보통`/`7 매우 그렇다` 지표를 함께 표시한다. 패널은 backdrop 없이 header 아래 전체폭 strip으로 표시해 왼쪽 작업/리뷰 영역과 오른쪽 채팅을 덮지 않는다.
- 수정: Part 1 strip의 닫기 X를 제거했다. 닫으면 다시 진입하기 어렵게 느껴지는 문제를 막고, `다음`을 통해 Part 2로 이어지는 흐름만 남긴다.
- 저장: Part 1 답변은 기존 `memoryReviewFeedback/{missionId}.answers`에 `session_understanding`, `memory_helpfulness`, `future_memory_freeform` 키로 draft 저장한다. Part 2 패널의 변경/제출은 기존 답변 객체와 merge해 Part 1 답변을 덮어쓰지 않는다.
- 수정: `MemoryReviewPanel` 질문을 v3 Part 2의 4~9번 문항으로 바꾸고 `startNumber`를 받아 4번부터 번호를 표시한다. Part 2는 기존처럼 cluster/memory mention, draft autosave, 제출 확인 후 lobby 이동을 유지한다.
- 유지: Admin viewAs의 `메모리 리뷰하기` CTA는 관측용이므로 Part 1 없이 기존 full-screen memory overlay를 바로 연다.

### 15.243 Action chip delimiter residue cleanup `[implemented 2026-07-13]`

- 배경(Notion `output`): assistant bubble에서 `디자인 스타일 추가됨` action chip 아래에 단독 `}` 문자가 노출되는 사례가 있었다. 디자인 스타일 action payload를 chip으로 치환하거나 저장 후 message content를 재작성할 때, JSON/action delimiter 일부가 일반 텍스트처럼 남는 경로가 원인이었다.
- 수정: `processMessageContent()`가 action chip 전후에 남은 텍스트가 단독 `}`/`]` delimiter 잔여물이거나 `}좋아요`처럼 본문 앞에 붙은 delimiter 잔여물이면 해당 delimiter를 text part에서 제거한다.
- 수정: `stripDesignSpecActionBlocks()`가 regex 대신 `actionBlockEnd()` 구조적 scanner로 `CREATE_DESIGN_SPEC`/`EDIT_DESIGN_SPEC` block을 제거한다. 닫는 대괄호가 있거나 없어도 JSON 균형 기준으로 같은 end position을 사용해 저장 후 chat bubble에 잔여 delimiter가 남지 않게 한다.

### 15.244 Stitch edit no-op 지연 반영 진단 로그 `[implemented 2026-07-13]`

- 배경(Notion `Stitch Edit`): Stitch `edit_screens`가 text-only 성공 응답을 반환한 뒤 앱은 약 20초 재조회 후 동일 HTML이면 `stitch-edit-unchanged` 409로 처리했다. 하지만 Stitch tool 계약상 edit 작업이 몇 분 뒤 반영될 수 있어, 현재 409가 진짜 no-op인지 너무 빠른 실패 판정인지 증거가 부족했다.
- 수정: `/api/stitch`가 `stitch-edit-unchanged`를 반환하기 직전에 같은 project/screen에 대해 2분, 5분 지연 재조회를 예약한다. 각 재조회는 기존 HTML hash, 현재 HTML hash, HTML 길이, 변경 여부를 `[stitch] delayed edit recheck` 로그로 남긴다.
- 수정: `listScreens()` 실패 로그에 projectId, message, raw error summary를 함께 남긴다. `recoverGeneratedScreen`이나 초기 before screen 수집에서 `list_screens`가 invalid argument로 실패할 때 어떤 project 인자로 실패했는지 확인하기 위함이다.
- 한계: 지연 재조회는 서버 프로세스가 살아 있는 동안의 진단용 로그다. 서버리스 환경에서 응답 이후 process가 정리되면 실행이 보장되지 않으므로, 지연 반영이 확인되면 별도 polling/pending UX로 승격해야 한다.

### 15.245 Stitch compact edit prompt experiment `[implemented 2026-07-14]`

- 배경(Notion `Stitch Edit`): 15.244 로그 결과, 20초/2분/5분 재조회가 모두 동일 hash였고 Stitch raw response는 수정했다고 설명했지만 `screenIds` 없이 text-only 응답만 반환했다. 지연 persist가 아니라 `edit_screens`가 설명 모드로 빠지는지 확인하려면 기존 개발자형 prompt와 다른 호출 형태를 비교해야 한다.
- 수정: `/api/stitch`에 `STITCH_EDIT_PROMPT_MODE=compact` 실험 플래그를 추가했다. 이 값이 켜진 edit 요청은 기존 raw HTML 중심 prompt 대신 사용자 원문, selector, XPath, visible text, selected element 요약만 담은 짧은 자연어 prompt를 Stitch에 보낸다.
- 수정: compact mode에서는 `edit_screens` 호출에 `modelId: GEMINI_3_1_PRO`를 명시한다. SDK tool definition에서 `GEMINI_3_PRO`는 deprecated라, 명시 model로 실제 screen mutation 여부를 비교하기 위함이다.
- 진단: edit prompt 로그에 `promptMode`, `modelId`, original length, 실제 전송 prompt length, sample을 함께 남긴다. 같은 no-op 케이스에서 `screenIds`, HTML hash 변경, delayed recheck 결과를 legacy mode와 비교한다.
- 유지: 플래그가 없으면 기존 legacy prompt와 modelId 미지정 경로를 그대로 사용한다. 이 변경은 실험용이며, 성공이 확인되기 전까지 기본 사용자 경로를 바꾸지 않는다.

### 15.246 Mockup action bracket-balanced parsing `[implemented 2026-07-14]`

- 배경(Notion `minor Stitch`): selected-element edit prompt가 `EDIT_MOCKUP` payload 안에 XPath `/main[1]/section[1]`를 포함하면 기존 regex가 첫 `]`에서 action block을 끊었다. 그 결과 채팅 bubble에는 action 나머지 텍스트가 노출되고, 실행용 Stitch prompt도 XPath 중간에서 잘렸다.
- 원인: `chat-content.ts`의 mockup/reference chip 규칙과 `page.tsx`의 mockup/reference 실행 추출이 모두 첫 닫는 대괄호를 action 종료로 보는 regex였다. Note/design spec 계열은 이미 balanced scanner를 쓰고 있었지만 mockup/reference 계열은 legacy regex로 남아 있었다.
- 수정: `src/lib/session/chat-content.ts`에 `findBracketActionBlock`/`stripBracketActionBlocks`를 추가해 `GENERATE_MOCKUP`, `EDIT_MOCKUP`, `FETCH_REFERENCES`, `WEB_SEARCHED`를 bracket depth 기반으로 찾는다. 표시용 chip, pending mockup completion split, cleanMessageContentForModel의 action cleanup이 이 scanner를 사용한다.
- 수정: `src/app/main/[missionId]/page.tsx`의 `FETCH_REFERENCES`, `GENERATE_MOCKUP`, `EDIT_MOCKUP` 실행 payload 추출도 같은 scanner를 사용한다. 따라서 payload 안의 XPath, Tailwind arbitrary class, 기타 `[`/`]` 조각이 있어도 action 전체가 보존된다.
- 유지: `CREATE_NOTE`/`UPDATE_NOTE`/`CREATE_DESIGN_SPEC`/`EDIT_DESIGN_SPEC`의 기존 JSON/markdown parser는 그대로 둔다. 이번 변경은 mockup/reference action의 bracket payload 절단만 고친다.

### 15.247 Stitch OAuth-preferred visibility experiment `[implemented 2026-07-14]`

- 배경: 실제 Stitch `screenId`가 생성되고 HTML도 반환되지만 공식 Stitch 웹에는 해당 project가 보이지 않는 사례가 있었다. 이 로그는 `openai-asset-fallback-*`가 아니라 실제 Stitch screen 생성이므로 fallback 문제가 아니라 auth/workspace visibility 문제일 가능성이 높다.
- 수정: `src/lib/server/stitch-auth.ts`에 `STITCH_AUTH_PREFERENCE=oauth` 실험 플래그를 추가했다. 기본값은 기존처럼 API key 우선이고, 이 플래그가 `oauth`면 refresh-token OAuth, ADC user OAuth, static access token을 API key보다 먼저 시도한다.
- 의도: 같은 생성 요청을 API key mode와 OAuth-preferred mode로 비교해, OAuth user workspace로 만든 project가 공식 Stitch 웹에 다시 보이는지 확인한다.
- 유지: `forceApiKey` 옵션은 계속 API key를 강제한다. OAuth 설정이 없거나 refresh가 실패하면 일반 요청은 API key fallback으로 내려갈 수 있다. 배포 기본값은 여전히 API key 우선이다.

### 15.248 Stitch edit diagnostics and deterministic fallbacks `[implemented 2026-07-14]`

- 배경(Notion `Stitch Edit`, `stitch 선택요소 수정 실패`): OAuth 경로보다 더 큰 문제는 실제 Stitch screen에서도 `edit_screens`가 text-only 응답을 반환하고 HTML이 바뀌지 않는 점이다. 새 로그에는 SDK 타입에 없는 `sessionEvent` component가 보여, live Stitch backend와 SDK schema drift 가능성을 확인할 필요가 생겼다.
- 진단: `/api/stitch`의 `edit_screens` raw response summary가 `sessionEvent` payload 일부를 함께 남긴다. `STITCH_LOG_TOOL_SCHEMAS=1`을 켜면 첫 edit 요청에서 live `edit_screens`, `list_screens`, `generate_screen_from_text` schema를 한 번 덤프해 SDK bundled schema와 비교할 수 있다.
- fallback: 클라이언트의 `stitch-edit-unchanged` 처리에서 기존 선택 요소 삭제/제거뿐 아니라 흰색/검정 텍스트 색, sans/serif 폰트, 이미지 cover/contain 요청도 deterministic local patch로 처리한다. 패치가 적용되면 artboard는 `local-edit-fallback-*` synthetic id로 전환되어 이후 Stitch 원본 screen을 다시 edit 대상으로 보내지 않는다.
- asset 보존: OpenAI asset HTML fallback은 모델에게 긴 Firebase/Storage URL을 직접 복사시키지 않고 `{{ASSET_N}}` token을 `img src`에 넣게 한 뒤, 서버가 응답 HTML에서 token을 실제 asset URL로 치환한다. URL encoding이나 query token 변형으로 coverage가 실패하는 경로를 줄이기 위함이다.
- 유지: 기본 Stitch auth는 여전히 API key 우선이다. OAuth preferred mode는 공식 웹 visibility 비교용 실험 플래그로만 남긴다.

### 15.249 Deterministic selected-element edit local-first `[implemented 2026-07-14]`

- 배경: 사용자 로그인 OAuth 경로에서도 Stitch `edit_screens`가 실제 screen mutation을 만들지 않는 사례가 계속 확인됐다. 15.248의 fallback은 60초가량 Stitch no-op을 기다린 뒤에야 작동해 사용자가 보기에는 여전히 edit이 안 되는 흐름이었다.
- 수정: 선택 요소 삭제/제거, 흰색/검정 텍스트 색, sans/serif 폰트, 이미지 cover/contain처럼 기계적으로 안전하게 적용 가능한 edit은 `/api/stitch` 호출 전에 클라이언트가 현재 artboard HTML을 직접 패치한다.
- 결과: 이 범위의 선택 요소 edit은 Stitch backend 상태와 무관하게 즉시 반영된다. 패치된 artboard는 기존과 같이 `local-edit-fallback-*` synthetic id를 사용해 공식 Stitch 원본 screen과 분리한다.
- 유지: 복잡한 레이아웃 재작성이나 copy 변경처럼 deterministic patch로 확정하기 어려운 edit은 기존 Stitch edit 경로를 유지한다.

### 15.250 Stitch screen-instance edit target experiment `[implemented 2026-07-14]`

- 배경: Stitch 웹 UI에서 같은 edit 요청은 실제 HTML을 바꾸지만, SDK/API `edit_screens` 호출은 prompt를 이해했다는 text output만 반환하고 `get_screen` HTML은 바뀌지 않는 사례가 확인됐다. 이는 웹 UI가 source screen id가 아니라 project canvas의 screen instance를 대상으로 edit할 가능성을 시사한다.
- 관찰: SDK bundle에는 `get_project` 응답의 `screenInstances`와 `SelectedScreenInstance` 타입이 있고, `apply_design_system`은 `selectedScreenInstances`를 요구한다. 반면 bundled `edit_screens` schema와 generated `screen.edit()`는 여전히 `selectedScreenIds`만 보낸다.
- 수정: `/api/stitch`에 `STITCH_EDIT_TARGET_MODE=screen-instance` 실험 플래그를 추가했다. 이 모드에서는 edit 전에 `get_project`를 호출해 현재 `screenId`를 `sourceScreen`으로 참조하는 screen instance를 찾고, `edit_screens` payload에 기존 `selectedScreenIds`와 함께 `selectedScreenInstances`를 추가한다.
- 안전장치: live server가 `selectedScreenInstances`를 `invalid argument`로 거부하면 기존 `selectedScreenIds` payload로 자동 재시도한다. instance lookup 결과와 target mode는 서버 로그로 남긴다.
- 의도: Stitch 웹 UI가 사용하는 canvas instance 기반 edit 경로와 SDK/API 호출의 차이를 검증한다. 성공하면 복잡한 edit도 local fallback 없이 Stitch 쪽 mutation으로 회복할 수 있다.

### 15.251 Stitch auth diagnostics and api-key-only mode `[implemented 2026-07-14]`

- 배경: 로그에는 `api-key`로 보이지만 실제 동작은 사용자 OAuth 경로처럼 느껴진다는 의심이 있었다. SDK constructor는 `inputConfig`와 env를 섞어 `accessToken`도 config에 넣을 수 있지만, auth header builder는 `apiKey`가 있으면 `Authorization`보다 `X-Goog-Api-Key`를 우선한다.
- 수정: `createStitchClient()` 로그를 `auth diagnostics`로 확장해 선택된 mode, preference, requireOAuth/forceApiKey 요청 여부, 관련 env 존재 여부, SDK config에 apiKey/accessToken/projectId가 들어갔는지, 실제 effective header가 `X-Goog-Api-Key`인지 `Authorization`인지 비밀값 없이 출력한다.
- 수정: `STITCH_AUTH_PREFERENCE=api-key-only`를 추가했다. 이 값이면 API key가 없을 때 OAuth fallback으로 내려가지 않고 즉시 설정 오류를 낸다.
- 의도: OAuth 경로가 edit no-op에 영향을 주는지 비교할 때 `api-key-only`와 `oauth`를 명확히 분리해 테스트한다.

### 15.252 Per-artboard Stitch project ownership `[implemented 2026-07-14]`

- 배경: 실제 웹에서 기존 목업 수정 시 `Existing mockup edit failed: Tool Call Failed [edit_screens]: Requested entity was not found`가 발생했다. 이는 prompt/no-op 문제가 아니라, edit 요청의 `screenId`가 현재 전달한 `projectId` 안에서 발견되지 않을 때 나는 오류에 가깝다.
- 원인: 클라이언트는 각 artboard에 `stitchScreenId`만 저장하고 `stitchProjectId`는 세션 전역 상태 하나만 들고 있었다. 이후 다른 생성이 새 Stitch project를 만들면 전역 projectId가 바뀌고, 예전 artboard 편집 시 예전 screenId + 최신 projectId 조합이 `/api/stitch`로 전송될 수 있었다.
- 수정: `Artboard`에 `stitchProjectId`를 추가하고, 생성/편집/HTML pending 재조회 결과에 response projectId를 저장한다. 기존 세션 로딩 시에는 artboard-level 값이 없으면 session-level `stitchProjectId`로 보강한다.
- 수정: 기존 artboard 편집 요청은 `editTargetBoard.stitchProjectId`를 우선 사용하고, 없을 때만 session-level projectId로 fallback한다. `stitch-screen-not-found` 서버 응답 코드를 추가해 같은 문제가 다시 나면 project-screen mismatch로 바로 분류할 수 있게 했다.
- fallback: deterministic selected-element edit은 Stitch가 screen not found를 반환해도 기존 local patch 경로로 처리할 수 있다. 복잡한 edit은 여전히 올바른 projectId/screenId 조합이 필요하다.

### 15.253 Stitch generation stale project recovery `[implemented 2026-07-14]`

- 배경: 배포 웹에서 신규 목업 생성도 `Tool Call Failed [generate_screen_from_text]: Requested entity was not found`로 실패했다. 15.252는 edit 대상 artboard의 project-screen mismatch를 고쳤지만, 신규 생성은 여전히 session-level `stitchProjectId`를 재사용하므로 stale project가 남아 있으면 generate 단계에서도 같은 not found가 날 수 있었다.
- 수정: `/api/stitch` 신규 text generation이 not found를 받으면 stale project로 보고 새 Stitch project를 생성한 뒤 같은 prompt로 한 번 재시도한다.
- 수정: 새 project로 갈아탈 때 기존 `designSystemId`와 applied hash를 버리고, 현재 design style content가 있으면 새 project에 design system을 다시 적용한다. 성공 응답의 새 projectId/designSystemId가 클라이언트 상태로 돌아가 이후 요청 기준이 된다.
- 수정: asset-led URL text generation도 not found면 같은 fresh project retry를 한 번 수행하고, 그 재시도에서 invalid argument가 나면 기존처럼 OpenAI direct HTML fallback으로 내려간다.
- 의도: 과거 세션에 남은 projectId, credential 변경, workspace/project visibility 변경 때문에 신규 생성이 막히지 않게 한다. 복잡한 edit의 no-op 문제와는 별도 복구 경로다.

### 15.254 Korean alias action parsing balanced scan `[implemented 2026-07-14]`

- 배경: 15.246이 canonical `GENERATE_MOCKUP`/`EDIT_MOCKUP`/`FETCH_REFERENCES` 블록의 표시와 실행 추출을 bracket-balanced scanner로 바꿨지만, `normalizeActionBlockAliases`의 한국어 별칭 정규화(`[목업 수정: ...]`, `[수정 요청: ...]`, `[목업 생성: ...]`, `[생성 요청: ...]`, `[레퍼런스 검색: ...]`)는 첫 닫는 대괄호에서 payload를 끝내는 legacy regex로 남아 있었다. 별칭 payload에 XPath `[n]` 인덱스나 CSS arbitrary class가 들어오면 canonical tag 변환이 payload 중간에서 잘리고 잔여물이 본문에 남는 동일한 실패가 재발할 수 있었다.
- 수정: `replaceBalancedAliasBlocks` helper를 추가했다. opener regex로 `[별칭:`까지만 찾고, 그 뒤는 대괄호 depth 스캔으로 균형 닫힘 `]`를 찾아 payload 전체를 canonical tag로 옮긴다. 닫힘이 아직 없는 streaming 중간 상태는 변환하지 않고 그대로 둔다.
- 수정: payload 없는 별칭(`[목업 수정 요청]`, `[레퍼런스 검색]`)과 bare line 레퍼런스 별칭은 payload 절단 위험이 없으므로 기존 regex 경로를 유지한다. 레퍼런스 별칭은 payload형(균형 스캔)과 bare형(regex)으로 분리했고, 빈 payload는 기존처럼 `[FETCH_REFERENCES]`로 수렴한다.
- 검증: 컴파일한 `chat-content.ts` 단독 모듈에 대해 0714 로그의 XPath 포함 edit payload, 별칭+XPath, streaming 부분 블록, 레퍼런스 별칭 4형, 다중 블록 시나리오 17건을 실행해 payload 무절단과 잔여물 미노출을 확인했다.

### 15.255 LLM element-scoped local edit primary path `[implemented 2026-07-14]`

- 배경: 0714 진단으로 확인된 편집 실패 모드가 셋이다. synthetic artboard(`openai-asset-fallback-*`/`local-edit-fallback-*`)는 Stitch edit 대상이 없어 편집이 신규 생성으로 둔갑했고, 실제 Stitch screen도 `edit_screens`가 text-only 응답 후 HTML을 persist하지 않는 no-op이 재현됐으며(2분/5분 지연 재조회로 지연 persist 배제), edit이 성공해도 in-place가 아니라 새 screen id로 반환될 수 있다. 15.249의 deterministic patch는 삭제/흑백 텍스트 색/sans-serif/이미지 fit만 커버해 임의 색상, 문구, 크기, 그라데이션 같은 요청은 여전히 Stitch no-op에 노출됐다.
- 수정: `/api/mockup/local-edit` route를 추가했다. 입력은 사용자 원문, 모델이 재작성한 영어 edit 지시문, 선택 요소 selector/outerHTML(선택 마커 제거), device, 디자인 스타일 컨텍스트이고, OpenAI(`OPENAI_LOCAL_EDIT_MODEL`, 기본 gpt-5.4-mini)가 교체 outerHTML만 반환한다. 서버는 markdown fence 제거, script 태그 제거, 비HTML 출력 502, 무변경 출력 409(`local-edit-unchanged`), 40000자 초과 요소 413(`local-edit-element-too-large`)으로 검증한다. img src는 명시적 교체 요청이 없는 한 보존하라는 계약을 prompt에 포함한다.
- 수정: 클라이언트 편집 흐름에서 deterministic patch가 적용되지 않은 선택 요소 편집은 Stitch 호출 전에 이 local edit을 기본 경로로 호출한다. 성공 시 `replaceSelectedElementInHtml`이 XPath 우선, selector+outerHTML 매칭 fallback으로 해당 node만 치환하고, artboard는 기존 계약대로 `local-edit-fallback-*` synthetic id로 전환한다. script 포함 응답과 비HTML 응답은 클라이언트에서도 거부한다.
- 실패 처리: local edit 실패 시 실제 Stitch screen은 기존 Stitch edit 경로로 fallback한다. synthetic artboard는 `/api/stitch`로 내려가면 편집이 아니라 신규 생성이 되므로 호출하지 않고 실패 메시지로 종료한다(15.256에서 남은 non-selected-element 편집 경로 차단 예정).
- 검증: dev 서버에서 0714 실패 케이스(세리프 헤드라인 sans 변경), 문구+그라데이션 변경, Firebase asset URL 포함 카드의 radius/shadow 변경을 실제 호출해 교체 HTML 반환과 img src byte-exact 보존을 확인했다. 클라이언트 치환 helper는 브라우저에서 XPath 매칭, selector fallback, doctype/sibling 보존, 선택 마커 제거, script/비HTML 거부, 대상 미발견 null 등 9개 시나리오를 통과했다.

### 15.256 Synthetic artboard whole-edit local routing `[implemented 2026-07-14]`

- 배경: 0714 로그에서 synthetic artboard(`openai-asset-fallback-*`/`local-edit-fallback-*`)의 편집 요청이 screenId 없이 `/api/stitch`로 나가 새 Stitch project 생성 + generate 경로로 둔갑했다. 사용자는 기존 목업의 국소 수정을 기대했지만 실제로는 화면 전체가 재해석된 신규 screen으로 교체됐고, 시도마다 고아 project와 design system이 하나씩 쌓였다. 15.255가 선택 요소 편집 경로는 가드했지만 선택 요소 없는 전체 편집은 여전히 열려 있었다.
- 수정: `/api/mockup/local-edit`에 document 모드를 추가했다. `element` 대신 `html`(전체 문서)을 받으면 전체 HTML 문서를 편집해 완성 문서만 반환한다. element 모드와 달리 문서가 렌더에 필요로 하는 기존 script/link 태그(Tailwind CDN 등)는 유지하고, img src 보존과 무관 부분 불변 계약은 동일하다. 150000자 초과 413, 비HTML 502, 무변경 409 검증을 두고 maxDuration은 120초로 올렸다.
- 수정: 클라이언트 편집 흐름에서 `!isNew`이고 edit 대상 artboard의 screen id가 synthetic이면(선택 요소 케이스는 15.255에서 이미 종결) document 모드 local edit을 호출하고, 성공 시 artboard HTML 교체와 `local-edit-fallback-*` id 회전, 실패 시 실패 메시지로 종료한다. 성공/실패 어느 쪽도 `/api/stitch`로 내려가지 않으므로 synthetic artboard 편집이 신규 생성으로 둔갑하는 경로가 닫혔다.
- 수정: Stitch progress 추정 타이머(Stitch에 요청 전달 중 등 라벨)를 실제 `/api/stitch` fetch 직전으로 옮겼다. 로컬 편집 경로는 자체 라벨(선택 요소 수정 적용 중, 목업 수정 반영 중)만 표시하고 Stitch 라벨로 덮이지 않는다.
- 검증: dev 서버에서 24개 Firebase asset img를 포함한 11KB 문서에 라이트 테마 전환 요청을 실제 호출해 20초 내 응답, 완전한 문서 구조, Tailwind CDN script 유지, 24개 img src byte-exact 보존, 카피/푸터 불변, body/h1 테마 변경 적용을 확인했다.

### 15.257 sessionEvent dom_operations harvest `[implemented 2026-07-14]`

- 배경: 0714 asset-led repair 로그에서 edit_screens raw response의 sessionEvent 전문이 처음 확보됐다. eventPayload.dom_operations에 replace_element action, CSS selector, 교체 content(정확한 mission asset URL 포함), verified_html_context가 그대로 들어 있었다. 즉 현행 Stitch edit 백엔드는 편집을 screen 리소스 HTML에 persist하지 않고 DOM patch operation 스트림으로 발행하며, 웹 UI가 이를 canvas에 적용한다. get_screen 재조회가 20초, 2분, 5분 후에도 동일 hash였던 no-op 미스터리의 최종 원인이다.
- 수정: src/lib/server/stitchDomOperations.ts를 추가했다. extractStitchDomOperations는 raw response의 sessionEvent(JSON string 또는 object)에서 dom_operations를 파싱하고, applyStitchDomOperations는 cheerio로 replace_element, remove_element, set_attribute, replace_content/set_content, add_class/remove_class를 적용한다. selector 미매칭과 미지원 action은 throw하지 않고 failure로 집계해 부분 적용을 허용한다.
- 수정: editScreen이 raw response에서 design screen을 얻지 못하면 list_screens 기반 recovery 이전에 dom_operations를 먼저 수확한다. 현재 screen HTML을 읽어 ops를 적용하고, 1개 이상 적용되어 HTML이 바뀌면 htmlMaterialized flag가 있는 handle을 반환한다. POST의 edit 분기는 materialized handle이면 stale 재조회(waitForChangedScreenHtml 8회, 약 20초)를 건너뛰고 handle의 HTML을 그대로 쓴다.
- 효과: asset-led repair edit은 design screen 없이 ops만 반환해도 asset URL이 반영된 HTML로 coverage를 통과한다(0714 로그의 payload로 검증 — 이전에는 이 지점에서 OpenAI fallback까지 실패해 3.3분 500이었다). 일반 선택 요소 edit도 Stitch가 ops를 반환하는 한 no-op 409 대신 실제 편집 결과를 받는다.
- 검증: 0714 로그의 sessionEvent payload 원문으로 추출/적용/coverage needle 매칭, 부분 실패 내성, 5개 action 유형, JSON string/object 양형, malformed JSON 무시까지 16개 시나리오 통과. cheerio import 포함 dev 서버 기동과 route 응답 smoke 확인.
- 의존성: cheerio 1.2.0 추가.

### 15.258 Asset token substitution variants and coverage diagnostics `[implemented 2026-07-14]`

- 배경: 15.248의 ASSET_N token 치환에도 OpenAI fallback coverage가 0/2로 실패하는 로그가 재현됐다. 치환 로직은 literal `{{ASSET_N}}`만 찾으므로, 모델이 src 속성 안에서 중괄호를 URL-encode(`%7B%7BASSET_N%7D%7D`)하거나 `{{ ASSET_N }}`처럼 공백을 넣으면 치환이 통째로 빗나간다는 가설이 유력했지만, 실패 시 실제 img src를 보여주는 로그가 없어 확정할 수 없었다.
- 수정: replaceAssetTokens를 regex 기반으로 바꿔 literal, URL-encoded, 공백 변형을 모두 치환한다.
- 수정: logAssetCoverageFailure를 추가해 asset-led first design, repair, OpenAI fallback의 coverage 실패 지점에서 생성 HTML의 img src 목록(최대 20개), asset별 기대 needle, 잔여 placeholder token을 로그로 남긴다. 다음 실패 때 "모델이 asset을 무시"인지 "URL/token 변형"인지 로그만으로 구분할 수 있다.
- 참고: 15.256 이전 계획에 있던 repair edit 생략은 채택하지 않았다. 15.257의 harvest로 repair edit이 실제로 성공하게 되었으므로 생략보다 유지가 맞다.

### 15.259 Mockup edit history in activityLog `[implemented 2026-07-14]`

- 배경: 15.255/15.256/15.257로 편집이 로컬 HTML 덮어쓰기 중심이 되면서, 편집 이전 버전이 어디에도 남지 않게 됐다. 연구 분석에서 시안이 어떤 단계로 변형됐는지 복기할 수 없다. Stitch 웹 동기화는 채택하지 않기로 했으므로(앱 로컬 HTML이 source of truth) 히스토리는 앱 데이터에 남겨야 한다.
- 수정: ActivityLogEvent에 previousHtml을 추가하고, 5개 편집 적용 지점(deterministic pre-Stitch patch, LLM element edit, document edit, stitch-edit-unchanged fallback patch, Stitch edit 결과 적용)이 mockup/update 이벤트에 편집 직전 HTML을 기록한다. 편집 후 버전은 별도로 저장하지 않는다 — 다음 편집 이벤트의 previousHtml 또는 artboard의 현재 html로 체인 복원이 가능해 저장량을 절반으로 줄인다.
- 안전장치: 세션은 messages, artboards, activityLog가 한 Firestore 문서(1MiB 한도)에 저장되므로, src/lib/session/activity-log.ts의 trimActivityLogHtmlForSave가 히스토리 필드 총량이 300k chars를 넘으면 오래된 이벤트부터 previousHtml(필요 시 html도)을 제거하고 previousHtmlTrimmed를 남긴다. 세션 저장이 히스토리 때문에 깨지지 않는 것이 우선이다.
- export: 세션 CSV export에 previous_html 컬럼을 추가했다. 스냅샷/메시지 행은 빈 값이다.
- 검증: trim 헬퍼 단독 컴파일로 예산 미만 무변형, 초과 시 오래된 것부터 제거와 marking, 원본 비변이, html 필드 동시 계산 등 9개 시나리오 통과. typecheck와 eslint 통과.

### 15.260 Memory review questionnaire UI readability `[implemented 2026-07-14]`

- 배경(Notion `메모리 질문지 UI`): Part 1 질문지의 글씨와 배치가 작고 밋밋해, 1번/2번 1-7 Likert 문항을 더 명확하게 읽히는 UI로 바꿔야 했다. 또한 Part 2의 4번 문항 위에서 Part 1의 3번 자유응답을 실제 텍스트로 다시 보여줘야 했다.
- 수정: `MemoryReviewIntroPanel`의 Part 1 카드 padding, 질문 font size, 1-7 숫자 버튼 크기, 척도 label 크기를 키우고 1번/2번 Likert 문항을 왼쪽 열에 세로로 배치했다. 3번 자유응답은 오른쪽 열의 긴 입력 카드로 배치해 척도 문항과 구분했다.
- 수정: `MemoryReviewPanel`에 `introMemoryText` prop을 추가하고, `/main/[missionId]`가 `future_memory_freeform` 답변을 전달한다. Part 2 header 문장에 실제 3번 답변을 따옴표로 넣고 굵게 표시하며, 별도 preview 카드는 두지 않고 본문은 바로 4번 문항부터 시작한다.

### 15.261 Mockup element multi-select (shift/cmd click) `[implemented 2026-07-15]`

- 배경: 선택 요소 편집이 단일 요소만 지원해, 같은 성격의 편집(버튼 두 개 색 통일 등)을 요소마다 반복해야 했다. Stitch `edit_screens` 스키마에는 element/region 파라미터가 없어(15.77) 요소 타겟팅은 전부 prompt 주입이므로, 다중 선택은 API 제약이 아니라 클라이언트의 단일 선택 가정 문제였다.
- 수정: iframe 선택 스크립트(`src/lib/session/mockup-html.ts`)가 shift/cmd/ctrl 클릭을 additive 토글로 처리하고 `additive`/`deselected` 필드를 postMessage에 추가했다. `/main/[missionId]`는 `selectedElements` 배열 state로 전환하고 첫 요소를 기존 단일 경로(`selectedElement`)로 유지한다. additive 선택은 같은 artboard로 한정하며 다른 artboard 클릭 시 선택을 교체한다.
- 수정: 다중 선택 시 Stitch edit prompt는 요소별 target block을 나열하고(`selectedElementsTargetPrompt`), deterministic patch는 전 요소 패치 성공 시에만 로컬 적용한다(`patchSelectedElementsInHtml`, all-or-nothing). `/api/mockup/local-edit`는 `elements` 배열을 받아 요소별 병렬 LLM 호출 후 `replacements` 배열을 반환하고, 다중 선택에서는 개별 요소 무변경을 허용하되 전체 무변경이면 409를 반환한다. 클라이언트는 replacement를 순차 적용하며 하나라도 실패하면 전체를 Stitch fallback으로 넘긴다.
- 수정: `/api/chat`은 `selectedElements` 배열을 받아 요소별 selected-element system 컨텍스트를 주입한다(단일 필드 하위 호환). 메시지는 `citedElement`(첫 요소) + `citedElements`(전체)를 저장하고 chat bubble/CSV export가 전체를 표시한다. 툴바에 선택 개수와 Shift 다중 선택 힌트를 추가하고, 세션 튜토리얼 Mockup 스텝에 Shift(또는 Cmd) 클릭 다중 선택 안내를 넣었다.

### 15.262 Asset-led generation fast paths for hopeless coverage `[implemented 2026-07-15]`

- 배경: asset-led 신규 목업이 예전보다 눈에 띄게 느려졌다. 로그 확인 결과 dev 환경에서는 asset URL이 localhost(`/api/mission-assets`)라 Stitch가 literal URL coverage를 절대 통과할 수 없는데도, generate(수십 초) → repair edit(1-2분+) → OpenAI fallback 순서의 waterfall을 매번 전부 수행하고 있었다. 또한 repair 결과의 img src가 전부 Stitch 자체 CDN(`lh3.googleusercontent.com/aida-public`)으로 대체되는 것이 관측되어, 0 coverage 상태에서 repair가 coverage를 복구한 사례가 없다.
- 수정: `/api/stitch`의 asset-led 분기에 두 가지 fast path를 추가했다. (1) asset URL 중 하나라도 공개적으로 도달 불가능하면(상대경로/localhost/127.x/10.x/192.168.x/172.16-31.x/.local 등, `isPubliclyReachableAssetUrl`) Stitch 클라이언트 생성 전에 바로 OpenAI direct HTML fallback을 생성해 반환한다 — 프로젝트 생성과 디자인 시스템 적용도 건너뛴다. (2) first DESIGN screen의 coverage가 0/N이면 repair edit을 생략하고 바로 OpenAI fallback으로 간다. coverage가 부분적으로 매칭(1 이상)된 경우에만 기존 repair edit 경로를 유지한다.
- 수정: OpenAI fallback 자체도 모델이 asset token을 일부 누락해 coverage에 실패하는 사례(5/7)가 확인되어, 누락 token 목록과 의미를 피드백으로 붙여 한 번 재시도하고 그래도 실패할 때만 500을 반환하도록 했다.
- 계약 유지: fallback synthetic id(`openai-asset-fallback-*`)와 coverage 검사, projectId/designSystemId 처리 계약은 기존 fallback 경로와 동일하다. 프로덕션 공개 URL에서 Stitch가 coverage를 통과하는 사례가 실제로 존재하는지는 이후 로그로 확인해, 없다면 asset-led에서 Stitch 시도 자체를 제거하는 것을 검토한다.

### 15.263 Admin prompt viewer block UI and merged retrieval tab `[implemented 2026-07-15]`

- 배경: 어드민 리뷰 화면에서 Raw prompt 보기와 Retrieval 보기가 별도 버튼/모달로 나뉘어 있었고, raw prompt는 전체 JSON 덤프라 mission/mockupHtml/retrievalMemory 같은 블록 구조를 읽기 어려웠다.
- 수정: `/api/chat`의 `BuiltChatMessage`에 admin 전용 `label` 필드를 추가하고 systemMessages/builtMessages 구성 시 블록 이름(basePrompt, mission, activeIdea, designSpec, mockupHtml, retrievalMemory, citedTexts, selectedElement, citedReferences, referencePreference, mentionedArtifact, requestedCommand, actionInstruction, currentRequest, conversation)을 붙였다. 모델 호출 직전에는 role/content만 남기고 strip해 OpenAI Responses API 스키마와 충돌하지 않는다. label이 붙은 배열이 그대로 review turn의 rawPromptActual/rawPrompt로 저장된다.
- 수정: `PromptViewer`를 블록 카드 UI로 재작성했다. 각 블록은 순번, label 배지(색상 구분), 글자 수와 함께 표시되고 1200자 초과 블록(mockupHtml, basePrompt 등)은 기본 접힘 상태로 시작한다. 전체 JSON, sanitized copy, sanitization, response meta는 하단 details로 이동했다. Retrieval 탭을 같은 모달에 통합하고 기존 `RetrievalLogViewer` 컴포넌트와 별도 모달, chat bubble의 Retrieval 보기 버튼을 제거했다 — assistant bubble에는 기억 보기와 Prompt 보기만 남는다.
- 호환: label이 없는 기존 저장 turn은 role(system/user/assistant) 기준으로 블록을 렌더링하고, 배열이 아닌 형태는 기존 JSON 덤프로 폴백한다.

### 15.264 Chat prompt slimming for explicit command turns `[implemented 2026-07-15]`

- 배경: /목업생성 턴의 raw prompt를 블록 단위로 검토한 결과, mission 블록의 콘텐츠 전문이 activeIdea 브리프의 필수 콘텐츠와 대부분 중복되고, 명시적 composer command 턴에도 recent(12개) 대화 이력이 그대로 들어가며, designSpec에 # 디자인 스타일 헤딩이 두 번 붙는 문제가 있었다.
- 수정: `/api/chat`에서 requestedCommand가 generate_mockup이고 activeIdea description이 있으면 planner 판단과 무관하게 mission을 preview(350자)로 강등한다 — 신규 목업은 클라이언트 buildMockupPrompt가 Stitch prompt에 missionBrief를 별도 주입하므로 chat 모델에는 브리프만으로 충분하다.
- 수정: requestedCommandId가 있는 턴은 conversationHistory를 minimal(4)로 강제한다. 명시적 커맨드는 intent가 확정되어 있어 긴 이력이 출력에 기여하지 않는다.
- 수정: 클라이언트 designSpec 조립 시 스타일 content가 이미 같은 헤딩으로 시작하면 title 헤딩을 중복으로 붙이지 않는다.

### 15.265 Retrieved memory prompt slimming `[implemented 2026-07-15]`

- 배경: chatRetrievedMemoryPrompt가 스키마 서술 위주의 긴 설명 문단(~700자), 기본 지시문과 중복되는 medium relevance 한 줄, 항목마다 그룹명 키를 반복하는 nested JSON({"episodic":[{"episodic":"..."}]})으로 구성되어 턴당 ~1.2K chars의 불필요한 오버헤드가 있었다.
- 수정: 설명 문단을 행동 규칙 핵심(retrieval 선택 증거이며 자동 요구사항 아님 / 도움되는 것만 사용 / 현재 요청 우선 / 언급 없이 반영)만 남기고 축약했다. relevance는 light/strong일 때만 한 줄을 추가하고 medium은 생략한다.
- 수정: compact JSON을 plaintext bullet 목록으로 교체했다. Episodic (past context and outcomes) / Semantic (durable user preferences, constraints, working patterns) 섹션 헤더 아래 - 줄로 나열하고, before-session 항목만 (before-session {scope}, mission: {id}) 접미를 붙인다. chatRetrievedMemoryPrompt는 JSON 문자열 대신 compactMemoryContext 결과 객체를 직접 받는다.
- 유지: retrieval top-k(10), episodic/semantic 각 10개 상한, 500자 절단, id/weight/similarity 제외 계약은 그대로다. 정보량 변화 없이 표현만 압축한 변경이다.

### 15.266 Planner memory directives `[implemented 2026-07-15]`

- 배경: retrieved memory가 executor prompt에 리스트로만 들어가 반영이 소극적일 수 있었다. 별도 distillation LLM 호출은 메모리 토큰을 3중 지불하고 직렬 지연을 추가하므로, 이미 gpt-5.4로 semanticMemories를 받고 있는 planner에 이 판단을 통합했다.
- 수정: planner 출력에 memoryDirectives 필드를 추가했다. semantic memory가 현재 요청과 선택된 intent에 명확히 적용될 때만 최대 2개의 짧은 영어 명령형 지시를 쓰고, 불확실하면 빈 배열을 반환한다. 이전 작업 반복, 현재 요청과의 충돌, 요청 단순 재진술은 금지한다. 파서는 문자열 배열만 수용하고 2개/300자로 절단하며, parse 실패 시 기존 fallback plan이 빈 배열을 갖는다.
- 수정: directive는 retrievalMemory 블록이 아니라 system 스택 후반부(actionInstruction 다음, currentRequest 직전)에 별도 memoryDirectives 블록으로 주입한다 — 이 턴의 행동 지침이 가장 큰 가중치를 받는 위치다. 서문에 현재 요청 우선 원칙을 명시하고, raw memory bullet은 그대로 유지해 잘못된 directive를 executor가 교정할 수 있게 한다. directive가 있으면 retrievalMemory의 light/strong relevance 줄은 생략한다(directive가 대체).
- 관측: directive는 promptPlan에 포함되어 review turn에 저장되고, admin Prompt 보기에서 memoryDirectives 블록으로 표시된다.

### 15.267 Visible action rationale in chat replies `[implemented 2026-07-15]`

- 배경: 목업 생성/브리프 생성 같은 액션 턴의 채팅 텍스트가 의미 없는 확인 문구 수준이라, 무엇을 고려해 그렇게 만들었는지(특히 메모리 반영)가 사용자에게 보이지 않았다. 별도 사전 생성 호출 없이 같은 응답 안에서 근거를 action tag보다 먼저 쓰게 하면 순차 생성 특성상 사전 생성과 동일한 효과가 나고, 가벼운 CoT로 action payload 품질에도 기여한다.
- 수정: chatActionInstructionPrompt에 CHAT_ACTION_RATIONALE_PROMPT를 추가했다. 브리프/목업/디자인 스타일 계열 액션 intent에서 action tag 직전에 1-2문장으로 무엇을 고려해 어떻게 구성했는지(현재 요청, 브리프/스타일 제약, 사용자의 알려진 선호)를 사용자 언어로 쓰게 한다. 선호가 반영된 경우 자연어로 드러내되 메모리/시스템이라는 표현은 금지한다. fetch_references(한 문장 계약)와 일반 answer는 제외.
- 수정: retrievalMemory 서문과 memoryDirectives 블록의 apply silently 지시를 완화했다 — 메모리를 인용하거나 메모리라고 부르는 것은 계속 금지하되, durable preference가 액션 결과를 형성했을 때는 보이는 답변에 그 고려를 자연스럽게 반영하도록 바꿨다. 기존 지시가 15.267의 가시적 근거 요구와 정면 충돌했기 때문이다.

### 15.268 Four-level memory relevance and similarity signals `[implemented 2026-07-15]`

- 배경: planner의 memoryRelevance(light/medium/strong)가 실제 로그에서 9할 medium으로 쏠렸다. medium이 안전한 중간 기본값으로 작동해 신호 가치가 없었고, planner 입력의 similarity signal(high/mid/low 3구간)도 해상도가 낮았다.
- 수정: memoryRelevance를 background/light/relevant/strong 4단계로 재정의했다. 기존 medium을 이름째 없애 중간값 편향을 깨고, planner 프롬프트에 각 레벨의 판정 기준(signal 조합 + 현재 요청과의 실질 관련성)과 중간값으로 도피하지 말라는 지시를 명시했다. 렌더링은 background(무시 수준)/light(tie-breaker)/strong(적극 정렬)만 한 줄을 추가하고 relevant(기본)는 생략한다.
- 수정: memorySimilaritySignal을 low(≤0.39)/mid-low(≤0.44)/mid-high(≤0.48)/high(≥0.48) 4구간으로 나눴다.
- 호환: 파서가 legacy medium을 relevant로 매핑하고, 알 수 없는 값과 parse 실패 기본값도 relevant다. directive 존재 시 relevance 줄 생략 계약(15.266)은 유지된다.

### 15.269 Active-memory soft cap for idle decay `[implemented 2026-07-15]`

- 배경: 기존 idle decay는 memory 수 구간별 multiplier(60/120/200)로 감쇠 폭만 키우는 방식이라 활성 memory 수가 ~100 부근으로 수렴했다. 입력이 늘어도 활성 풀이 함께 완만하게 커지는 형태(200개 입력 시 110-120, 300개 입력 시 120-140)가 필요했다.
- 수정: activeMemoryCap(total) = 100 + 1.8 * sqrt(max(0, total - 100)) 소프트 캡을 도입했다. total 200 → cap 118, total 300 → cap 125로 요구 구간에 들어온다. total은 비활성 포함 전체 입력 수(listFirestoreDocumentIds 길이, MAX_MEMORY_DOCS 절단 이전)다.
- 수정: idle decay는 활성 수가 cap 이하이면 loss 0으로 아예 돌지 않는다(비활성화는 100부터 시작). cap 초과 시 loss가 기본 0.006에서 초과분에 비례해 0.012까지 선형 램프(초과 50개에서 포화)하고, 초과분이 소진되면 자동으로 멈춰 활성 수가 cap 곡선을 따라간다. 구간별 memoryCountDecayMultiplier는 제거했다.
- 로그: retrieval log의 idleDecayMultiplier 필드를 제거하고 totalMemoryCount와 activeMemoryCap을 기록한다(외부 consumer 없음 확인). per-delta decayMultiplier 필드도 제거.

### 15.270 Memory review Part 2 minor copy update `[implemented 2026-07-15]`

- 배경(Notion `메모리 질문지 수정 minor`): Part 2 5번/7번 문항이 사용자가 어떤 저장 방식과 수정 방식을 원하는지 더 직접적으로 묻도록 문구를 보강해야 했다.
- 수정: `MemoryReviewPanel`의 `wrong_or_unnecessary_memory` label에 `어떻게 저장되었어야 하나요?` 괄호 문구를 추가했다.
- 수정: `correction_preference` label을 `이것이 어떤 방식으로 바로잡히기를 원하시나요?`로 바꿔 앞서 답한 수정/추가 필요 사항의 처리 방식을 묻도록 했다.

### 15.271 Reference card screenshot thumbnail fallback `[implemented 2026-07-16]`

- 배경: OpenAI web search 결과 페이지의 og:image만 카드 썸네일로 쓰면, 메타 이미지가 없거나 hotlink/봇 차단/JS 렌더링 때문에 레퍼런스 카드 이미지가 비는 경우가 많았다.
- 수정: `/api/references`의 `hydrateReferenceMetadata()`가 검색 결과 `imageUrl`을 먼저 보고, 페이지 HTML에서 og/twitter/link image_src/json-ld/image 태그 후보를 Cheerio로 수집한다. 각 후보는 서버 fetch로 image content-type을 검증한 뒤에만 카드 `imageUrl`로 사용한다.
- 수정: 유효한 이미지 후보가 없거나 페이지 HTML fetch가 실패하면 Microlink screenshot URL을 desktop viewport로 생성해 `imageUrl` fallback으로 넣는다. 카드/세션 저장량 보호를 위해 레퍼런스 카드에는 base64 data URL이 아니라 캡처 이미지 URL만 저장한다.
- 정리: 기존 Stitch URL screenshot 로직을 `src/lib/server/urlScreenshot.ts`로 공용화했다. Stitch 이미지 주도 생성은 계속 data URL을 필요로 하므로 `captureUrlScreenshotDataUrl()`을 사용하고, 레퍼런스 카드는 `getUrlScreenshotUrl()`만 사용한다.

### 15.272 Reference thumbnail strategy by search mode `[implemented 2026-07-16]`

- 배경: 레퍼런스 카드 썸네일은 검색 의도에 따라 달라야 한다. 실제 제품/페이지 구조 참고에서는 og 이미지보다 live screenshot이 유용하고, 비주얼 스타일 참고에서는 screenshot보다 대표 이미지/OG 이미지가 더 유용한 경우가 많다.
- 수정: `/api/references`가 `referenceMode`에 따라 `ThumbnailStrategy`를 고른다. `product` 모드는 `screenshot-first`, `style` 모드는 `image-first`다.
- 동작: `screenshot-first`는 Microlink desktop screenshot URL을 먼저 생성·검증하고 실패하면 검색 결과/페이지 이미지 후보로 폴백한다. `image-first`는 검증된 페이지 이미지 후보를 먼저 쓰고 실패하면 screenshot으로 폴백한다.

### 15.273 User chat bubble sent time on hover `[implemented 2026-07-16]`

- 배경: 사용자가 보낸 채팅을 훑을 때 각 메시지의 전송 시각을 필요할 때만 확인할 수 있어야 했다.
- 수정: `ChatBubbleMessage`에 기존 session `Message.createdAt`을 노출하고, user bubble wrapper를 hover/focus group으로 바꿔 버블 아래 absolute label에 `Jul 21, 09:32 AM` 형식의 시간을 표시한다. 기본 상태에서는 opacity 0이라 채팅 간격을 늘리지 않는다.

### 15.274 Stitch image-led reference observability `[implemented 2026-07-16]`

- 배경: Stitch 웹에 앱 작업 내역이 보이지 않는 경우, 사용자가 직접 넣은 이미지나 서버가 캡처한 URL screenshot이 실제로 Stitch 입력으로 들어갔는지 앱 안에서 확인하기 어려웠다.
- 수정: `/api/stitch`의 image-led 경로가 Stitch 업로드용으로 정규화한 style image에서 preview data URL, sha256 hash, byte length, mime을 만들고, `project.upload()`가 반환한 reference screen id와 함께 로그에 남긴다.
- 수정: `/api/stitch` 응답에 `styleReferenceInput`을 추가했다. URL screenshot 경로일 때 클라이언트가 assistant bubble에 `Stitch에 전달한 캡처 이미지` preview, source URL, reference screen id를 표시한다. 직접 첨부 이미지는 기존 user bubble의 `styleImage` preview를 source of truth로 사용한다.

### 15.275 Shared image preview dialog for chat and mission images `[implemented 2026-07-16]`

- 배경: Stitch 입력 확인용 이미지와 사용자 첨부 이미지를 작은 preview뿐 아니라 modal에서 크게 확인해야 했다. 기존 미션 이미지 확대 Dialog 패턴을 중복하지 않고 재사용 가능한 컴포넌트로 정리한다.
- 수정: `ImagePreviewDialog`를 추가하고 기존 `MissionBriefSection`의 콘텐츠 이미지 확대 Dialog를 이 컴포넌트로 교체했다. `ChatBubble`의 사용자 첨부 이미지와 `Stitch에 전달한 캡처 이미지` preview는 클릭 시 같은 Dialog로 크게 열린다.

### 15.276 Attached style image awareness in chat planning `[implemented 2026-07-16]`

- 배경: 사용자가 채팅 input에 참고 이미지를 첨부하고 "이번엔 이런 느낌으로 만들어봐"라고 보냈는데 assistant가 "레퍼런스가 아직 안 보여요"라고 답한 사례가 있었다. 로그에는 해당 턴의 `/api/stitch` 호출이 없었으므로, Stitch에 이미지가 전달된 뒤 실패한 것이 아니라 `/api/chat` 판단 단계에서 이미지 첨부 사실을 몰라 생성 액션으로 가지 못한 문제였다.
- 원인: 클라이언트 `Message`에는 `styleImage`가 저장되어 user bubble에는 preview가 보였지만, `/api/chat` 요청의 `messages` 배열은 role/content만 전송했다. 실제 이미지 data URL은 이후 `[GENERATE_MOCKUP]`이 나온 뒤 `/api/stitch`에만 보내는 구조라, 채팅 planner/executor는 최신 턴의 이미지 존재를 알 수 없었다.
- 수정: 클라이언트가 `/api/chat`에 `styleImageContext`(present, name)만 추가로 보낸다. data URL 자체는 계속 `/api/stitch` 전용으로 유지해 prompt/token과 로그에 base64가 섞이지 않게 했다. `/api/chat`은 이 메타를 planner input의 `uiState.hasAttachedStyleImage`와 `styleImageContext` system block에 넣고, 수신 시 `[api/chat] attached style image context` 로그를 남긴다.
- 수정: planner/action prompt와 `forceIntentFromUserText`에 attached style image 규칙을 추가했다. 첨부 이미지가 있고 active design brief가 있는 상태에서 사용자가 "이런 느낌", "이번엔 이런 느낌", "this feeling" 등으로 만들기/생성 요청을 하면 레퍼런스를 다시 요구하지 않고 image-led `create_mockup`으로 라우팅한다. 클라이언트의 style reference fork 판단도 attached image 여부를 받아 같은 표현을 새 스타일 방향으로 해석한다.

### 15.277 User-controlled memory activation in review `[implemented 2026-07-16]`

- 배경(Notion `39fd5dc81f66804bb64cd8eb6ca71f8f`): 자동 duplicate archive와 idle decay weight 0만 있던 inactive memory에 사용자가 직접 비활성화하는 원인을 추가하고, inactive memory를 다시 활성화할 수 있어야 했다. 상태 설정 질문은 Part 2의 4번과 기존 5번 사이에 위치해야 한다.
- API: `PATCH /api/memory/active-state`는 본인 memory만 변경한다. 비활성화는 자유 입력 reason을 필수로 검증하고 weight 0, `inactiveReason: user_disabled`, `inactiveReasonDetail`, `inactiveAt`을 저장한다. 활성화는 weight를 0.5로 복구하고 archived/manual inactive marker를 해제한다.
- UI: `MemoryReviewPanel`에 상태 확인 문항을 삽입하고, review detail card의 선택된 memory에 비활성화 또는 활성화 command를 노출한다. 비활성화는 이유 입력 Dialog를 거치며, 성공하면 현재 summary state와 archive status를 즉시 갱신한다. Admin viewAs는 read-only라 상태 command를 제공하지 않는다.
- graph: inactive memory는 snapshot의 기존 cluster itemIds에 남아 있어도 base similarity cluster와 edge에서 제외하고 `session-inactive` pseudo-group으로 이동한다. pseudo-group은 cluster list에서 숨기므로 cluster 수에 포함되지 않으며, graph toggle로 node를 표시하거나 숨길 수 있다.

### 15.278 Refresh after-snapshot after memory reactivation `[implemented 2026-07-16]`

- 문제: inactive 상태로 after snapshot에서 제외된 memory를 활성화하면 weight와 node는 복구되지만 저장된 cluster membership에는 해당 id가 없어, 사용자가 어느 cluster에 묶였는지 확인할 수 없었다.
- 수정: session cluster 생성 helper와 `POST /api/memory/session-clusters`가 선택적 phases를 받도록 확장했다. 기존 세션 종료 흐름은 before/after를 모두 생성하고, memory 재활성화 흐름은 `phases: [after]`만 보내 historical before snapshot을 보존한다.
- UI: 활성 상태 저장 후 after snapshot 생성과 session summary 재조회까지 기다린다. 새 snapshot에서 활성화된 memory를 포함하는 cluster를 찾아 자동 선택하며, snapshot 생성 또는 membership 확인에 실패하면 memory 활성화는 유지하되 별도 warning toast를 표시한다.

### 15.279 Inactive-memory toggle in cluster list `[implemented 2026-07-16]`

- 배경: inactive memory 표시는 cluster membership의 보조 필터인데 graph canvas 위에 floating control로 놓여 graph 조작 도구처럼 보이고 node 영역과 경쟁했다.
- 수정: graph overlay의 inactive toggle을 제거하고 `MemoryClusterList` 하단의 cluster 목록과 구분된 보조 행으로 이동했다. 실제 cluster 배열과 count에는 계속 포함하지 않는다.
- 접힘 상태: review cluster list rail을 접어도 하단 eye icon과 inactive count badge를 유지해 표시 상태를 바꿀 수 있다.

### 15.280 Select inactive pseudo-group from cluster list `[implemented 2026-07-16]`

- 문제: cluster list 하단의 inactive 행 전체가 node visibility toggle로만 동작해, 눌러도 detail panel이 inactive memory 목록으로 전환되지 않았다.
- 수정: inactive 보조 행의 본문과 eye icon 역할을 분리했다. 본문을 누르면 `session-inactive` pseudo-group을 선택하고 node 표시를 켜며 detail panel에 inactive memory들을 보여준다. Eye icon은 graph node 표시만 독립적으로 토글한다.
- 접힘 상태: rail에서는 inactive group 선택 button과 eye toggle을 세로로 유지하고 count badge는 group 선택 button에 표시한다.

### 15.281 Keep the empty inactive-memory group visible `[implemented 2026-07-16]`

- 배경: inactive memory가 0개일 때 보조 행 전체가 사라져 cluster list의 정보 구조가 상태에 따라 바뀌고, 현재 inactive memory가 없다는 사실도 바로 확인하기 어려웠다.
- 수정: cluster list 하단의 inactive 보조 행과 pseudo-group을 항상 유지해 count 0을 표시한다. 빈 그룹을 선택하면 detail panel에 비활성 메모리가 없다는 empty state를 보여주고, node visibility eye control은 0개일 때 비활성화한다.

### 15.282 Preserve inactive node styling across review phases `[implemented 2026-07-16]`

- 문제: manual inactive memory를 세션 이전 phase에서 표시하면 historical weightBefore가 양수로 치환되어 graph renderer의 inactive 판정이 풀렸다. 이때 session-inactive pseudo-group이 cluster palette에서 받은 fallback 색상, 예를 들어 다섯 번째 슬롯의 red가 node fill로 노출될 수 있었다.
- 수정: graph item에 현재 inactive 상태를 phase weight와 별도로 전달하고 renderer와 detail panel이 이를 우선 판정한다. 세션 이전과 이후 모두 inactive node는 slate-300 fill과 inactive opacity를 유지한다.

### 15.283 Start active-memory soft-cap decay at 70 inputs `[implemented 2026-07-16]`

- 배경(Notion `weight-39ed5dc81f66805e92f2f1cd95eafd47`): 기존 soft cap은 전체 입력 100개까지 idle decay를 실행하지 않아 망각 시작 시점이 늦었다. 망각은 70개부터 시작하되 입력 100개에서 80~90개, 200개에서 110~120개, 300개에서 120~140개 정도의 active memory를 유지해야 한다.
- 수정: total 70개까지 cap 70, 70~100개 구간은 cap 70→85 선형 증가, 100개 이후는 그 지점에서 이어지는 square-root curve로 변경했다. 정수 cap은 floor 처리해 total 71부터 active count가 cap을 초과할 수 있다.
- 예상값: total 70 → cap 70, total 100 → cap 85, total 200 → cap 114, total 300 → cap 133. 기존 idle decay loss 0.006~0.012와 초과분 50개 ramp는 유지한다.

### 15.284 Cluster-aware hybrid memory retrieval `[implemented 2026-07-16]`

- 배경(Notion `39ed5dc81f668035929fc18cbe5e35e1`): 기존 retrieval은 cluster cache를 top 10 선택 후 label/summary metadata를 붙이는 데만 사용해 실제 검색 순위에는 반영하지 않았다. 추가 LLM 호출 없이 저장된 cluster를 이용해 thematic context를 보강해야 했다.
- ranking: 모든 active memory의 global cosine similarity를 계산한 뒤 cluster별 evidence를 `0.7 * max similarity + 0.3 * top 3 mean similarity`로 계산한다. 각 memory score는 individual similarity에서 cluster evidence 방향으로 20%까지만 상향하고, cluster evidence가 더 낮으면 기존 similarity를 깎지 않는다.
- 안전장치: global cosine top 2는 최종 top 10에 반드시 보존한다. Cluster cache가 없거나 현재 active candidate가 2개 이상 속한 cluster가 없거나 cluster assignment coverage가 50% 미만이면 global cosine ranking으로 fallback한다. Ranking에는 itemIds membership과 embedding similarity만 사용하고 cluster label/summary 및 LLM call은 사용하지 않는다.
- decay/log: final retrieved ID를 제외한 모든 active candidate만 idle decay 대상으로 삼는다. Retrieval log에 ranking method, global top IDs, hybrid retrieval scores, cluster별 evidence score와 assigned candidate count를 기록해 기존 cosine 결과와 차이를 사후 비교할 수 있게 한다.

### 15.285 Per-user Stitch API key groups `[implemented 2026-07-16]`

- 배경: 서로 다른 Stitch 계정에서 발급한 두 API key로 사용자를 나눠 계정별 quota와 작업을 분리하고, 관리자가 각 사용자의 배정을 확인할 수 있어야 했다.
- 배정: 사용자 프로필의 `stitchApiGroup` A/B를 source of truth로 사용한다. 값이 없는 사용자는 UID SHA-256 첫 byte의 짝홀로 안정적인 약 50:50 그룹을 계산하고, 최초 Stitch 요청 때 `stitchApiGroupAssignedAt`과 함께 프로필에 저장한다.
- 라우팅: `/api/stitch`와 `/api/stitch/html`은 Firebase ID token을 검증한 뒤 대상 사용자의 그룹에 맞는 `STITCH_API_KEY_A` 또는 `STITCH_API_KEY_B`를 서버에서만 선택한다. 일반 사용자는 자기 UID만 요청할 수 있고, admin viewAs만 다른 owner UID를 지정할 수 있다. 생성과 HTML 조회가 다른 Stitch 계정으로 갈라지지 않도록 두 route와 asset-led API-key fallback이 같은 그룹 키를 사용한다.
- 관리자 확인: 사용자 목록 카드와 미션 참여자 목록에 `Stitch A` 또는 `Stitch B` badge를 표시한다. 아직 프로필에 배정값이 저장되지 않은 사용자도 서버와 동일한 UID 규칙으로 예상 그룹을 표시한다. API 응답과 auth diagnostics에는 group label과 키 설정 여부만 포함하고 실제 키 값은 노출하지 않는다.

### 15.286 Read-only inactive memory group on Agent page `[implemented 2026-07-16]`

- 배경: 세션 리뷰에서는 cluster list 하단에서 inactive memory를 별도 pseudo-group으로 확인할 수 있지만 `/agent`와 이를 공유하는 admin 사용자 memory page에서는 inactive 문서를 아예 읽지 않아 같은 관측 UI가 없었다.
- API: `/api/memory/all`과 `/api/admin/users/[uid]/memory`가 `includeInactive=1` 요청에서만 archived 및 weight 0 memory를 포함한다. 기본 요청은 계속 active memory만 반환해 기존 admin table 등 다른 consumer의 동작을 유지한다.
- UI: `/agent`의 세션 누적 필터 안에서 inactive memory를 실제 cluster itemIds와 edge에서 제외하고 `session-inactive` pseudo-group으로 만든다. Cluster list 하단 행은 0개여도 유지하고, 행 선택 시 detail panel로 전환하며 eye icon으로 inactive graph node를 표시하거나 숨긴다. 일반 cluster count에는 포함하지 않는다.
- 읽기 전용: `/agent`와 `/admin/users/[uid]/memory`의 `MemoryClusterSidePanel`에는 `onSetMemoryActive`를 전달하지 않는다. 따라서 inactive 이유와 상세는 볼 수 있지만 활성화 또는 비활성화 버튼은 렌더링되지 않는다.

### 15.287 Move memory activity question to slot 8 in Part 2 review `[implemented 2026-07-17]`

- 배경: memory 상태 확인 문항(memory_activity_review)이 4번 직후(5번)에 있어 서술형 확인 문항들보다 먼저 나왔다. 서술형 확인을 모두 마친 뒤 상태를 조정하도록 순서를 바꾼다.
- 변경: `src/components/memory/memory-review-panel.tsx`의 `REVIEW_QUESTIONS` 배열에서 memory_activity_review를 correction_preference 뒤, overall_memory_accuracy 앞으로 이동. 결과 순서는 4 기대대로 기억, 5 잘못 기억, 6 빠진 정보, 7 수정 방식, 8 memory 상태 설정, 9 정확성 rating, 10 새로 알게 된 점.
- 문항 번호는 배열 index에서 파생되므로 배열 이동만으로 번호가 갱신된다. 문항 id와 저장 스키마는 변경 없음.

### 15.288 Retry transient Firestore reads and surface memory load errors `[implemented 2026-07-17]`

- 증상: admin 사용자 메모리 페이지(또는 /agent)가 간헐적으로 0개 클러스터 + 노드만 표시. 조사 결과 두 cluster GET route는 코드가 동일하고 Firestore 캐시도 정상이었으며, dev 서버의 route cold compile 직후 요청에서 간헐 500이 재현됐다(웜업 후에는 안정).
- 원인 1(서버): cluster GET 한 번이 메모리 문서 수십 개 + 캐시 문서를 개별 REST getFirestoreDocument로 병렬 조회하는데 재시도가 없어, transient 오류 하나로 route 전체가 500이 됐다.
- 원인 2(클라이언트): MemoryClusterPage.loadData가 !ok 응답을 null로 삼켜 실패를 빈 데이터(0개 클러스터)처럼 렌더링했다. 에러 표시도 재시도 수단도 없었다.
- 수정: src/lib/server/firebaseAdminRest.ts에 fetchFirestoreRead(3회, backoff, 429/5xx/네트워크 오류 대상)를 추가해 listFirestoreDocumentIds와 getFirestoreDocument 읽기 경로에 적용. src/app/agent/page.tsx의 loadData는 fetchJsonWithRetry(1회 재시도)로 바꾸고 실패 시 loadError 상태로 다시 시도 버튼이 있는 에러 화면을 표시한다.
- 검증: 실행 중인 dev 서버에 admin ID token으로 self/admin cluster GET을 반복 호출(수정 전 5회 중 2회 500 → 수정 후 cold recompile 강제 포함 30/30 성공).

### 15.289 Cap concurrent Firestore reads and add per-attempt timeout `[implemented 2026-07-17]`

- 증상: 15.288 이후에도 admin이 메모리가 많은 사용자(215개 문서)의 memory를 볼 때 session-summary POST가 36초 걸려 500. 원인은 connect ETIMEDOUT(34.128.x.x:443) — 여러 route가 Promise.all로 문서 수백 개를 무제한 병렬 REST 조회하면서 동시 TLS 연결 폭주로 SYN이 drop됐다. 이 상태에서는 재시도도 같은 폭주 속으로 들어가 소용이 없었다.
- 수정: src/lib/server/firebaseAdminRest.ts의 fetchFirestoreRead에 모든 읽기가 공유하는 semaphore(동시 12개)와 시도당 10초 AbortSignal timeout을 추가. listFirestoreDocumentIds와 getFirestoreDocument를 쓰는 모든 route(메모리 조회, 클러스터, session-summary 등)가 호출부 수정 없이 적용받는다.
- 참고: Next dev는 route별로 모듈을 분리 컴파일하므로 semaphore는 route bundle 단위다. 한 페이지가 route 2개를 동시에 부르면 최대 24개 연결 — 수백 개 무제한 대비 충분히 낮다.
- 검증: 215개 memory 사용자로 admin memory GET + clusters GET 동시 6라운드(12/12 성공, 5~6초), session-summary POST 3회(3/3 성공, ~5.5초).

### 15.290 Raise clustering input cap to 300 `[implemented 2026-07-17]`

- 증상 1: 활성 메모리 207개 사용자의 memory 화면에서 비활성은 8개뿐인데 클러스터에 속하지 않는 회색 노드가 47개 표시됨.
- 증상 2: 같은 사용자의 이전 세션 필터(초기 날짜)를 선택하면 클러스터가 거의 표시되지 않음.
- 원인: 두 증상 모두 memoryClustering.ts의 MAX_ITEMS=160. 클러스터링 입력이 최신순 상위 160개로 잘려 가장 오래된 활성 47개(=초기 세션 메모리: 온보딩 5, 101001 9, 301001 12, 203001 19 전부/대부분)가 어떤 클러스터에도 못 들어갔다. 세션 필터 뷰는 최신 캐시를 필터해 재사용하므로 초기 세션일수록 클러스터 커버리지가 0에 수렴했다. 캐시 stale 문제 아님(캐시 생성 후 신규 메모리 0개 확인).
- 결정: MAX_ITEMS를 300으로 상향. soft-cap decay 곡선(입력 300에서 활성 ~133)대로면 160도 충분하지만, decay 튜닝 이전 참여자(활성 207 관측)를 덮기 위함. 300개 입력도 O(n^2) 유사도 계산과 임베딩 캐시(문서 저장) 기준 비용 문제 없음.
- 검증: 해당 사용자 재생성 후 16 clusters / 695 edges / itemIds 합집합 207 = 활성 전부 포함, 미션별 제외 0개. 다른 사용자는 모두 160 미만이라 영향 없음.

### 15.291 Remove mission create and edit features from admin `[implemented 2026-07-17]`

- 배경: 미션 셋업이 확정되어 관리자 페이지에서 미션을 새로 만들거나 수정할 일이 없어졌다. 관리자 페이지 최적화의 일환으로 제거.
- 제거: /admin 헤더의 새 미션 버튼, 미션 카드의 연필 편집 버튼과 인라인 편집 UI(제목/설명/디바이스/제한시간/콘텐츠/이미지 업로드), 관련 상태와 헬퍼(editingId, editFields, startEdit, saveEdit, updateEditOption, asset 업로드/삭제 헬퍼, normalizeOptions, createEmptyOption, EMPTY_FORM, 콘텐츠 이미지 미리보기 Dialog). 페이지/라우트 삭제: src/app/admin/new, /api/admin/missions, /api/admin/mission-assets.
- 유지: 미션 목록 조회, 참여자 보기, 미션 삭제(X), 온보딩 설정 카드, 조회용 /api/mission-assets(main 세션 썸네일 제공).
- Firestore missions 데이터와 저장된 assetImages는 그대로이며 main 세션에서 계속 사용된다.

### 15.292 Remove admin missions tab entirely `[implemented 2026-07-17]`

- 배경: 15.291로 생성·수정이 빠진 뒤 미션 탭에 남은 것은 목록/삭제/온보딩 제한시간 설정/미션별 참여자 모달뿐이었고, 운영상 필요 없다고 판단해 탭 자체를 제거했다. /admin은 유저 목록 단일 화면이 된다.
- 제거: 유저/미션 Tabs 구조(adminSection), 미션 목록 카드와 미션 삭제(X), 온보딩 설정 카드(제한 시간 저장 UI)와 saveOnboardingSettings, 미션별/온보딩 참여자 모달과 openParticipants, openOnboardingParticipants, hydrateParticipantReviewStatus, requestDeleteUserData, deleteUserData. DestructiveAdminAction은 all-memory 단일 타입으로 축소.
- 유지: missions 컬렉션 로드(onSnapshot)와 missionTitle, onboardingSettings 로드(/api/onboarding GET) — 유저 카드의 미션 제목/제한 시간 표시에 계속 쓰인다. /api/onboarding PATCH 라우트는 남아 있으나 UI 진입점 없음(필요 시 API 직접 호출).
- 세션 열람 view-as와 리뷰 상태 표시는 유저 카드 미션 행에서 계속 제공된다.

### 15.293 Personalize memory page header and badge session counts `[implemented 2026-07-17]`

- MemoryClusterPage 헤더 제목을 전체 메모리 데이터 대신 (사용자 이름)의 메모리로 표시. 이름은 /api/memory/all과 /api/admin/users/[uid]/memory 응답에 추가한 displayName을 사용하고, self 뷰는 auth displayName으로 폴백, admin 뷰는 이름이 없으면 기존 제목 유지.
- 세션 누적 필터 칩의 메모리 개수(전체 포함)를 currentColor 40% 테두리의 rounded-full 배지로 감싸 날짜와 시각적으로 구분.

### 15.294 Fix chat tab count and show raw input on before-session cards `[implemented 2026-07-17]`

- 채팅 탭 뱃지가 messages.length(user+assistant 합산)를 표시해 대화 턴 수의 정확히 2배로 보였다. 실제 세션 데이터로 확인: 182 = user 91 + assistant 91, 중복 저장 아님. 뱃지를 user 메시지 수(턴 수) 기준으로 변경.
- 세션 이전 탭의 memory card가 Episodic/Semantic만 표시했는데, 파생 원본인 memory.input을 원문 필드로 카드 맨 위에 추가. 상단의 원래 입력한 내용 블록(profile_memories 원문)은 기존대로 유지.
