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
| 이미지 검색     | Serper API (Google 이미지 검색)                                                       |
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
- 미션 CRUD (생성/수정/삭제)
- 미션 콘텐츠는 Firestore `missions/{id}.options[0]`에 저장(제목/설명/마크다운 content). 옵션에는 어드민이 올린 콘텐츠 이미지 `assetImages[{url, path, note}]`도 담긴다. 이 이미지는 `/admin/new`뿐 아니라 `/admin` 기존 미션 편집에서도 Firebase Storage `mission-assets/`에 PNG/JPG/WebP만 업로드/삭제할 수 있고, main 세션의 Mission 섹션에서 썸네일로 바로 확인할 수 있다. 저장된 URL/path는 목업 생성 시 asset-led 경로로 그대로 주입된다(위 "콘텐츠 자산 주도 생성" 참고) `[현행 2026-06-19 → 15.96]`
- 미션 ID: `mission-YYYYMMDD-HHmmss` 형식 (사람이 읽기 쉬운 구조)
- 참여자 목록 조회 및 세션 열람 (읽기 전용 뷰)
- 참여자 카드의 X는 해당 미션 세션과 하위 `memoryDrafts`/`reviewTurns`만 삭제하며, 유저 정보/장기 메모리/다른 미션 기록은 유지
- 사용자 카드의 `세션 백업 후 삭제`는 세션/참여 기록/Storage 파일/장기 메모리(`memories_0_1_2`)/클러스터 캐시(`memoryClusters`)/retrieval logs를 백업 후 삭제한다 `[현행 2026-06-18 → 15.94]`
- 참여자 모달의 개별 `미션 기록 삭제`는 해당 미션 세션, participant record, `memoryDrafts`/`reviewTurns`, 그 미션의 `source.missionId`를 가진 장기 메모리와 mission-scoped retrieval logs를 삭제하고, `memoryClusters` cache를 비운다 `[현행 2026-06-18 → 15.94]`
- 유저 메모리 조회: 버전별 cluster view 중심으로 표시
- 메모리 cluster view: similarity graph, cluster list/detail, graph 진단값을 표시

### `/main/[missionId]` — 메인 디자인 세션

- 좌측 패널 (스크롤 가능): Mission → Reference → 아이디어 탭 (Idea/Mockup)
- 우측 패널 (고정): AI 에이전트 채팅
- 작업 화면에는 실제 화면 영역을 하이라이트하는 제품 투어가 있다. 온보딩 미션에서는 작업 화면 진입 시 자동으로 열리고, 일반 미션에서는 헤더의 `튜토리얼` 버튼을 눌러야 열린다. 튜토리얼은 미션 설명 공간, 채팅 공간, 레퍼런스 섹션, 시안을 여러 개 만들 수 있다는 점, 각 시안이 Design Brief/디자인 스타일/Mockup으로 구성된다는 점, 목업 편집 버튼 사용, Final Design 선택, 타이머와 세션 종료 버튼을 안내한 뒤 마지막에 튜토리얼 버튼 위치를 다시 안내한다 `[현행 2026-06-16 → 15.88]`
- 제품 투어가 `mission-brief` 단계를 표시할 때는 선택된 옵션 토글을 강제로 접어 미션 설명 본문이 먼저 보이게 한다 `[현행 2026-06-16 → 15.88]`

### `/agent` — Agent Manage

- 에이전트 메모리/상태 관리 뷰
- memory cluster graph, cluster list/detail, included memory items 표시

---

## 4. 핵심 기능 상세

### 4.1 미션 (Mission)

- 현재 미션 모델: 온보딩 제외 9개 단독 미션, 각 미션 옵션 1개. 유저별 랜덤 순서로 순차 진행(잠금). `[현행 2026-06-12 → 15.64/15.65]`
- 관리자가 설정한 제목/브리핑/기간/디바이스가 읽기 전용으로 표시
- 수정은 어드민 페이지에서만 가능
- 옵션이 1개뿐인 미션은 세션 로드 시 해당 옵션을 자동 선택하고 `selectedOptionId`, `missionTitle`, `missionBrief`, `selectedDevice`를 세션 문서에 저장. 다중 옵션 선택 화면은 `options.length > 1`일 때만 노출되며 현재 미션엔 해당 없음
- 일반 미션의 세션 시작 전 setup은 `미션 읽기` → `사전 정보` → `세션 시작` 3단계다. 1/2/3단계의 미션 요약 카드는 공통 컴포넌트로, `전체 미션 설명` → `제한 시간` → `해당 옵션 brief` → `제공 이미지/설명(assetImages[].note)` 순서로 표시한다. 2단계에서는 미션을 진행할 때 에이전트가 미리 알아야 할 정보를 자유 입력한다. 온보딩은 before-session memory를 만들지 않으므로 정보 입력 단계를 건너뜀 `[현행 2026-06-18 → 15.67/15.95]`
- 실제 세션 시작은 사용자가 `세션 시작하기` 버튼을 누를 때 발생하며, 이때 `timerStartedAt`을 세팅
- 세션 종료 버튼은 `timerStartedAt` 또는 복구 가능한 세션 데이터(messages/ideas/artboards/references/activityLog)가 생기기 전에는 비활성화되고, 세션 종료 완료 후에는 `status: completed` 기준으로 비활성화

