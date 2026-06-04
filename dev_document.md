# VibeDesign Agent 개발 문서

## 1. 서비스 개요

- **목표**: UI/UX 디자이너가 AI 에이전트와의 대화만으로 디자인 과업을 진행할 수 있게 해주는 협업 연구 도구.
- **핵심 경험**: 사용자는 과업 브리핑 및 피드백을 텍스트 대화로 전달하면 에이전트가 레퍼런스 탐색 → 아이디어 기록 → 목업 생성 → 최종 디자인 선택까지 수행.
- **연구 목적**: HCI 연구 맥락에서 AI-인간 협업 시 공유 멘탈 모델(shared mental model) 형성 과정 연구.

---

## 2. 기술 스택

| 영역            | 기술                                                  |
| --------------- | ----------------------------------------------------- |
| 프레임워크      | Next.js (App Router), TypeScript                      |
| 스타일링        | Tailwind CSS v4, @phosphor-icons/react                |
| 인증            | Firebase Authentication (Google OAuth)                |
| 데이터베이스    | Firebase Firestore                                    |
| AI 채팅         | OpenAI Responses API (gpt-4o) + web_search_preview 툴 |
| 목업 생성       | Google Stitch SDK                                     |
| 이미지 검색     | Serper API (Google 이미지 검색)                       |
| 마크다운 렌더링 | react-markdown                                        |

---

## 3. 페이지 구조

### `/` — 로그인

- Firebase Google OAuth 로그인
- 인증 후 `/lobby`로 이동

### `/lobby` — 미션 로비

- Firestore `missions` 컬렉션에서 미션 목록 로드
- 미션 카드: 제목, 설명, 기간, 디바이스 타입 표시
- 미션 클릭 → `/main/[missionId]`로 이동

### `/admin` — 관리자 페이지

- 어드민 이메일 화이트리스트로 접근 제한
- 미션 CRUD (생성/수정/삭제)
- 미션 ID: `mission-YYYYMMDD-HHmmss` 형식 (사람이 읽기 쉬운 구조)
- 참여자 목록 조회 및 세션 열람 (읽기 전용 뷰)
- 참여자 카드의 X는 해당 미션 세션과 하위 `memoryDrafts`/`reviewTurns`만 삭제하며, 유저 정보/장기 메모리/다른 미션 기록은 유지
- 사용자 카드의 `세션 백업 후 삭제`는 모든 세션/참여 기록을 백업 후 삭제하되, 장기 메모리 컬렉션은 유지
- 유저 메모리 조회: 버전별 cluster view 중심으로 표시
- 메모리 cluster view: similarity graph, cluster list/detail, graph 진단값을 표시

### `/main/[missionId]` — 메인 디자인 세션

- 좌측 패널 (스크롤 가능): Mission → Reference → 아이디어 탭 (Idea/Mockup)
- 우측 패널 (고정): AI 에이전트 채팅

### `/agent` — Agent Manage

- Placeholder (향후 에이전트 메모리/상태 관리 예정)

---

## 4. 핵심 기능 상세

### 4.1 미션 (Mission)

- 관리자가 설정한 제목/브리핑/기간/디바이스가 읽기 전용으로 표시
- 수정은 어드민 페이지에서만 가능
- 옵션이 1개뿐인 미션은 세션 로드 시 해당 옵션을 자동 선택하고 `selectedOptionId`, `missionTitle`, `missionBrief`, `selectedDevice`를 세션 문서에 저장
- 실제 세션 시작은 사용자가 `세션 시작하기` 버튼을 누를 때 발생하며, 이때 `timerStartedAt`을 세팅
- 세션 종료 버튼은 `timerStartedAt` 또는 복구 가능한 세션 데이터(messages/ideas/artboards/references/activityLog)가 생기기 전에는 비활성화되고, 세션 종료 완료 후에는 `status: completed` 기준으로 비활성화

### 4.2 레퍼런스 (Reference)

