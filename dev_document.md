# VibeDesign Agent 개발 문서

## 문서 사용 기준

이 문서는 한 파일 안에서 두 가지 역할을 가진다.

- **1-9장: Current Snapshot** — 현재 구현과 운영 기준을 빠르게 확인하기 위한 source of truth. 새로운 결정이 구현되면 이 영역에 반영한다.
- **10장 이후: Decision / Implementation Log** — 시간순 의사결정, 실행 계획, 구현 흔적을 보존하기 위한 기록. 현재 기준과 충돌할 수 있으므로, 실제 동작 기준은 1-9장을 우선한다.

의사결정 로그는 삭제하지 않고 복기용으로 남긴다. 단, 이후 구현으로 대체된 내용은 `[superseded]`, 완료되어 현재 스펙에 반영된 내용은 `[implemented]`, 아직 보류 중인 내용은 `[deferred]`처럼 상태를 명시한다.

---

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
| AI 채팅         | OpenAI Responses API (기본 `gpt-5.4`) / Anthropic Claude 선택 + web_search_preview 툴 |
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

- 에이전트 메모리/상태 관리 뷰
- memory cluster graph, cluster list/detail, included memory items 표시

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
- 레퍼런스 선택(인용) 후 메시지 전송 시 이미지를 base64로 서버에서 변환해 chat provider에 전달
- 인용된 레퍼런스 URL도 시스템 컨텍스트로 전달. OpenAI provider에서는 웹 검색으로 방문 가능
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
- **생성 흐름**: 채팅 모델이 `[GENERATE_MOCKUP: {prompt}]` 출력 → Google Stitch API 호출 → HTML 반환 → 캔버스에 표시
- **채팅 컨텍스트**: 미션 제목/브리핑, 현재 아이디어 내용, 기존 목업 HTML, 선택된 UI 요소, 인용 레퍼런스, 대화 히스토리
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
| `GET /api/admin/users/[uid]/memory`               | admin memory/cluster view용 메모리 조회                                  |
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

## 15. Decision / Implementation Plan — 전체 UX/UI 개선 `[active]`

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
- [ ] 모바일에서는 panel tabs 또는 sheet 기반 전환으로 재설계

#### `/agent`

- [ ] 사용자용 메모리 뷰와 admin/debug 뷰의 정보 수준을 분리 `[deferred]`
- [ ] cluster list/detail/graph의 선택 상태와 empty state 정리 `[deferred]`
- [ ] graph loading/nonblank/resize 상태 확인 `[deferred]`
- [ ] "재생성" action의 권한/위험/로딩 피드백 강화 `[deferred]`

#### `/admin`

- [ ] 미션 CRUD, 참여자, 세션, 메모리, retrieval/forgetting debug를 task group별로 재구성 `[deferred]`
- [ ] 고밀도 table + detail sheet 패턴 도입 `[deferred]`
- [ ] destructive action은 Alert Dialog와 명확한 scope text 사용 `[deferred]`
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
   - [ ] `ReferenceCard`
   - [ ] `IdeaTabs`
   - [ ] `IdeaEditor`
   - [ ] `MockupCanvasToolbar`
   - [ ] `ChatPanel`
   - [ ] `ChatBubble`
   - [x] `ToolActionChip`
   - [ ] `MemoryEventCard`
   - [ ] `MemoryClusterPanel`
   - [ ] `AdminDataTable`
   - [ ] `PromptViewer`

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

- [ ] hover state는 색 변화만이 아니라 border/shadow/translate 중 하나를 일관되게 사용
- [ ] press state는 `scale(0.98)` 또는 명확한 active state를 짧게 제공
- [ ] `transition-all` 사용 금지. 필요한 property만 지정
- [ ] loading은 skeleton/spinner/progress를 상황별로 구분
- [ ] 숫자/시간/카운트는 tabular numbers 적용
- [ ] 긴 제목과 설명은 `text-wrap: balance` 또는 `pretty` 적용 여부 검토
- [ ] nested card/button radius는 concentric하게 맞춤
- [ ] icon-only button에는 tooltip과 accessible label 제공
- [ ] enter/exit animation은 interruptible CSS transition 우선
- [ ] 페이지 첫 로드에서 과한 animation을 실행하지 않음

### 15.10 접근성 / 모바일 / 상태 검증

- 접근성:
  - [ ] 모든 interactive element에 keyboard focus 표시
  - [ ] icon-only button에 `aria-label`
  - [ ] Dialog/Sheet focus trap과 escape close 확인
  - [ ] destructive action은 Alert Dialog 사용
  - [ ] error message는 `role="alert"` 또는 적절한 live region 사용
  - [ ] 색 대비 확인
- 모바일:
  - [ ] 360px, 390px, 430px, 768px, desktop viewport에서 확인
  - [ ] 세션 화면은 패널을 탭/시트로 전환
  - [ ] 긴 버튼 텍스트와 긴 미션 제목 overflow 확인
  - [ ] canvas controls가 목업을 가리지 않는지 확인
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
   - [ ] 각 route의 현재 screenshot 기록
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
   - [x] 큰 route file의 UI 책임을 단계적으로 분리
5. Route Redesign
   - [x] `/`
   - [x] `/onboarding`
   - [x] `/lobby`
   - [ ] `/main/[missionId]` `[partially implemented]`
   - [ ] `/agent` `[deferred]`
   - [ ] `/admin` `[deferred]`
6. Polish Pass
   - [x] jakubkrehel checklist 적용
   - [x] emilkowalski 관점으로 주요 화면 리뷰
7. Verification
   - [x] `npm run lint`
   - [x] `npm run build`
   - [ ] local dev server에서 desktop/mobile 시각 확인 `[blocked: existing Next dev lock/PID]`
   - [ ] auth가 필요한 화면은 mock 불가 시 최소 public route와 static state를 먼저 확인

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
- 모바일에서 주요 화면이 깨지지 않고, 작업 화면은 패널 전환이 가능하다.
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
  - `src/components/memory/memory-cluster-list.tsx`
  - `src/components/memory/memory-cluster-empty-state.tsx`
  - `src/components/memory/memory-cluster-detail.tsx`
  - cluster tab을 shadcn `Tabs`로 교체.
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
  - graph/detail 전환을 shadcn `Tabs`로 정리.
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
    - 세션 백업/삭제는 Storage 파일 포함, 메모리 컬렉션 유지.
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
    - representative semantics
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