### 4.2 레퍼런스 (Reference)

- 채팅에서 "레퍼런스 찾아줘" → `[FETCH_REFERENCES: {query}]` 블록 → Serper API로 이미지/웹 검색
- 검색당 3개씩 누적 표시 (삭제 가능, confirm 팝업)
- 검색 중에는 해당 assistant chat bubble 안에 작은 로딩 pill을 표시한다
- 중복 제외/빈 결과/검색 실패 메시지는 Reference 섹션이 아니라 해당 assistant chat bubble의 "레퍼런스 검색 결과"로 표시한다
- 레퍼런스 선택(인용) 후 메시지 전송 시 이미지를 base64로 서버에서 변환해 chat provider에 전달
- 인용된 레퍼런스 URL도 시스템 컨텍스트로 전달. OpenAI provider에서는 웹 검색으로 방문 가능
- **검색 모드 분기**: `inferReferenceMode(query)`로 "style" vs "product" 모드를 분류
  - **product 모드**: OpenAI `web_search_preview` JSON product 검색을 먼저 수행하고, 결과가 없을 때 Serper 이미지 검색 fallback으로 이동
  - **style 모드**: 이미지 검색 × 3 + `searchCurationSites()` 병렬 실행
- 레퍼런스 카드에는 provider/source 정보만 표시하고, 내부 `style/product` 검색 모드는 중복 배지로 노출하지 않는다
- **큐레이션 사이트 검색**: Serper `/search` 엔드포인트에 `site:` 연산자를 사용해 9개 큐레이션 도메인에서 웹 결과 검색
  - 대상 도메인: awwwards.com, siteinspire.com, cssdesignawards.com, godly.website, mobbin.com, refero.design, siteofsites.co, craftwork.design, component.gallery
  - 큐레이션 결과는 imageUrl 없이 수집 → `hydrateReferenceMetadata()`로 og:image를 fetch해 썸네일 확보
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
- **채팅 컨텍스트**: 미션 제목/브리핑, 현재 아이디어 내용, 기존 목업 HTML, 선택된 UI 요소, 인용 레퍼런스, 대화 히스토리
- **missionBrief 보완 주입**: 신규 목업 생성 시 아이디어 내용이 300자 미만으로 빈약하면 `missionBrief`를 `buildMockupPrompt`에 직접 주입해 제품 데이터가 Stitch에 전달되도록 보장 (수정 시에는 주입 안 함)
- **이미지 주도 생성**: 사용자가 참고 이미지를 첨부/붙여넣거나(Phase 1) 신규 목업 요청에 URL을 주면(Phase 2 — 채팅 메시지 내 URL 또는 인용 레퍼런스의 URL), 텍스트 design.md 단계 없이 그 화면을 Stitch에 `upload`→`edit`로 재구성해 목업을 만들고 결과에서 design.md를 역추출·저장한다. URL은 서버가 스크린샷(Microlink 무키, `captureScreenshot` 추상화)으로 캡처하며 첨부 이미지가 우선. 모바일 목업이면 URL 캡처도 390×844 모바일 viewport, 데스크톱이면 1280×900 viewport로 찍는다. 이미지/URL이 있으면 "디자인 스타일 필수" 게이트를 우회한다. `src/app/api/stitch/route.ts`의 `isImageLed` 분기 참고 `[현행 2026-06-15 → 15.81/15.83]`
- **콘텐츠 자산 주도 생성(asset-led)**: 미션 옵션에 어드민이 등록한 콘텐츠 이미지(`assetImages`, 실제 상품 사진·UI 캡쳐)가 있으면 신규 목업 생성 시 그 URL과 설명(`note`)을 `/api/stitch`로 넘겨, 서버가 다운로드→`upload`→`edit`하면서 asset manifest와 함께 "이 이미지들을 그대로 콘텐츠로 박아 넣어라"(`assetImageEmbedPrompt`)로 생성한다. 이미지 주도 생성과 달리 이미지를 스타일로 재구성하지 않고 콘텐츠 자산으로 보존하며, 레이아웃·스타일은 brief와 디자인 시스템을 따른다. 그래서 디자인 스타일을 미리 적용하고 결과 기반 design.md 역추출은 하지 않는다. 사용자가 그 턴에 스타일 이미지/URL을 첨부하면 그쪽(isImageLed)이 우선. `src/app/api/stitch/route.ts`의 `isAssetLed` 분기 참고 `[현행 2026-06-18 → 15.89/15.93]`
- **액션/화면 완료 보장**: `CREATE_DESIGN_SPEC`는 JSON 뒤 닫는 대괄호가 빠지거나 일반 마크다운 payload로 와도 균형 스캔과 loose parser로 복구하며, 복구 불가능하면 영구적인 작성 중 상태 대신 명시적 실패로 표시한다. Stitch가 screen metadata만 먼저 반환하면 HTML을 재조회한 뒤 아트보드를 확정하고, 저장된 screen의 HTML 복원 중에는 빈 iframe 대신 로딩/실패 상태를 표시한다. `src/lib/session/chat-content.ts`와 `src/app/main/[missionId]/page.tsx`를 직접 확인 `[현행 2026-06-21 → 15.97]`
- **캔버스**: 드래그 패닝, 휠 줌, Fit 버튼, 확대(fullscreen) 모드. 선택 스크립트는 iframe HTML에 항상 주입하고, 편집 모드 토글은 pointer event와 선택 해제 메시지로 제어해 iframe `srcDoc` reload를 피한다 `[현행 2026-06-15 → 15.78]`
- **편집 모드**: 특정 UI 요소 클릭 선택 → `[EDIT_MOCKUP: {prompt}]`로 수정. 선택 요소가 있는 상태에서 "크게/색/문구/삭제" 등 짧은 타깃 편집 요청이 오면 planner 판단과 무관하게 현재 목업 HTML과 선택 요소 컨텍스트를 함께 주입한다 `[현행 2026-06-15 → 15.77]`
- Stitch edit가 기존 screen을 mutate하지 않고 새 screen을 만들면 기존 artboard를 덮어쓰지 않고 새 artboard로 추가한 뒤 active로 전환한다 `[현행 2026-06-15 → 15.79]`
- 선택 요소를 인용해 chat에 전송하면 해당 turn의 `citedElement`에는 포함하되, 입력 UI와 iframe outline에서는 즉시 선택 해제한다 `[현행 2026-06-15 → 15.80]`
- 현재 시안에 디자인 스타일이 이미 있을 때 사용자가 다른 스타일/무드/레퍼런스 방향으로 다시 만들라고 요청하면 기존 디자인 스타일을 덮어쓰지 않고 새 시안으로 fork한다. 새 시안은 기존 brief에서 제품/UX 요구사항만 유지하고 기존 시각 스타일·레이아웃·무드 제약은 제거하며, 인용 레퍼런스/URL/첨부 이미지를 새 디자인 스타일 근거로 기록한다. Stitch 이미지 주도 생성에서는 제품 brief와 스크린샷이 충돌할 때 스크린샷의 레이아웃·밀도·배경·타입·무드가 우선한다 `[현행 2026-06-15 → 15.82/15.85]`
- 아이디어 탭 전환 시 해당 아이디어의 목업만 표시
- HTML Export 지원
- Stitch 프로젝트 ID Firestore 저장 (재연결/수정 지원)

