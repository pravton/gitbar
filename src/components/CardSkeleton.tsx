import { cn } from "@/lib/utils";

type Density = "comfortable" | "compact";

interface CardSkeletonProps {
  density?: Density;
}

/**
 * Shimmer placeholder shaped like a real PR/Issue card. Used during the
 * first-paint window before the Rust side has any cached data to show.
 * Respects `prefers-reduced-motion` by dropping the pulse — the static
 * grey bars still convey "something is coming."
 */
export function CardSkeleton({ density = "comfortable" }: CardSkeletonProps) {
  if (density === "compact") {
    return (
      <div
        className="card flex w-full items-center gap-2 px-2 py-1.5"
        aria-hidden
      >
        <SkelBar className="h-2 w-2 rounded-full" />
        <SkelBar className="h-3 w-24" />
        <SkelBar className="h-3 flex-1" />
        <SkelBar className="h-3 w-10" />
      </div>
    );
  }

  return (
    <div className="card w-full" aria-hidden>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <SkelBar className="h-2 w-2 rounded-full" />
          <SkelBar className="h-3 w-32" />
        </div>
        <SkelBar className="h-3 w-10" />
      </div>
      <SkelBar className="mt-3 h-3.5 w-[80%]" />
      <SkelBar className="mt-2 h-2.5 w-40" />
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
        <SkelBar className="h-4 w-20 rounded" />
        <SkelBar className="h-3 w-16" />
      </div>
    </div>
  );
}

function SkelBar({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "block rounded bg-[var(--text-secondary)]/15 motion-safe:animate-pulse",
        className,
      )}
    />
  );
}

interface CardSkeletonListProps {
  count?: number;
  density?: Density;
}

export function CardSkeletonList({ count = 3, density }: CardSkeletonListProps) {
  return (
    <div
      role="status"
      aria-label="Loading GitHub items"
      data-testid="card-skeleton-list"
      className={cn(density === "compact" ? "space-y-0.5" : "space-y-2")}
    >
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} density={density} />
      ))}
    </div>
  );
}
