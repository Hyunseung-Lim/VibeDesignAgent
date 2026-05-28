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
- **버전 관리**: admin memory modal에서 v0.1.0 / v0.1.1을 분리 조회
- **현재 활용**: 세션 시작 시 `/api/memory/bootstrap`으로 memory를 로드하고, 각 채팅 turn 직전에 `/api/memory/retrieve`로 현재 query와 가까운 semantic memory top 5를 검색해 채팅 context에 주입
- **Retrieval 쿼리 구성**: `[user text] + Mission: [parentMissionTitle] + Active idea: [description]` — 선택된 옵션 이름(페르소나 등)은 제외해 임베딩 노이즈 방지
- **Admin 관측**: researcher가 user별 memory rows, semantic item, cluster 결과, retrieval log/score delta, forgetting/archive 후보를 확인 가능
- **Retrieval MVP**: semantic memory item에 embedding과 score metadata를 저장하고, retrieve된 item은 usage score를 천천히 올리며 candidate pool의 미선택 item에는 작은 decay를 적용
- **Forgetting MVP**: 자동 삭제 없이 low retention/stale/duplicate 후보를 표시하고, researcher가 선택한 semantic item만 `archivedAt` 기반으로 soft archive

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
| `GET /api/memory/bootstrap` | 세션 시작 시 user memory 로드 |
| `POST /api/memory/retrieve` | query embedding 기반 semantic memory top 5 검색 및 retrieval score 업데이트 |
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
  - `retentionScore < 0.28`
  - semantic embedding cosine similarity가 `0.92` 이상인 duplicate pair
- duplicate 후보는 retentionScore와 retrievedCount가 낮은 쪽을 archive target으로 제안
- Admin memory modal의 Forgetting 탭에서 이번 호출에 자동 archive된 item을 확인 가능
- Admin memory modal의 Archived 탭에서 archivedAt, archiveReason, score metadata 확인 가능
- archive된 semantic item은 retrieval 대상에서 제외됨

---

## 10. 메모리 Retrieval / Forgetting 개발 계획

> **상태**: 1~7단계 모두 구현 완료. 실제 구현 내용은 9.3, 9.4(현 9.8) 참조. 아래는 설계 기록으로 보존.

### 10.1 목표
- 세션 시작 또는 interaction 중 필요한 memory를 vector similarity 기반으로 retrieve
- retrieve 결과를 관측 가능하게 기록해 연구자가 어떤 memory가 사용됐는지 확인
- 사용된 memory는 천천히 강화하고, low-retention 또는 중복 memory는 archive 후보로 낮춤
- 초기에는 hard delete 대신 `archivedAt` 기반 soft archive로 운영

### 10.2 개발 순서

#### 1단계: Memory metadata 확장
- semantic memory item마다 관리용 metadata 추가
```typescript
importanceScore: number
usageScore: number
decayScore: number
retentionScore: number
lastRetrievedAt: number | null
retrievedCount: number
createdAt: number
updatedAt: number
embedding?: number[]
duplicateOf?: string | null
archivedAt?: number | null
archiveReason?: string | null
```
- 기존 memory row와 호환되도록 optional field로 시작
- 점수는 바로 의사결정에 쓰기보다 admin에서 먼저 관측

#### 2단계: Memory embedding 저장
- `/api/memory/complete-session`에서 semantic memory 확정 시 embedding 생성
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
usageGain = 0.03 / Math.sqrt(retrievedCount + 1)
usageScore += usageGain
retrievedCount += 1
lastRetrievedAt = now
```
- retrieve 후보였지만 선택되지 않은 memory는 아주 작은 decay만 적용
- score가 너무 빠르게 커지지 않도록 sublinear growth 사용
- 최종 점수 예시:
```typescript
retentionScore =
  importanceScore +
  usageScore +
  recencyBoost -
  ageDecay -
  redundancyPenalty
```

#### 6단계: 망각 후보 산출
- 구현됨: hard delete 없이 archive candidate를 자동 soft archive
- 후보 기준:
  - retentionScore가 threshold 아래
  - 유사 semantic memory가 더 높은 retentionScore로 존재
- soft archive:
```typescript
archivedAt = now
archiveReason = "low-retention" | "duplicate" | "manual"
```

#### 7단계: 중복 semantic 정리
- 구현됨: cosine similarity가 높은 memory pair를 duplicate candidate로 표시
- 초기 threshold 후보: `similarity > 0.92`
- 남길 memory 기준:
  - retentionScore가 높은 것
  - 최근 retrieve된 것
  - 더 구체적이고 긴 semantic
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
