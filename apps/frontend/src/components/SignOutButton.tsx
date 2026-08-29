export interface SignOutButtonProps {
  onSignOut: () => void;
}

/** Footer-link sign-out action for AuthShell screens without app navigation. */
export function SignOutButton({ onSignOut }: SignOutButtonProps) {
  return (
    <button
      className="font-medium text-accent-700 hover:underline"
      type="button"
      onClick={onSignOut}
    >
      Sign out
    </button>
  );
}
