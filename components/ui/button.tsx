import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ad-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-ad-navy text-white hover:bg-ad-navy-deep",
        accent: "bg-ad-orange text-white hover:bg-ad-orange-dark",
        dark: "bg-ad-navy text-white hover:bg-ad-navy-deep",
        outline: "border border-ad-border text-ad-ink hover:bg-ad-surface",
        onDark: "bg-white text-ad-navy hover:bg-white/90",
        onDarkAccent: "bg-ad-orange text-white hover:bg-ad-orange-dark",
        onDarkOutline: "border border-ad-border-dark text-white hover:bg-white/10",
      },
      size: {
        sm: "h-9 px-4 text-sm",
        md: "h-11 px-5 text-[0.95rem]",
        lg: "h-12 px-7 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

type ButtonProps = VariantProps<typeof buttonVariants> & {
  href?: string;
  className?: string;
  children: React.ReactNode;
  type?: "button" | "submit";
  onClick?: () => void;
  /** Button form only. The base cva class already styles disabled: it just was never
   *  passed through, so every caller needing it hand-rolled its own button. */
  disabled?: boolean;
  /** open the href in a new tab (for PDFs / external links) */
  newTab?: boolean;
};

export function Button({ variant, size, className, href, children, type, onClick, newTab, disabled }: ButtonProps) {
  const cls = cn(buttonVariants({ variant, size }), className);
  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={cls}
        {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </Link>
    );
  }
  return (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