### 4.5 최종 디자인 (Final Design)

- 세션 종료 전 생성된 목업 중 하나를 최종 디자인으로 선택
- 최종 디자인은 mission session의 `finalArtboardId`로 저장
- 최종 디자인 미선택 상태로 세션 종료 시 확인 경고를 표시

### 4.6 AI 채팅

- **응답 생성 provider**: 기본 OpenAI `gpt-5.4` (Responses API). `CHAT_RESPONSE_PROVIDER=anthropic` 또는 `LLM_PROVIDER=anthropic`이면 최종 chat 응답 생성만 Claude Messages API로 전환
- **Provider 범위**: planner, embedding, memory retrieval/encoding, clustering label은 기존 OpenAI 경로 유지. `/api/chat`의 최종 assistant response streaming만 provider switch 대상. Admin UI에서는 메인 채팅 헤더의 LLM selector로 turn별 provider override 가능
- **웹 검색**: OpenAI provider일 때 `web_search_preview` 툴 활성화, 레퍼런스 URL 인용 시 `tool_choice: "required"`로 강제. Anthropic provider일 때는 prompt에 포함된 reference title/url context를 사용하고 web search tool은 호출하지 않음
- **스트리밍**: SSE 방식으로 실시간 토큰 출력
- **웹 검색 표시**: 검색 발생 시 `[WEB_SEARCHED]` 마커 → "웹 검색 완료" 배지 표시
- **인용 링크**: 웹 검색 출처 `(domain.com)` 자동으로 클릭 가능한 마크다운 링크로 변환
- **특수 블록 처리**:
  - `[CREATE_NOTE: ...]` → 새 아이디어(시안) 생성. 저장 payload는 목표/대상 사용자, 핵심 경험, 화면 구조, 미션 필수 콘텐츠, 제약을 포함한 독립적인 Design Brief여야 한다. 모델이 한 줄 작업 지시문을 반환하면 클라이언트가 미션 맥락과 현재 사용자 요청으로 시작 가능한 브리프를 복구한다. 단, 디자인 스타일만 먼저 작성되어 현재 시안이 빈 shell이면 새 시안을 만들지 않고 해당 시안 내용을 채움 `[현행 2026-06-21 → 15.98]`
  - `[UPDATE_NOTE: ...]` → 현재 아이디어 내용 업데이트
  - `[CREATE_DESIGN_SPEC: ...]` → 현재 아이디어의 디자인 스타일 정의/교체. 현재 아이디어가 없으면 빈 시안을 자동 생성하고 그 시안에 스타일을 저장
  - `[GENERATE_MOCKUP: ...]` → Stitch 목업 생성
  - `[EDIT_MOCKUP: ...]` → 목업 수정
  - `[FETCH_REFERENCES: ...]` → Serper 이미지/큐레이션 검색
  - `[WEB_SEARCHED]` → 웹 검색 배지

