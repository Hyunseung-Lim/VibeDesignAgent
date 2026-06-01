# VibeDesign Agent 개발 문서

## 1. 서비스 개요
- **목표**: UI/UX 디자이너가 AI 에이전트와의 대화만으로 디자인 과업을 진행할 수 있게 해주는 협업 연구 도구.
- **핵심 경험**: 사용자는 과업 브리핑 및 피드백을 텍스트 대화로 전달하면 에이전트가 레퍼런스 탐색 → 아이디어 기록 → 목업 생성 → 프레젠테이션 제작까지 수행.
- **연구 목적**: HCI 연구 맥락에서 AI-인간 협업 시 공유 멘탈 모델(shared mental model) 형성 과정 연구.

---

## 2. 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Next.js (App Router), TypeScript |
| 스타일링 | Tailwind CSS v4, @phosphor-icons/react |
| 인증 | Firebase Authentication (Google OAuth) |
| 데이터베이스 | Firebase Firestore |
| 파일 저장소 | Firebase Storage (프레젠테이션 이미지) |
| AI 채팅 | OpenAI Responses API (gpt-4o) + web_search_preview 툴 |
| 목업 생성 | Google Stitch SDK |
| 프레젠테이션 이미지 | OpenAI gpt-image-2 (조직 인증 필요) / gpt-image-1 |
| 이미지 검색 | Serper API (Google 이미지 검색) |
| 마크다운 렌더링 | react-markdown |

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
- 유저 메모리 조회: 버전별 table view, cluster view, CSV/JSON export
- 메모리 cluster view: Elbow K와 LLM K 진단값을 함께 표시

### `/main/[missionId]` — 메인 디자인 세션
- 좌측 패널 (스크롤 가능): Mission → Reference → 아이디어 탭 (Idea/Mockup/Presentation)
- 우측 패널 (고정): AI 에이전트 채팅

### `/agent` — Agent Manage
- Placeholder (향후 에이전트 메모리/상태 관리 예정)

---

## 4. 핵심 기능 상세

### 4.1 미션 (Mission)
- 관리자가 설정한 제목/브리핑/기간/디바이스가 읽기 전용으로 표시
- 수정은 어드민 페이지에서만 가능
- 옵션이 1개뿐인 미션은 세션 로드 시 해당 옵션을 자동 선택하고 `selectedOptionId`, `missionTitle`, `missionBrief`, `selectedDevice`, `timerStartedAt`을 세션 문서에 저장
- 세션 종료 완료 후에는 `status: completed` 기준으로 세션 종료 버튼 비활성화

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
- 아이디어 탭별 독립적인 Mockup + Presentation 보유
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

### 4.5 프레젠테이션 (Presentation)
- **생성 조건**: 해당 아이디어의 목업이 1개 이상 있을 때만 생성 가능
- **생성 흐름**: GPT-4o가 ` ```presentation\n{JSON}\n``` ` 출력 → `/api/presentation` 호출 → gpt-image-2로 1장 이미지 생성 → Firebase Storage 업로드 → URL을 Firestore에 저장
- 1장 이미지로 모든 핵심 내용(문제/해결/디자인/다음 단계) 담음
- Storage 업로드 실패 시 base64 data URI로 세션 내 표시 (폴백)
- 아이디어별 독립 저장

### 4.6 AI 채팅
- **모델**: OpenAI gpt-5.4 (Responses API)
- **웹 검색**: `web_search_preview` 툴 상시 활성화, 레퍼런스 URL 인용 시 `tool_choice: "required"`로 강제
- **스트리밍**: SSE 방식으로 실시간 토큰 출력
- **웹 검색 표시**: 검색 발생 시 `[WEB_SEARCHED]` 마커 → "웹 검색 완료" 배지 표시
- **인용 링크**: 웹 검색 출처 `(domain.com)` 자동으로 클릭 가능한 마크다운 링크로 변환
- **특수 블록 처리**:
  - `[CREATE_NOTE: ...]` → 새 아이디어(시안) 생성
  - `[UPDATE_NOTE: ...]` → 현재 아이디어 내용 업데이트
  - `[CREATE_DESIGN_SPEC: ...]` → 현재 아이디어의 디자인 스타일 정의/교체
  - `[GENERATE_MOCKUP: ...]` → Stitch 목업 생성
  - `[EDIT_MOCKUP: ...]` → 목업 수정
  - `[FETCH_REFERENCES: ...]` → Serper 이미지/큐레이션 검색
  - ` ```presentation ... ``` ` → gpt-image-2 프레젠테이션 생성
  - `[WEB_SEARCHED]` → 웹 검색 배지

