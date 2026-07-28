export const ADMIN_EMAILS = [
  "03leesun@gmail.com",
  "charlie9807@gmail.com",
  "vivian@u.sogang.ac.kr",
];

// 관리자 뷰에서 완전히 숨길 폐기 계정. Auth 계정이 살아 있어 로그인 때마다
// 빈 프로필이 재생성되는 계정(Suyeon Nam의 옛 kaithape 계정)을 유저 목록과
// 참가자 번호 부여에서 제외한다 — 데이터 삭제와 별개인 표시 차단이라
// 재생성돼도 다시 나타나지 않는다.
export const HIDDEN_ADMIN_VIEW_EMAILS = ["kaithape@gmail.com"];

export function isHiddenAdminViewEmail(email?: string | null) {
  return HIDDEN_ADMIN_VIEW_EMAILS.includes(email ?? "");
}

export function isAdminEmail(email?: string | null) {
  return ADMIN_EMAILS.includes(email ?? "");
}