### 4.7 메모리 (Memory)

- **생성 단위**: 세션 중 interaction turn마다 `/api/memory/drafts`에서 memory draft 생성. interaction마다 semantic memory를 적극 생성하고 해석 신뢰도를 `interpretationConfidence`로 기록 `[추가됨 2026-06-12 → 15.63]`
- **Source normalization**: 채팅 turn의 인용 text, link metadata, 선택 UI result, 첨부 image를 structured source로 draft API에 전달한다. text/link/UI는 서버에서 텍스트화하고 image는 필요할 때만 vision description을 생성한다. 결과와 source fingerprint를 draft에 저장해 같은 interaction 재처리 시 재사용한다 `[현행 2026-06-21 → 15.100]`
- **첨부 이미지 시각 선호**: image normalizer는 의도적으로 선호를 추론하지 않으므로, 첨부 이미지가 주도한 목업 생성이 성공해 derivedDesignStyle가 나오면 그 스타일을 `style-image-preference-{turnId}` interactionId(category `style_image_preference`)로 별도 draft에 기록한다. 이번 미션/시안 맥락의 session-scoped evidence로 담고 전역 취향으로 단정하지 않는다 `[현행 2026-06-21 → 15.101]`
- **확정 시점**: 사용자가 `세션 종료` 버튼을 누르면 `/api/memory/complete-session`에서 draft를 통합해 장기 메모리로 저장
- **버전 관리**: admin memory modal에서 v0.1.0 / v0.1.1 / v0.1.2를 분리 조회 `[stale 2026-06-12 → 15.51: legacy fallback 제거로 현재 v0.1.2 단일 버전만 사용(MemoryVersionTab = "0.1.2"). v0.1.0/v0.1.1 분리 조회 없음]`
- **현재 활용**: 각 채팅 turn 직전에 `/api/memory/retrieve`로 현재 query와 가까운 memory top 5를 검색해 채팅 context에 주입
- **Prompt 주입 방식**: profile input은 `profile_memories`에 source of truth로 보관한 뒤 derived memory로 쪼개 interaction memory와 같은 retrieved memory system message에 주입. prompt compact JSON은 `episodic`/`semantic` 배열만 포함한다. 같은 memory document에 episodic/semantic이 모두 있어도 prompt에서는 각각 `episodic[].episodic`, `semantic[].semantic`으로 분리해 넣고 memory id/weight/similarity/source metadata는 제외
- **Legacy**: `GET /api/memory/bootstrap`은 세션 시작 시 memory를 preload하던 구 방식이며, 현재 main client에서는 호출하지 않음
- **Retrieval 쿼리 구성**: `[user text] + Mission: [parentMissionTitle] + Active idea: [description]` — 선택된 옵션 이름(페르소나 등)은 제외해 임베딩 노이즈 방지
- **Admin 관측**: researcher가 user별 memory cluster 결과와 graph/detail 진단값을 확인 가능
- **Retrieval MVP**: v0.1.2 memory document에 embedding과 `weight` metadata를 저장하고, retrieve된 memory의 weight를 천천히 올림
- **Forgetting MVP**: low-weight/duplicate 후보를 `archivedAt` 기반으로 soft archive