### 4.7 메모리 (Memory)
- **생성 단위**: 세션 중 interaction turn마다 `/api/memory/drafts`에서 memory draft 생성
- **확정 시점**: 사용자가 `세션 종료` 버튼을 누르면 `/api/memory/complete-session`에서 draft를 통합해 장기 메모리로 저장
- **버전 관리**: admin memory modal에서 v0.1.0 / v0.1.1 / v0.1.2를 분리 조회
- **현재 활용**: 각 채팅 turn 직전에 `/api/memory/retrieve`로 현재 query와 가까운 memory top 5를 검색해 채팅 context에 주입
- **Legacy**: `GET /api/memory/bootstrap`은 세션 시작 시 memory를 preload하던 구 방식이며, 현재 main client에서는 호출하지 않음
- **Retrieval 쿼리 구성**: `[user text] + Mission: [parentMissionTitle] + Active idea: [description]` — 선택된 옵션 이름(페르소나 등)은 제외해 임베딩 노이즈 방지
- **Admin 관측**: researcher가 user별 memory rows, semantic item, cluster 결과, retrieval log/score delta, forgetting/archive 후보를 확인 가능
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
ideas: Idea[]                  // presentationSlides(Storage URL), presentationHtml 포함
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
  id, html, label, x, y, device, stitchScreenId?, ideaId
}
type Idea = {
  id, title, description,        // description은 마크다운 텍스트
  presentationSlides?,           // Storage URL 배열 (base64 제외)
  presentationHtml?
}
type PresentationSlide = {
  title, content, imageUrl       // Firebase Storage URL
}
```

---

## 6. API Routes

| 경로 | 설명 |
|------|------|
| `POST /api/chat` | GPT-4o 채팅 (Responses API + web_search) |
| `POST /api/stitch` | Google Stitch 목업 생성/편집 |
| `GET /api/stitch/html` | Stitch 스크린 HTML 재조회 |
| `POST /api/references` | Serper 이미지 검색 + 큐레이션 사이트 웹 검색 (3개 반환) |
| `POST /api/presentation` | gpt-image-2/gpt-image-1로 프레젠테이션 이미지 생성 |
| `POST /api/memory/drafts` | interaction turn 단위 memory draft 생성 |
| `POST /api/memory/complete-session` | 세션 종료 시 draft를 장기 메모리로 확정 |
| `GET /api/memory/bootstrap` | Legacy: 세션 시작 시 user memory preload. 현재 main client에서는 미사용 |
| `POST /api/memory/retrieve` | query embedding 기반 memory top 5 검색 및 weight 업데이트 |
| `POST /api/admin/missions` | 미션 생성 (관리자 전용) |
| `GET /api/admin/users/[uid]/memory` | admin memory table 조회 |
| `GET/POST /api/admin/users/[uid]/memory/clusters` | admin memory cluster 캐시 조회/생성 |
| `GET /api/admin/users/[uid]/memory/forgetting` | archive 후보 산출 |
| `PATCH /api/admin/users/[uid]/memory/forgetting` | semantic item soft archive |

---

## 7. 데이터 분석 스크립트 (`scripts/`)

| 스크립트 | 기능 |
|----------|------|
| `export_sessions.py` | 전체 참가자 세션 데이터 + 프레젠테이션 이미지 내보내기 |
| `delete_user_sessions.py` | 특정 사용자 세션 전체 삭제 |

- Firebase Admin SDK 사용 (`vibedesignagent-key.json` 서비스 계정 키 필요)
- 출력: `exports/sessions.json`, `exports/presentations/{email}/{missionTitle}/`

---

## 8. 환경 변수 (`.env`)

```
SERPER_API_KEY
STITCH_API_KEY
OPENAI_API_KEY
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_MEASUREMENT_ID
```

---

## 9. 최근 구현된 변경 사항

### 9.1 메모리 클러스터링 개선
- 기존 고정 `K=10` k-means에서 `K=1..12` 실험 기반으로 변경
- Elbow method로 inertia 감소 곡선의 elbow 지점을 계산
- ClusterLLM 논문 아이디어를 반영해 LLM pairwise category 판단으로 최종 K 선택
- 최종 cluster는 LLM K 기준으로 생성하며, Elbow K는 fallback/tie-breaker로 사용
- Admin UI에서 cluster list, selected cluster detail, Elbow/LLM 진단값 표시
- cluster view 좌/우 패널은 modal 내부에서 독립 스크롤되도록 조정

### 9.2 단일 옵션 미션 세션 종료 버튼
- 옵션이 하나뿐인 새 미션에서 `selectedOptionId`가 없어 세션 종료 버튼이 표시되지 않는 문제 수정
- 단일 옵션 미션은 로드 시 자동 선택하고 세션 문서에 선택 상태와 timer 시작 시간을 저장
- 이미 `status: completed`인 세션은 기존처럼 버튼이 비활성화되고 `세션 종료됨`으로 표시

### 9.3 Memory retrieval MVP
- `/api/memory/complete-session`에서 semantic item별 embedding과 score metadata를 저장
- 기존 v0.1.1 memory 중 metadata가 없는 문서는 `/api/memory/retrieve` 호출 시 lazy backfill
- `/api/memory/retrieve`는 LLM 없이 query embedding과 semantic item embedding의 cosine similarity로 top 5를 선택
- retrieve된 memory는 `usageScore`, `retrievedCount`, `lastRetrievedAt`, `retentionScore`를 업데이트
- top candidate 중 선택되지 않은 memory에는 작은 `decayScore`를 적용해 forgetting 압력을 누적
- retrieval log는 `users/{uid}/memoryRetrievalLogs/{logId}`에 저장
- 메인 채팅 요청 전 현재 user input + mission/idea context를 query로 사용해 retrieve하고, 결과를 해당 turn의 memory context에 주입
- Admin memory modal의 Retrievals 탭에서 query, retrieved memory, similarity, usage/decay/retention score delta를 확인 가능

### 9.4 References API 개선
- **성능**: `Promise.all` 대신 `withConcurrency(tasks, 4)`로 병렬 fetch 수 제한
- **안정성**: `extractFirstJsonArray()` — regex 대신 bracket depth counting 파서로 URL 내 `[]` 포함 케이스 처리
- **보안**: `sanitizeInput(value, maxLength)` 함수로 LLM 입력 길이 제한 및 prompt injection 방지
- **큐레이션 검색**: `inferReferenceMode(query)`로 style/product 모드 분기. style 모드에서 9개 큐레이션 도메인 대상 `site:` Serper 웹 검색 병렬 실행
- **이미지 확보**: 큐레이션 결과는 imageUrl 없이 수집 후 `hydrateReferenceMetadata()`로 og:image fetch
- ID 생성을 `Date.now()`에서 `crypto.randomUUID()`로 교체

### 9.5 로비 이탈 경고 모달
- 세션 미종료 상태(`!sessionCompleted`)에서 로비로 돌아가기 클릭 시 경고 모달 표시
- "메모리 저장이 되지 않을 수 있습니다. 세션 종료 버튼을 먼저 눌러주세요." 안내
- 그래도 나가기 / 취소 두 가지 선택지 제공

### 9.6 목업 생성 시 missionBrief 보완 주입
- `buildMockupPrompt(basePrompt, idea, style, missionBrief)` 함수에 `missionBrief` 파라미터 추가
- 신규 목업 생성(`[GENERATE_MOCKUP]`) 시에만 적용: 아이디어 내용이 300자 미만이면 missionBrief를 프롬프트 말미에 추가
- 목업 편집(`[EDIT_MOCKUP]`)에는 주입 안 함 — 기존 화면 구조를 유지해야 하므로

### 9.7 Memory retrieval 쿼리 개선
- retrieval 쿼리에서 `effectiveMissionTitle`(`parentTitle - optionName` 형태) 대신 `parentMissionTitle`만 사용
- 페르소나 이름("🎬 Daniel Park" 등) 같은 옵션 타이틀이 임베딩 벡터에 노이즈를 추가하는 문제 제거

### 9.8 Memory forgetting/archive MVP
- `GET /api/admin/users/[uid]/memory/forgetting`에서 archive candidate를 산출하고 자동 soft archive
- 후보 기준:
  - v0.1.2 memory `weight < 0.28`
  - memory embedding cosine similarity가 `0.92` 이상인 duplicate pair
- duplicate 후보는 weight와 retrievedCount가 낮은 쪽을 archive target으로 제안
- Admin memory modal의 Forgetting 탭에서 이번 호출에 자동 archive된 item을 확인 가능
- Admin memory modal의 Archived 탭에서 archivedAt, archiveReason, weight metadata 확인 가능
- archive된 memory는 retrieval 대상에서 제외됨

### 9.9 Memory schema v0.1.2
- 새 collection: `users/{uid}/memories_0_1_2`
- interaction turn 1개당 episodic memory는 반드시 1개 생성
- semantic memory는 durable insight가 있을 때만 0~1개 생성
- Episodic/Semantic 생성 input field를 aMem 방식에 맞춰 `action`, `keyword`, `episodic`, `semantic`, `input`, `output`, `link`로 통일
- `importanceScore`, `usageScore`, `decayScore`, `retentionScore` 세부 필드를 hMem 방식의 단일 `weight`로 통합
- retrieval은 v0.1.2를 우선 사용하고, 새 데이터가 없으면 v0.1.1 semanticItems를 fallback adapter로 읽음
- semantic이 있으면 semantic text를 embedding하고, 없으면 episodic text를 embedding fallback으로 사용

---

## 10. 메모리 Retrieval / Forgetting 개발 계획

> **상태**: v0.1.2 기준으로 재정리됨. v0.1.1의 semanticItems/retentionScore 설계는 fallback adapter로만 유지.

### 10.1 목표
- interaction 중 필요한 memory를 vector similarity 기반으로 retrieve
- retrieve 결과를 관측 가능하게 기록해 연구자가 어떤 memory가 사용됐는지 확인
- 사용된 memory는 `weight`를 천천히 강화하고, low-weight 또는 중복 memory는 archive 후보로 낮춤
- 초기에는 hard delete 대신 `archivedAt` 기반 soft archive로 운영

### 10.2 개발 순서

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
query
queryEmbeddingModel
retrievedMemoryIds
similarities
scoreDeltas
missionId
createdAt
```
- admin memory modal의 Retrievals 탭에서 조회 가능

