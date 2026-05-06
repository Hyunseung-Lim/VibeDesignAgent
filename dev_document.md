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

### 4.2 레퍼런스 (Reference)
- 채팅에서 "레퍼런스 찾아줘" → `[FETCH_REFERENCES: {query}]` 블록 → Serper API로 이미지 검색
- 검색당 3개씩 누적 표시 (삭제 가능, confirm 팝업)
- 레퍼런스 선택(인용) 후 메시지 전송 시 이미지를 base64로 서버에서 변환해 GPT-4o에 전달
- 인용된 레퍼런스 URL도 시스템 컨텍스트로 전달, GPT-4o가 웹 검색으로 방문 가능

### 4.3 아이디어 (Idea)
- 사용자가 직접 마크다운으로 작성 (AI 자동 생성 없음)
- 아이디어 탭별 독립적인 Mockup + Presentation 보유
- 탭 추가/편집/삭제 가능
- 편집 모드: 제목 input + 마크다운 textarea
- 뷰 모드: ReactMarkdown으로 렌더링

### 4.4 목업 (Mockup)
- **생성 조건**: 아이디어가 1개 이상 저장된 경우에만 생성 가능
- **생성 흐름**: 채팅 → GPT-4o가 `[GENERATE_MOCKUP: {prompt}]` 출력 → Google Stitch API 호출 → HTML 반환 → 캔버스에 표시
- **GPT-4o 컨텍스트**: 미션 제목/브리핑, 현재 아이디어 내용, 기존 목업 HTML, 선택된 UI 요소, 인용 레퍼런스, 대화 히스토리
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
- **모델**: OpenAI gpt-4o (Responses API)
- **웹 검색**: `web_search_preview` 툴 상시 활성화, 레퍼런스 URL 인용 시 `tool_choice: "required"`로 강제
- **스트리밍**: SSE 방식으로 실시간 토큰 출력
- **웹 검색 표시**: 검색 발생 시 `[WEB_SEARCHED]` 마커 → "웹 검색 완료" 배지 표시
- **인용 링크**: 웹 검색 출처 `(domain.com)` 자동으로 클릭 가능한 마크다운 링크로 변환
- **특수 블록 처리**:
  - `[GENERATE_MOCKUP: ...]` → Stitch 목업 생성
  - `[EDIT_MOCKUP: ...]` → 목업 수정
  - `[FETCH_REFERENCES: ...]` → Serper 이미지 검색
  - ` ```presentation ... ``` ` → gpt-image-2 프레젠테이션 생성
  - `[WEB_SEARCHED]` → 웹 검색 배지

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
stitchProjectId
updatedAt
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
| `POST /api/references` | Serper 이미지 검색 (3개 반환) |
| `POST /api/presentation` | gpt-image-2/gpt-image-1로 프레젠테이션 이미지 생성 |

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

## 9. 미구현 / 향후 계획

- `/agent` 페이지: 에이전트 메모리/상태 관리 UI
- Firebase Blaze 플랜 결제 시 Storage 완전 활성화
- 반응형/접근성 개선
- E2E 테스트
