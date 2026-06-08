import { UserMenu } from "@/components/lobby/user-menu";

type AppTopbarProps = {
  userEmail: string;
  userName: string;
  userPhoto: string | null;
  userInitial: string;
  isAdmin: boolean;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onLogout: () => void;
};

export function AppTopbar(props: AppTopbarProps) {
  return (
    <div className="sticky top-0 z-10 border-b border-border bg-surface-panel">
      <div className="flex w-full items-center justify-between px-6 py-3 lg:px-10">
        <p className="text-lg font-semibold text-foreground">
          Vibe Design Agent
        </p>
        <UserMenu
          userEmail={props.userEmail}
          userName={props.userName}
          userPhoto={props.userPhoto}
          userInitial={props.userInitial}
          isAdmin={props.isAdmin}
          isOpen={props.isMenuOpen}
          onToggle={props.onToggleMenu}
          onClose={props.onCloseMenu}
          onLogout={props.onLogout}
        />
      </div>
    </div>
  );
}
