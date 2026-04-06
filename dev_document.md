# VibeDesign Agent 개발 기획 문서

## 1. 서비스 개요
- **목표**: UI/UX 실무진이 인공지능 에이전트와의 대화만으로 디자인 과업을 진행할 수 있게 해 주는 협업 도구.
- **핵심 경험**: 사용자는 과업을 직접 수행하지 않고, 과업 브리핑 및 피드백을 텍스트 대화로 전달하면 에이전트가 결과물을 생성/관리.
- **주요 사용자 여정**
  - 로그인: 구글 OAuth로 인증 → 개인/팀 단위 세션 식별.
  - 로비: 주차별 과제 리스트 확인, 선택 → 과업 세션 시작. 에이전트 관리 버튼으로 상태/메모리 확인.
  - 메인 스크린: Mission/Reference/Idea 탭 구성, Idea 탭은 Description/Mockup/Presentation 3단 구조. 우측 패널에서 에이전트와 대화하며 결과 업데이트.
  - Agent Manage: 에이전트 메모리, 상태, 최근 활동 기록 열람/관리.
- **비즈니스 요구**
  - 초기 스타트업 팀이 빠르게 디자인 자산을 생산하도록 돕는 MVP.
  - 확장성 있는 구조(추후 다중 에이전트, 과업 자동화) 고려.

## 2. 개발 계획
### 2.1 기술 스택 및 구조
- **프론트엔드**: Next.js 14(App Router), TypeScript, Tailwind CSS. 상태 관리(Zustand/React Query)는 채팅/세션 데이터 연동 시 도입.
- **인증/백엔드 연동**: Firebase Authentication + Google Provider. 추후 API Route(`/api/tasks`, `/api/agent`)와 통합.
- **에이전트 통신**: 초기에는 REST + Firebase auth 토큰 기반. 실시간 스트림 필요 시 SSE/WebSocket으로 확장.
- **디자인 시스템**: Tailwind 디자인 토큰 기반. 로비/메인 공통 레이아웃 컴포넌트화 예정.

### 2.2 구현 현황 & 설계
- **Login Page**
  - Firebase Google 로그인 버튼 완성. 로딩/에러 상태 노출 후 `/lobby`로 이동.
- **Lobby Screen**
  - 상단 고정 Topbar + 프로필 드롭다운(로그아웃). 미션 카드 3열 그리드, 상태 배지, `/main/[missionId]` 라우팅 완료.
  - Agent Actions 섹션에서 “에이전트 메모리 평가” 버튼 제공.
- **Main Screen**
  - Mission/Reference/Idea/Mockup/Presentation 레이아웃 구성. 좌측만 스크롤, 우측 에이전트 패널 고정.
  - 우측 패널 하단 고정 채팅 입력창(최대 3줄). Reference 카드/Idea 탭/History 더미 데이터로 UI 표시.
- **Agent Manage**
  - Placeholder 페이지(스켈레톤) 유지. 로비에서 이동 경로 확보.

### 2.3 향후 계획 (2주 스프린트 예시)
- **스프린트 1**: Firebase auth 연동 QA, 로비 미션 API 연결, 에이전트 관리 UI 퍼스트컷.
- **스프린트 2**: 메인 스크린 동적 데이터·채팅 API, 상태 저장, 반응형/접근성 보완.
- **추가**: AI 백엔드 접속/스트림, 세션 메모리 관리, 테스트 자동화.

## 3. TODO List (업데이트)
1. Firebase 프로젝트 키 환경 변수 정리 및 배포 환경 반영.
2. `/api/missions` 목업 구축 후 로비 미션 리스트 연동.
3. 실사용자 이메일/프로필을 auth 정보에서 받아 상태 관리 훅으로 추출.
4. 에이전트 패널 타임라인/메모리 데이터를 실제 API와 동기화.
5. 메인 스크린 채팅 입력 → 백엔드 호출 → 응답 스트림 표시.
6. Agent Manage 페이지 UI 및 메모리 CRUD 구현.
7. 반응형/키보드 포커스/ARIA 개선.
8. 최소 E2E 플로우 테스트(Login → Lobby → Main → Chat → Logout).
