import type { ReactNode } from "react";

interface AuthCardProps {
  title: string;
  description: ReactNode;
  icon: ReactNode;
  children: ReactNode;
}

/** Shared shell for the setup and unlock screens. */
export function AuthCard({ title, description, icon, children }: AuthCardProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white">
            {icon}
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