- 채팅에서 "레퍼런스 찾아줘" → `[FETCH_REFERENCES: {query}]` 블록 → Serper API로 이미지/웹 검색
- 검색당 3개씩 누적 표시 (삭제 가능, confirm 팝업)
- 레퍼런스 선택(인용) 후 메시지 전송 시 이미지를 base64로 서버에서 변환해 GPT-4o에 전달
- 인용된 레퍼런스 URL도 시스템 컨텍스트로 전달, GPT-4o가 웹 검색으로 방문 가능
- **검색 모드 분기**: `inferReferenceMode(query)`로 "style" vs "product" 모드를 분류
  - **product 모드**: Serper 이미지 검색 × 3 병렬 실행
  - **style 모드**: 이미지 검색 × 3 + `searchCurationSites()` 병렬 실행
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
- **생성 흐름**: 채팅 → GPT-4o가 `[GENERATE_MOCKUP: {prompt}]` 출력 → Google Stitch API 호출 → HTML 반환 → 캔버스에 표시
- **GPT-4o 컨텍스트**: 미션 제목/브리핑, 현재 아이디어 내용, 기존 목업 HTML, 선택된 UI 요소, 인용 레퍼런스, 대화 히스토리
- **missionBrief 보완 주입**: 신규 목업 생성 시 아이디어 내용이 300자 미만으로 빈약하면 `missionBrief`를 `buildMockupPrompt`에 직접 주입해 제품 데이터가 Stitch에 전달되도록 보장 (수정 시에는 주입 안 함)
- **캔버스**: 드래그 패닝, 휠 줌, Fit 버튼, 확대(fullscreen) 모드
- **편집 모드**: 특정 UI 요소 클릭 선택 → `[EDIT_MOCKUP: {prompt}]`로 수정
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
  - `[CREATE_NOTE: ...]` → 새 아이디어(시안) 생성. 단, 디자인 스타일만 먼저 작성되어 현재 시안이 빈 shell이면 새 시안을 만들지 않고 해당 시안 내용을 채움
  - `[UPDATE_NOTE: ...]` → 현재 아이디어 내용 업데이트
  - `[CREATE_DESIGN_SPEC: ...]` → 현재 아이디어의 디자인 스타일 정의/교체. 현재 아이디어가 없으면 빈 시안을 자동 생성하고 그 시안에 스타일을 저장
  - `[GENERATE_MOCKUP: ...]` → Stitch 목업 생성
  - `[EDIT_MOCKUP: ...]` → 목업 수정
  - `[FETCH_REFERENCES: ...]` → Serper 이미지/큐레이션 검색
  - `[WEB_SEARCHED]` → 웹 검색 배지

### 4.7 메모리 (Memory)

- **생성 단위**: 세션 중 interaction turn마다 `/api/memory/drafts`에서 memory draft 생성
- **확정 시점**: 사용자가 `세션 종료` 버튼을 누르면 `/api/memory/complete-session`에서 draft를 통합해 장기 메모리로 저장
- **버전 관리**: admin memory modal에서 v0.1.0 / v0.1.1 / v0.1.2를 분리 조회
- **현재 활용**: 각 채팅 turn 직전에 `/api/memory/retrieve`로 현재 query와 가까운 memory top 5를 검색해 채팅 context에 주입
- **Prompt 주입 방식**: profile input은 `profile_memories`에 source of truth로 보관한 뒤 derived memory로 쪼개 interaction memory와 같은 retrieved memory system message에 주입. prompt compact JSON은 `episodic`/`semantic` 배열만 포함한다. 같은 memory document에 episodic/semantic이 모두 있어도 prompt에서는 각각 `episodic[].episodic`, `semantic[].semantic`으로 분리해 넣고 memory id/weight/similarity/source metadata는 제외
- **Legacy**: `GET /api/memory/bootstrap`은 세션 시작 시 memory를 preload하던 구 방식이며, 현재 main client에서는 호출하지 않음
- **Retrieval 쿼리 구성**: `[user text] + Mission: [parentMissionTitle] + Active idea: [description]` — 선택된 옵션 이름(페르소나 등)은 제외해 임베딩 노이즈 방지
- **Admin 관측**: researcher가 user별 memory cluster 결과와 graph/detail 진단값을 확인 가능
- **Retrieval MVP**: v0.1.2 memory document에 embedding과 `weight` metadata를 저장하고, retrieve된 memory의 weight를 천천히 올림
- **Forgetting MVP**: low-weight/duplicate 후보를 `archivedAt` 기반으로 soft archive

#### 메모리 클러스터링