#### 5단계: 가점/감점 시스템
- retrieve된 memory:
```typescript
weightGain = 0.04 / Math.sqrt(retrievedCount + 1)
weight = min(1, weight + weightGain)
retrievedCount += 1
lastRetrievedAt = now
```
- retrieve 후보였지만 선택되지 않은 memory에는 별도 decay를 누적하지 않음
- weight가 너무 빠르게 커지지 않도록 sublinear growth 사용

#### 6단계: 망각 후보 산출
- 구현됨: hard delete 없이 archive candidate를 자동 soft archive
- 후보 기준:
  - weight가 threshold 아래
  - 유사 memory가 더 높은 weight로 존재
- soft archive:
```typescript
archivedAt = now
archiveReason = "low-weight" | "duplicate" | "manual"
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

### 10.3 운영 원칙
- hard delete하지 않는다.
- 연구자가 retrieval, score 변화, archive 결과를 확인할 수 있게 만든다.
- formative 실험 기간이 3일이므로 시간 기반 stale 기준은 자동 archive에 사용하지 않는다.
- memory가 사라지는 것보다 "왜 사라졌는지 설명 가능함"을 우선한다.

---

## 11. 미구현 / 향후 계획

- `/agent` 페이지: 에이전트 메모리/상태 관리 UI
- Firebase Blaze 플랜 결제 시 Storage 완전 활성화
- 반응형/접근성 개선
- E2E 테스트
- Memory forgetting / archive pipeline 자동화
- Forgetting threshold tuning 및 automatic archive feature flag

---

## 12. 메모리 리뷰/온보딩 개선 로드맵

이 섹션은 향후 작업을 하나씩 체크하며 진행하기 위한 실행 문서다. 원칙은 **데이터 계약 → 사용자 리뷰 경험 → 온보딩 입력 모델 → 어드민/UI 정리** 순서로 진행한다.

### 12.1 진행 원칙
- 화면부터 만들기보다 memory/retrieval/review에 필요한 데이터 계약을 먼저 고정한다.
- 사용자에게는 "어떤 기억이 참고되었는지"를 설명 가능하게 보여주고, 연구자에게는 prompt/raw context를 더 자세히 확인할 수 있게 한다.
- 직접 입력 메모리와 interaction에서 학습된 메모리는 source/type을 분리한다.
- table view 제거는 대체 관측 UI가 충분히 생긴 뒤 진행한다.

### 12.2 1단계: 리뷰 기능 데이터 계약 정의
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
  - 이유: 12.3의 핵심은 사용자가 세션과 memory 활용을 이해하는 리뷰 화면이며, rawPrompt debug UI까지 같이 만들면 범위가 커진다.
  - 단, 12.3 구현 중 admin이 최소 확인할 수 있도록 JSON/debug placeholder 또는 임시 raw fetch 경로를 남길 수 있다.

### 12.3 2단계: 사용자 리뷰 화면 구현
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

### 12.4 3단계: 세션 전후 메모리 변화 시각화
- [x] memory view와 session view를 분리
  - memory view: 현재 장기 메모리 중심
  - session view: 특정 세션에서 생성/사용/변경된 메모리 중심
- [ ] 세션 시작 전 memory snapshot 기준 정의
- [x] 세션 중 draft memory 표시
- [x] 세션 종료 후 promoted memory 표시
- [x] duplicate merge/archive 결과 표시
- [ ] 직접 입력 memory와 interaction memory를 다른 배지/색으로 구분

구현 메모:
- `/api/memory/session-summary`에서 session `memoryDrafts`와 `source.missionId`가 현재 mission인 promoted memory를 조회한다.
- 리뷰 모드에서 우측 패널 상단에 **채팅 / 메모리 변화** 탭 바를 추가한다. 탭 바는 `showReviewAnnotations`(리뷰 모드 또는 admin 뷰어)일 때만 표시된다.
- **메모리 변화 탭** 에서 세로 타임라인으로 표시한다. 섹션 구성:
  - `세션 중 참고됨` (파랑 점): `reviewTurns.retrieved` 기반, similarity를 가로 바로 시각화
  - `세션에서 기억됨` (초록 점): promoted memory, weight를 가로 바로 시각화. archived된 항목은 취소선 + 로즈색 보관 사유로 인라인 표시
  - `검토 중인 초안` (회색 빈 원): drafts 있을 때만 표시
- 별도 `보관됨` 섹션을 두지 않고, archived된 promoted memory를 `기억됨` 섹션 안에서 구분한다. (이전 구현의 생성됨/보관됨 중복 문제 해결)
- 채팅 탭으로 돌아갈 때 스크롤 위치를 유지하기 위해 채팅 div를 언마운트하지 않고 `hidden` 클래스로 숨긴다.

#### 추가로 결정 필요
- snapshot을 실제로 저장할지, 기존 로그에서 계산할지
- 직접 입력 memory와 interaction memory 배지/색 구분 (12.4 미완료 항목)

### 12.5 4단계: 채팅 스트리밍/스크롤 UX 개선
- [x] auto-scroll 제거 — 스크롤 위치를 사용자에게 완전히 위임
- [ ] 긴 markdown/table/code block 렌더링 중 레이아웃 점프 확인
- [ ] 채팅 bubble 텍스트 출력 버벅임 원인 분리
  - SSE chunk 빈도
  - React state update 빈도
  - markdown re-render 비용

### 12.6 5단계: 온보딩/직접 입력 메모리 설계
- [x] 모든 세션 시작 시 "나에 대해 알았으면 하는 정보" 입력 UI 추가
- [x] UI 방식 결정 → **세션 시작 modal** 채택
- [x] 직접 입력 메모리 타입 정의
- [x] interaction 학습 메모리와 직접 입력 메모리 구분 처리 (`type: "profile_input"`)
- [x] 이전 세션 입력 내용을 불러와 수정하는 upsert 방식 구현
- [x] 직접 입력값 retrieval 활용 방식 설계
- [ ] revision log 또는 supersedes 정책 결정 (현재는 덮어쓰기)

#### 결정 사항
- **UI**: 세션 시작 modal. `isMissionContextReady` 직후 표시, "세션 시작하기" 버튼 전까지 채팅 블로킹.
- **컬렉션**: `users/{uid}/profile_memories/{missionId}` 별도 문서, `items[]` 배열로 관리.
- **필수/선택**: 매 세션 필수(건너뛰기 없음). 항목이 0개여도 "세션 시작하기" 클릭으로 진행 가능.
- **미션별**: missionId를 문서 ID로 사용하므로 미션마다 독립적인 profile 데이터.
- **weight**: 0.9 고정, retrieval 결과 최상단에 항상 주입 (similarity 계산 없이 포함).

구현 메모:
- `GET /api/memory/profile?missionId=...` — 해당 미션의 profile items 조회
- `POST /api/memory/profile` — items 배열을 upsert (전체 교체)
- `POST /api/memory/retrieve` — profile items를 `type: "profile_input"`으로 retrieved 앞에 prepend
- modal: 기존 items pre-fill, 항목 추가(Enter/버튼)/삭제(X), "세션 시작하기" 클릭 시 저장 후 `profileModalConfirmed = true`

### 12.7 6단계: 직접 입력 메모리 retrieval 정책
- [ ] retrieval quota 정책 결정
  - 예: top 5 중 profile input 최대 2개 + interaction memory 최대 3개
- [ ] profile memory를 항상 주입할지, query similarity 기반으로만 주입할지 결정
- [ ] profile memory의 수정/삭제가 retrieval log에 어떻게 남을지 정의
- [ ] prompt에서 직접 입력 메모리를 별도 섹션으로 표시

### 12.8 7단계: 어드민 정리
- [ ] table view 대체 UI 기준 충족 여부 확인
- [ ] admin table view 제거
- [ ] cluster/retrieval/forgetting/archive 중심으로 admin memory view 재구성
- [ ] raw JSON/export는 필요한 경우 별도 debug drawer로 이동

### 12.9 8단계: 메모리 셀렉터 모듈화와 전체 UI 개선
- [ ] 공통 `MemoryCard` 컴포넌트
- [ ] 공통 `MemorySelector` 컴포넌트
- [ ] 공통 `RetrievedMemoryBadge` 컴포넌트
- [ ] 공통 `PromptViewer` 컴포넌트
- [ ] 공통 `SessionMemoryDiff` 컴포넌트
- [ ] 사용자 뷰와 admin 뷰의 용어/색상/상태 표시 통일
- [ ] 전체 UI polish

### 12.10 우선순위 제안
1. 리뷰 기능 데이터 계약 정의
2. 완료 미션 카드 리뷰 버튼 + 기본 리뷰 화면
3. 채팅 auto-scroll/버벅임 해결
4. 세션별 메모리 변화 시각화
5. 직접 입력 메모리 타입/저장 방식 설계
6. 직접 입력 메모리 retrieval 정책
7. admin table view 제거
8. 메모리 컴포넌트 모듈화와 전체 UI 개선