#### 메모리 클러스터링

- 경로: 일반 사용자 본인 memory는 `GET/POST /api/memory/clusters`, admin의 타인 memory 진단은 `GET/POST /api/admin/users/[uid]/memory/clusters`
- 입력 variant: `/agent`에서 `semantic-only`, `compact-context`(keyword+episodic+semantic), `full-context`(기존 keyword+episodic+semantic+originalInteractionContent+link)를 선택할 수 있다. 기본값은 `full-context`
- 1단계: 선택한 variant별 텍스트를 `text-embedding-3-large`로 embedding
- 2단계: cosine similarity graph 생성. 강한 유사도 edge와 node별 KNN edge를 함께 사용
- 3단계: similarity graph에서 label propagation으로 community를 찾고, community가 너무 많으면 centroid similarity 기준으로 최대 16개까지 merge
- 4단계: LLM은 cluster membership을 바꾸지 않고 최종 cluster label/summary만 생성한다. summary는 작업 목록을 일반적으로 요약하지 않고 Firestore profile의 실제 displayName을 사용해 그 사람의 반복되는 성격, 습관, 작업 방식, 의사결정 패턴과 디자인 취향을 근거와 함께 서술한다. 단일·약한 근거에는 consistently/always 같은 반복 표현을 쓰지 않는다 `[현행 2026-06-21 → 15.99]`
- `/agent` UI에는 팀원이 자기 memory에 대해 3가지 입력 variant를 바꿔가며 클러스터를 생성·비교할 수 있는 테스트 컨트롤을 표시한다
- 캐시 키는 memory version + item signature + clustering method version + input variant로 분리해 서로 다른 입력 실험 결과가 덮어쓰이지 않게 관리한다 `[현행 2026-06-16 → 15.86]`

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
  graph: { minSimilarity, strongSimilarity, knnEdges, nodeCount, edgeCount, ... }
}
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

> `[부분 목록 2026-06-12]` 아래 표는 일부만 담고 있다. 실제 라우트의 source of truth는 `src/app/api/` 디렉터리다. 표에 없는 현존 라우트: `GET /api/memory/all`, `GET/POST /api/memory/clusters`, `POST /api/memory/session-summary`, `GET /api/memory/archive-status`, `GET /api/users/me`, `GET /api/admin/users`, `GET /api/admin/missions`. 라우트 존재 여부는 코드를 직접 확인할 것.

| 경로                                              | 설명                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `POST /api/chat`                                  | 채팅 응답 생성 (OpenAI Responses API 기본, Anthropic 선택 가능)         |
| `POST /api/stitch`                                | Google Stitch 목업 생성/편집                                            |
| `GET /api/stitch/html`                            | Stitch 스크린 HTML 재조회                                               |
| `POST /api/references`                            | Serper 이미지 검색 + 큐레이션 사이트 웹 검색 (3개 반환)                 |
| `POST /api/memory/drafts`                         | interaction turn 단위 memory draft 생성                                 |
| `POST /api/memory/complete-session`               | 세션 종료 시 draft를 장기 메모리로 확정                                 |
| `GET /api/memory/bootstrap`                       | Legacy: 세션 시작 시 user memory preload. 현재 main client에서는 미사용 |
| `POST /api/memory/retrieve`                       | query embedding 기반 memory top 5 검색 및 weight 업데이트               |
| `GET/POST /api/memory/profile`                    | profile source 저장/조회 및 derived memory 생성                         |
| `POST /api/admin/missions`                        | 미션 생성 (관리자 전용)                                                 |
| `GET /api/admin/users/[uid]/memory`               | admin memory/cluster view용 메모리 조회                                 |
| `GET/POST /api/admin/users/[uid]/memory/clusters` | admin memory cluster 캐시 조회/생성                                     |
| `GET /api/admin/users/[uid]/memory/forgetting`    | archive 후보 산출                                                       |
| `PATCH /api/admin/users/[uid]/memory/forgetting`  | semantic item soft archive                                              |

---

## 7. 프롬프트 관리 (`src/lib/prompts.ts`)

모든 LLM 프롬프트는 `src/lib/prompts.ts` 한 곳에서 관리한다. 각 API route는 이 파일에서 import해서 사용하며, 프롬프트를 직접 route 파일에 인라인으로 작성하지 않는다.