- 경로: `POST /api/admin/users/[uid]/memory/clusters`
- 입력: 현재 admin filter에 걸린 semantic memory items
- 1단계: semantic memory를 `text-embedding-3-large`로 embedding
- 2단계: `K=1..12` 범위에서 k-means를 실행하고 inertia를 계산해 Elbow K 산출
- 3단계: semantic memory pair를 샘플링하고 LLM에게 "같은 category로 묶어야 하는가"를 질문
- 4단계: 각 K의 cluster assignment가 LLM pairwise 판단과 얼마나 일치하는지 agreement score 계산
- 최종 K: LLM agreement가 가장 높은 K. 동률이면 Elbow K에 가까운 K 선택
- LLM은 cluster membership을 바꾸지 않고, 최종 cluster label/summary 생성에도 사용
- Admin UI에는 Elbow K, K별 inertia, LLM K, K별 agreement를 표시
- 캐시 키는 memory version + item signature + clustering method version으로 분리해 이전 방식 결과와 충돌하지 않게 관리

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
diagnostics: {
  method
  embeddingModel
  labelModel
  requestedClusterCount
  actualClusterCount
  elbow: { selectedK, points[] }
  granularity: { selectedK, fallbackK, pairCount, scores[] }
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

| 경로                                              | 설명                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `POST /api/chat`                                  | GPT-4o 채팅 (Responses API + web_search)                                |
| `POST /api/stitch`                                | Google Stitch 목업 생성/편집                                            |
| `GET /api/stitch/html`                            | Stitch 스크린 HTML 재조회                                               |
| `POST /api/references`                            | Serper 이미지 검색 + 큐레이션 사이트 웹 검색 (3개 반환)                 |
| `POST /api/memory/drafts`                         | interaction turn 단위 memory draft 생성                                 |
| `POST /api/memory/complete-session`               | 세션 종료 시 draft를 장기 메모리로 확정                                 |
| `GET /api/memory/bootstrap`                       | Legacy: 세션 시작 시 user memory preload. 현재 main client에서는 미사용 |
| `POST /api/memory/retrieve`                       | query embedding 기반 memory top 5 검색 및 weight 업데이트               |
| `POST /api/admin/missions`                        | 미션 생성 (관리자 전용)                                                 |
| `GET /api/admin/users/[uid]/memory`               | admin memory table 조회                                                 |
| `GET/POST /api/admin/users/[uid]/memory/clusters` | admin memory cluster 캐시 조회/생성                                     |
| `GET /api/admin/users/[uid]/memory/forgetting`    | archive 후보 산출                                                       |
| `PATCH /api/admin/users/[uid]/memory/forgetting`  | semantic item soft archive                                              |

---

## 7. 프롬프트 관리 (`src/lib/prompts.ts`)

모든 LLM 프롬프트는 `src/lib/prompts.ts` 한 곳에서 관리한다. 각 API route는 이 파일에서 import해서 사용하며, 프롬프트를 직접 route 파일에 인라인으로 작성하지 않는다.

| export                                               | 종류     | 사용처                                                        |
| ---------------------------------------------------- | -------- | ------------------------------------------------------------- |
| `CHAT_AGENT_BASE_PROMPT`                             | const    | `chat/route.ts` — 공통 에이전트 역할/명령 태그 정의           |
| `chatActionInstructionPrompt(intent, includeRouter)` | function | `chat/route.ts` — planner intent에 맞는 행동 규칙만 주입      |
| `chatDevicePrompt(deviceLabel)`                      | function | `chat/route.ts` — 대상 디바이스 명시                          |
| `chatMissionPrompt(title, brief)`                    | function | `chat/route.ts` — 미션 컨텍스트 주입                          |
| `chatProfileMemoryPrompt(lines)`                     | function | `chat/route.ts` — Legacy/backcompat profile_input 직접 주입   |
| `chatInteractionMemoryPrompt(json)`                  | function | `chat/route.ts` — 상호작용 메모리 주입                        |
| `chatDesignSpecPrompt(spec)`                         | function | `chat/route.ts` — 디자인 스타일 가이드 주입                   |
| `chatCitedTextsPrompt(texts)`                        | function | `chat/route.ts` — 인용 텍스트 주입                            |
| `chatActiveIdeaPrompt(title, desc)`                  | function | `chat/route.ts` — 현재 작업 시안 주입                         |
| `chatCurrentRequestPrompt(text)`                     | function | `chat/route.ts` — 최신 사용자 요청 강조                       |
| `chatMockupHtmlPrompt(html)`                         | function | `chat/route.ts` — 현재 목업 HTML 주입                         |
| `chatSelectedElementPrompt(sel, html)`               | function | `chat/route.ts` — 선택된 UI 요소 주입                         |
| `chatCitedRefsWithUrlPrompt(titles, urls)`           | function | `chat/route.ts` — URL 있는 레퍼런스                           |
| `chatCitedRefsNoUrlPrompt(titles)`                   | function | `chat/route.ts` — URL 없는 레퍼런스                           |
| `MEMORY_ENCODE_PROMPT`                               | const    | `memory/drafts/route.ts` — interaction → memory 인코딩        |
| `REFERENCE_MODE_CLASSIFY_PROMPT`                     | const    | `references/route.ts` — style vs product 분류                 |
| `referenceQueryBuilderPrompt(mode, names)`           | function | `references/route.ts` — 검색 쿼리 생성                        |
| `referenceCandidateRankingPrompt(mode, n)`           | function | `references/route.ts` — 후보 랭킹                             |
| `referenceProductSearchPrompt(names)`                | function | `references/route.ts` — 제품 레퍼런스 검색                    |
| `referenceImageSourcePrompt(title, desc)`            | function | `reference-image/route.ts` — 앱 UI 레퍼런스 페이지 검색       |

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
ANTHROPIC_CHAT_MODEL # optional, default claude-sonnet-4-6
ANTHROPIC_API_VERSION # optional, default 2023-06-01
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_MEASUREMENT_ID
```

---

## 10. 최근 구현된 변경 사항

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

## 11. 메모리 Retrieval / Forgetting 개발 계획

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

## 12. 미구현 / 향후 계획

- `/agent` 페이지: 에이전트 메모리/상태 관리 UI
- 반응형/접근성 개선
- E2E 테스트
- Memory forgetting / archive pipeline 자동화
- Forgetting threshold tuning 및 automatic archive feature flag

---

### 12.1 메모리 리뷰/온보딩 개선 로드맵

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

## 13. 0604 14:00 실행 계획

이 섹션은 0604 논의 기준의 최신 작업 큐다. 우선순위는 **사용자에게 바로 깨져 보이는 디버깅 → 메모리 뷰 정보 구조 정리 → 메모리 시스템 정책 → 프롬프트/에이전트 구조 → 어드민/컴포넌트 정리 → 데이터 생성/배포** 순서로 둔다.

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
  - activeIdea: note 생성/수정/mockup 관련 intent에서만 주입
  - designSpec: mockup generate/edit/design spec 관련 intent에서만 주입
  - mockupHtml: edit/현재 화면 분석 intent에서만 주입. generate intent에서는 사용자가 기존 mockup 기반 변형을 요구한 경우에만 주입
  - selectedElement: selectedElement가 있고 edit intent일 때 우선 주입
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
  - 세션 리뷰에서는 `세션 이전/세션 이후`와 `변화만/전체/참고/기억됨/보관됨` 필터를 먼저 적용한 뒤 graph에 전달한다.
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
  - 세션 백업 후 삭제: 전체 sessions/participant records/storage 파일을 백업 후 삭제, 장기 메모리는 유지
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

## 14. 0604 TODO / 설계 확인

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
  - 구현: reference search/delete/cite 계열 interaction은 memory draft 경로를 통해 `references_fetch`, `reference_delete`, `reference_cite` action으로 인코딩 가능
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
    - clustering embedding text: similarity 묶음은 의미 기반으로 유지하고 timestamp는 label/debug metadata로만 사용
  - 저장 정책: memory document에는 `timestamp`, `createdAt`, `updatedAt` metadata를 계속 저장하되 `embeddingSource`는 timestamp 제외 source임을 명확히 표시
  - 구현: memory draft encoding prompt에 current/previous interaction timestamp를 제공하고, `MEMORY_ENCODE_PROMPT`에는 timestamp를 순서/최근성 판단에만 쓰도록 명시
  - 구현: interaction/profile/retrieval regenerate embedding은 `combined_no_timestamp` source를 사용. 기존 `combined` embedding은 이미 timestamp-free라 재생성 대상에서 제외
