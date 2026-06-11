import Image from "next/image";
import Link from "next/link";
import {
  CaretDownIcon,
  SignOutIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";

type UserMenuProps = {
  userEmail: string;
  userName: string;
  userPhoto: string | null;
  userInitial: string;
  isAdmin: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onLogout: () => void;
};

export function UserMenu({
  userEmail,
  userName,
  userPhoto,
  userInitial,
  isAdmin,
  isOpen,
  onToggle,
  onClose,
  onLogout,
}: UserMenuProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-10 items-center gap-2 rounded-full px-1.5 pr-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="사용자 메뉴 열기"
        aria-expanded={isOpen}
      >
        {userPhoto ? (
          <Image
            src={userPhoto}
            alt={userName}
            width={36}
            height={36}
            className="h-9 w-9 rounded-full object-cover"
            unoptimized
            priority
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {userInitial}
          </span>
        )}
        <CaretDownIcon
          size={14}
          weight="bold"
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {isOpen && (
        <div className="absolute right-0 mt-3 w-64 rounded-xl bg-popover p-2 text-sm text-popover-foreground shadow-popover">
          <div className="flex items-center gap-3 px-2 py-2.5">
            {userPhoto ? (
              <Image
                src={userPhoto}
                alt={userName}
                width={40}
                height={40}
                className="h-10 w-10 rounded-full object-cover"
                unoptimized
                priority
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                {userInitial}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {userName}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {userEmail}
              </p>
            </div>
          </div>
          <div className="my-1 h-px bg-border" />
          <div className="space-y-0.5">
            {isAdmin && (
              <Link
                href="/admin"
                onClick={onClose}
                className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ShieldCheckIcon size={16} aria-hidden />
                관리자 페이지
              </Link>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SignOutIcon size={16} aria-hidden />
              로그아웃
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