| export                                               | 종류     | 사용처                                                      |
| ---------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `CHAT_AGENT_BASE_PROMPT`                             | const    | `chat/route.ts` — 공통 에이전트 역할/명령 태그 정의         |
| `chatActionInstructionPrompt(intent, includeRouter)` | function | `chat/route.ts` — planner intent에 맞는 행동 규칙만 주입    |
| `chatDevicePrompt(deviceLabel)`                      | function | `chat/route.ts` — 대상 디바이스 명시                        |
| `chatMissionPrompt(title, brief)`                    | function | `chat/route.ts` — 미션 컨텍스트 주입                        |
| `chatProfileMemoryPrompt(lines)`                     | function | `chat/route.ts` — Legacy/backcompat profile_input 직접 주입 |
| `chatInteractionMemoryPrompt(json)`                  | function | `chat/route.ts` — 상호작용 메모리 주입                      |
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
SERPER_API_KEY
STITCH_API_KEY
OPENAI_API_KEY
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
- `/api/memory/retrieve`는 LLM 없이 query embedding과 semantic item embedding의 cosine similarity로 top 5를 선택
- retrieve된 memory는 `weight`, `retrievedCount`, `lastRetrievedAt`를 업데이트
- top 5에는 들지 못했지만 충분히 가까운 top 6~20 후보에는 작은 weight 감소를 적용해 forgetting 압력을 누적
- retrieval log는 `users/{uid}/memoryRetrievalLogs/{logId}`에 저장
- 메인 채팅 요청 전 현재 user input + mission/idea context를 query로 사용해 retrieve하고, 결과를 해당 turn의 memory context에 주입
- Admin memory modal의 Retrievals 탭에서 query, retrieved memory, similarity, weight delta를 확인 가능

### 10.4 References API 개선

- **성능**: `Promise.all` 대신 `withConcurrency(tasks, 4)`로 병렬 fetch 수 제한
- **안정성**: `extractFirstJsonArray()` — regex 대신 bracket depth counting 파서로 URL 내 `[]` 포함 케이스 처리
- **보안**: `sanitizeInput(value, maxLength)` 함수로 LLM 입력 길이 제한 및 prompt injection 방지
- **큐레이션 검색**: `inferReferenceMode(query)`로 style/product 모드 분기. style 모드에서 9개 큐레이션 도메인 대상 `site:` Serper 웹 검색 병렬 실행
- **이미지 확보**: 큐레이션 결과는 imageUrl 없이 수집 후 `hydrateReferenceMetadata()`로 og:image fetch
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

### 10.8 Memory forgetting/archive MVP

- `GET /api/admin/users/[uid]/memory/forgetting`에서 archive candidate를 산출하고 자동 soft archive
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
  limit?: 5
}
```

- LLM 없이 query embedding과 memory embedding의 cosine similarity로 top 5 검색
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
nearMissDeltas;
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

- retrieve 후보였지만 선택되지 않은 near miss:

```typescript
if rank is 6..20 and similarity >= 0.55:
  weight = max(0.1, weight - 0.005)
