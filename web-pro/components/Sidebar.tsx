"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isAvailable, type NavItem } from "@/lib/navigation";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";

type Props = {
  items: NavItem[];
  organizationName: string;
  role: Role;
  userEmail: string;
};

export function Sidebar({ items, organizationName, role, userEmail }: Props) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-surface"
    >
      <div className="border-b border-line px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 shrink-0 rounded-md bg-accent" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{organizationName}</p>
            <p className="truncate text-xs text-ink-faint">{ROLE_LABELS[role]}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} />
              {item.children && item.children.length > 0 && (
                <ul className="mb-1 ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-line pl-2">
                  {item.children.map((child) => (
                    <li key={child.href}>
                      <NavLink item={child} pathname={pathname} small />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="truncate text-xs text-ink-faint" title={userEmail}>
          {userEmail}
        </p>
      </div>
    </nav>
  );
}

function NavLink({
  item,
  pathname,
  small = false,
}: {
  item: NavItem;
  pathname: string;
  small?: boolean;
}) {
  const active = pathname === item.href;
  const size = small ? "text-[13px] py-1.5" : "text-sm py-2";

  // A section whose milestone has not shipped is shown, but not as a
  // link: the shape of the product is useful information, a link to a
  // 404 is not.
  if (!isAvailable(item)) {
    return (
      <span
        className={`flex cursor-default items-center justify-between gap-2 rounded-md px-2.5 ${size} text-ink-faint`}
        title="Module à venir"
      >
        {item.label}
        <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
          à venir
        </span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md px-2.5 ${size} transition-colors ${
        active
          ? "bg-accent-wash font-medium text-accent"
          : "text-ink-soft hover:bg-canvas hover:text-ink"
      }`}
    >
      {item.label}
    </Link>
  );
}
