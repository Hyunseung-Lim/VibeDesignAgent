import Image from "next/image";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

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
        className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
      </button>
      {isOpen && (
        <div className="absolute right-0 mt-3 w-64 rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-popover">
          <div className="flex items-center gap-3 border-b border-border pb-3">
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
          <div className="mt-2 space-y-1">
            {isAdmin && (
              <Link
                href="/admin"
                onClick={onClose}
                className={buttonVariants({
                  variant: "ghost",
                  size: "sm",
                  className: "w-full justify-start",
                })}
              >
                관리자 페이지
              </Link>
            )}
            <Button
              onClick={onLogout}
              variant="ghost"
              size="sm"
              className="w-full justify-start"
            >
              로그아웃
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