```

- weight가 너무 빠르게 커지지 않도록 sublinear growth 사용
- near miss 감점은 프롬프트에 들어갈 만큼 강하지는 않지만 현재 query와 계속 경쟁하는 memory를 천천히 낮추기 위한 약한 신호로만 사용

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
  - `rawPrompt`도 1차 구현부터 저장한다.
  - `rawPrompt` 열람은 admin-only debug view로 분리한다.
  - `rawPrompt` 저장 전 sanitize를 수행하고, 제거된 항목의 흔적은 `rawPromptSanitization`에 남긴다.
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
  rawPrompt?: unknown, // sanitize 후 저장, admin-only 열람
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
  - 저장 대상: retrieved memory, `promptCompact`, sanitized `rawPrompt`, `rawPromptSanitization`, `rawResponseMeta`
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
- admin이 리뷰 화면을 열면 assistant bubble의 `Raw prompt 보기` 버튼으로 sanitized `rawPrompt`, sanitize 내역, response meta를 모달에서 확인할 수 있다.
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
- 리뷰 모드에서 우측 패널 상단에 **채팅 / 메모리 변화** 탭 바를 추가한다. 탭 바는 `showReviewAnnotations`(리뷰 모드 또는 admin 뷰어)일 때만 표시된다.
- **메모리 변화 탭** 섹션 구성:
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
  - Cluster: 기존 admin memory cluster cache가 있으면 similarity cluster별로 묶어 표시하고, cache가 없으면 Regenerate 안내와 fallback 배치를 표시
  - 재검토 조건: node view에서 정확한 세션 단위 before/after가 제품적으로 중요해질 때만 touched-memory diff event 저장을 검토

### 13.3 메모리 시스템

- [x] 메모리 전체 크기를 weight decay 계산에 반영
  - 목표: memory 수가 많을수록 near-miss decay 폭을 아주 조금 증가시켜 전체 memory 크기가 무한히 커지지 않게 함
  - 현재 기준: near miss는 rank 6~20, similarity `>= 0.55`, `weight - 0.005`, floor `0.1`
  - 구현: candidate memory count별 near-miss decay multiplier 적용
    - `< 60`: `1.0x`
    - `60~119`: `1.15x`
    - `120~199`: `1.3x`
    - `>= 200`: `1.5x`
  - 최대 decay 상한: `0.0075`
  - retrieval log에 `memoryCount`, `nearMissDecayMultiplier`, `nearMissWeightLoss`, nearMiss별 `decayMultiplier` 저장

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
    - 최근 message 3~5개 compact
    - 현재 UI 상태 boolean/count: hasActiveIdea, hasMockupHtml, hasSelectedElement, hasDesignSpec, citedReferenceCount, citedTextCount, profileMemoryCount, interactionMemoryCount
    - mission title + 짧은 mission summary
  - Planner 출력 schema 초안:

```typescript
type ChatPlan = {
  intent:
    | "answer"
    | "create_note"
    | "update_note"
    | "generate_mockup"
    | "edit_mockup"
    | "fetch_references"
    | "create_design_spec"
    | "clarify";
  confidence: number; // 0~1
  needs: {
    mission: boolean;
    interactionMemory: boolean;
    activeIdea: boolean;
    designSpec: boolean;
    mockupHtml: boolean;
    selectedElement: boolean;
    citedTexts: boolean;
    citedReferences: boolean;
    conversationHistory: "minimal" | "recent" | "full";
  };
  reason: string; // admin/debug용 짧은 설명
};
```

- Context selection rule 초안:
  - 항상 포함: `CHAT_AGENT_BASE_PROMPT`, planner intent별 `chatActionInstructionPrompt(...)`, target device, current request
  - mission: 기본 포함하되 brief는 planner가 `mission=true`일 때만 긴 버전 사용. 아니면 title + 1~2줄 summary만 사용
  - profile input: 14.4 이후 `/api/memory/profile`에서 derived memory로 분해되어 interaction memory와 같은 retrieval/context path를 사용
  - interactionMemory: planner가 `interactionMemory=true`일 때만 주입. prompt compact JSON은 `episodic[].episodic`과 `semantic[].semantic`만 포함
  - activeIdea: Design Brief 생성/수정/mockup 관련 intent에서만 주입. 내부 action id는 기존 계약 때문에 `create_note`/`update_note`를 유지한다 `[현행 2026-06-16 → 15.87]`
  - designSpec: mockup generate/edit/design spec 관련 intent에서만 주입
  - mockupHtml: edit/현재 화면 분석 intent에서만 주입. generate intent에서는 사용자가 기존 mockup 기반 변형을 요구한 경우에만 주입
  - selectedElement: selectedElement가 있으면 우선 주입. 선택 요소가 있는 상태의 타깃 편집 요청은 planner가 놓쳐도 `edit_mockup` intent와 `mockupHtml`/`selectedElement` 컨텍스트를 강제한다 `[현행 2026-06-15 → 15.77]`
  - citedTexts/citedReferences: 사용자가 현재 turn에서 인용했거나 planner가 reference/design inspiration intent로 판단한 경우만 주입
- MVP 구현 순서:
  1. [x] planner prompt/function을 `src/lib/prompts.ts`에 추가
  2. [x] `/api/chat`에서 plan 생성 후 `reviewTurns/{turnId}.promptPlan`에 저장
  3. [x] 실제 context pruning은 `mockupHtml`, `activeIdea`, `designSpec`부터 적용
  4. [x] interaction memory selection 적용 — planner가 `interactionMemory=true`일 때만 주입
- 실패/불확실성 처리:
  - planner 실패 시 기존 단일 프롬프트 방식으로 fallback
  - `confidence < 0.55`면 큰 context는 유지하되 `mockupHtml`만 selectedElement/edit 요청이 아닐 때 제외
  - admin raw prompt에는 plan, selected context keys, fallback 여부를 함께 저장
- 구현 메모(0602):
  - `/api/chat`에서 compact planner input을 만들고 `gpt-5.4`로 `ChatPlan`을 생성한다.
  - 기존 단일 system prompt는 제거하고, `CHAT_AGENT_BASE_PROMPT` + intent별 `chatActionInstructionPrompt(...)` 조합으로 분리했다.
  - `promptPlan`, `promptPlanFallback`, `selectedContextKeys`를 reviewTurn top-level과 `promptCompact`에 함께 저장한다.
  - pruning은 `activeIdea`, `designSpec`, `mockupHtml`, `citedTexts`, `citedReferences`, `interactionMemory`에 적용했다.
  - retrieved interaction memory는 prompt에 넣기 직전 `episodic[].episodic`과 `semantic[].semantic`으로 재그룹화한다. 검색은 combined embedding 기준으로 유지하되, 모델에게 전달되는 표현은 "이전 상호작용"과 "지속적 선호/패턴" 텍스트만 남긴다.
  - 같은 retrieved memory에 episodic/semantic이 모두 있으면 두 그룹에 각각 포함하고, prompt에는 memory id/source 연결 정보를 넣지 않는다.
  - planner 실패 시 기존 방식으로 fallback한다. `confidence < 0.55`면 대부분 context는 유지하되 `mockupHtml`은 selected/edit/current-screen 계열 요청일 때만 포함한다.
  - client assistant bubble의 `참조한 맥락` 요약은 제거했다. 대신 `/api/chat`이 stream 초반에 `[CHAT_PHASE: ...]` 이벤트를 여러 개 보내고, client는 이를 본문에 저장하지 않는 Codex식 단계 로그로 표시한다.
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
  - 구현: assistant message에 `chatPhases` 배열을 저장하고, chat bubble 안에서 `처리 과정 N개` toggle로 접고 펼칠 수 있게 표시
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
- [ ] Chat streaming, tool action chip, web searched badge, memory toggle의 visual language 통일 `[partially implemented: ToolActionChip tokenized]`
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
- [x] loading은 skeleton/spinner/progress를 상황별로 구분 `[skeleton(main 세션), pulse placeholder(lobby), spinner(chat/reference/mockup), sonner(작업 피드백) 구분 사용 확인]`
- [x] 숫자/시간/카운트는 tabular numbers 적용 `[9곳 적용 확인]`
- [x] 긴 제목과 설명은 `text-wrap: balance` 또는 `pretty` 적용 여부 검토 `[로그인/온보딩 h1+설명, 미션 카드 제목, alert-dialog description에 적용]`
- [ ] nested card/button radius는 concentric하게 맞춤 `[시각 확인 필요]`
- [x] icon-only button에는 tooltip과 accessible label 제공 `[size="icon" 및 raw icon button 전수 감사, aria-label 8곳 보강]`
- [x] enter/exit animation은 interruptible CSS transition 우선 `[radix data-state 기반 표준 패턴(100–200ms), 페이지 커스텀 entrance animation 없음]`
- [x] 페이지 첫 로드에서 과한 animation을 실행하지 않음 `[페이지 mount entrance animation 없음 확인. lobby는 loading pulse만]`

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
  - matching cache가 없으면 오래된/latest cache를 반환하지 않고 `clusters: []`, `found: false`를 반환한다.
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
  - read-only notice, selected element pill, cited text tray, selected reference tray, textarea, send/cancel buttons를 `ChatInput`으로 이동.
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
  - 수정: near-miss decay 제거 → **idle decay** 도입. retrieve마다 그 턴에 retrieve 안 된 모든 메모리에 −0.003(메모리 많을수록 최대 −0.006), 하한 0.1. 벽시계 무관(사용 기반)이라 3일 formative 실험의 "시간 기반 archive 금지" 원칙과 충돌 없음. 로그 필드 `idleDecayDeltas`/`idleDecayCount`로 교체(외부 consumer 없음). 튜닝 상수 `IDLE_DECAY_WEIGHT_LOSS`.
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
  - 생성: 세션에서 신규 목업(`isNew`)이고 그 턴에 스타일 이미지/URL 첨부가 없을 때 활성 옵션의 `assetImages` URL들을 `/api/stitch`로 전달. 서버 `isAssetLed` 분기가 각 URL을 `fetchImageAsDataUrl`로 받아 `writeStyleImageTmp`(다운스케일) → `project.upload` → 첫 스크린을 `assetImageEmbedPrompt`로 `edit`. 업로드 IMAGE 스크린은 artboard에서 제외(`allScreenIds` len 1), 결과 기반 design.md 역추출은 하지 않음(콘텐츠 사진이 스타일을 오염시키지 않도록).
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
