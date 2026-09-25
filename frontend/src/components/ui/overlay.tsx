import React, { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as RTooltip from "@radix-ui/react-tooltip";
import * as RTabs from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { usePrefs } from "../../lib/prefs";
import { Button } from "./core";

// ---------------------------------------------------------------------------
// Modal (Radix Dialog: focus trap, Esc, aria) styled like aegov-modal
// ---------------------------------------------------------------------------

/**
 * Give focus back to whatever opened a dialog.
 *
 * These dialogs are controlled (`open` comes from state) and have no
 * Dialog.Trigger, so Radix has nothing to return focus to and it falls to
 * <body> -- a keyboard user then starts again from the top of the page after
 * every dialog. Record the focused element just before focus moves in, and
 * restore it on close.
 */
function useRestoreFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (e: Event) => {
      const el = opener.current;
      opener.current = null;
      // Only when the opener is still on the page; otherwise let Radix decide.
      if (el && el.isConnected) {
        e.preventDefault();
        el.focus();
      }
    },
  };
}

export const Modal: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}> = ({ open, onOpenChange, title, description, children, footer, size = "md" }) => {
  const { t } = usePrefs();
  const focus = useRestoreFocus();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-night-950/60 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content
          {...focus}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "surface shadow-2xl animate-slide-up",
            size === "sm" && "max-w-md",
            size === "md" && "max-w-xl",
            size === "lg" && "max-w-3xl",
            size === "xl" && "max-w-5xl"
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-aeblack-100 px-6 py-4">
            <div>
              <Dialog.Title className="font-heading text-lg font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{typeof title === "string" ? title : ""}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button className="rounded-lg p-1.5 muted hover:bg-aeblack-50" aria-label={t("Close", "إغلاق")}>
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-6 py-5 scrollbar-thin">{children}</div>
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-aeblack-100 px-6 py-4">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export const Drawer: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: "md" | "lg";
}> = ({ open, onOpenChange, title, children, footer, width = "lg" }) => {
  const { t, dir } = usePrefs();
  const focus = useRestoreFocus();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-night-950/50 animate-fade-in" />
        <Dialog.Content
          {...focus}
          className={cn(
            "fixed inset-y-0 z-50 flex w-full flex-col bg-whitely-50 shadow-2xl animate-fade-in",
            dir === "rtl" ? "left-0" : "right-0",
            width === "md" ? "max-w-lg" : "max-w-2xl"
          )}
        >
          <div className="flex items-center justify-between gap-4 border-b border-aeblack-100 px-6 py-4">
            <Dialog.Title className="font-heading text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{typeof title === "string" ? title : ""}</Dialog.Description>
            <Dialog.Close asChild>
              <button className="rounded-lg p-1.5 muted hover:bg-aeblack-50" aria-label={t("Close", "إغلاق")}>
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-aeblack-100 px-6 py-4">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export function useConfirm() {
  const [state, setState] = useState<{
    title: string;
    body?: string;
    confirmLabel?: string;
    danger?: boolean;
    resolve?: (ok: boolean) => void;
  } | null>(null);
  const { t } = usePrefs();

  const confirm = (opts: { title: string; body?: string; confirmLabel?: string; danger?: boolean }) =>
    new Promise<boolean>((resolve) => setState({ ...opts, resolve }));

  const close = (ok: boolean) => {
    state?.resolve?.(ok);
    setState(null);
  };

  const element = (
    <Modal
      open={!!state}
      onOpenChange={(o) => !o && close(false)}
      title={state?.title ?? ""}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)}>
            {t("Cancel", "إلغاء")}
          </Button>
          <Button variant={state?.danger ? "danger" : "primary"} onClick={() => close(true)}>
            {state?.confirmLabel ?? t("Confirm", "تأكيد")}
          </Button>
        </>
      }
    >
      {state?.body && <p className="text-sm">{state.body}</p>}
    </Modal>
  );
  return { confirm, element };
}

// ---------------------------------------------------------------------------
// Menus, tooltips, tabs
// ---------------------------------------------------------------------------

export const Menu: React.FC<{
  trigger: React.ReactNode;
  items: ({ label: React.ReactNode; icon?: React.ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | "separator")[];
  align?: "start" | "end";
}> = ({ trigger, items, align = "end" }) => (
  <Dropdown.Root>
    <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={6}
        className="z-50 min-w-48 rounded-xl border border-aeblack-100 bg-whitely-50 p-1.5 shadow-xl animate-fade-in"
      >
        {items.map((item, i) =>
          item === "separator" ? (
            <Dropdown.Separator key={i} className="my-1 h-px bg-aeblack-100" />
          ) : (
            <Dropdown.Item
              key={i}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={cn(
                "flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none",
                "data-[highlighted]:bg-primary-50 data-[disabled]:opacity-40",
                item.danger && "text-aered-600"
              )}
            >
              {item.icon}
              {item.label}
            </Dropdown.Item>
          )
        )}
      </Dropdown.Content>
    </Dropdown.Portal>
  </Dropdown.Root>
);

export const TooltipProvider = RTooltip.Provider;

export const Tooltip: React.FC<{ content: React.ReactNode; children: React.ReactElement }> = ({ content, children }) => (
  <RTooltip.Root delayDuration={250}>
    <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
    <RTooltip.Portal>
      <RTooltip.Content
        sideOffset={6}
        className="z-50 max-w-xs rounded-lg bg-night-900 px-3 py-1.5 text-xs text-white shadow-lg animate-fade-in"
      >
        {content}
        <RTooltip.Arrow className="fill-night-900" />
      </RTooltip.Content>
    </RTooltip.Portal>
  </RTooltip.Root>
);

export interface TabDef {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  count?: number | null;
  content: React.ReactNode;
  hidden?: boolean;
}

export const Tabs: React.FC<{ tabs: TabDef[]; value: string; onValueChange: (v: string) => void; className?: string }> = ({
  tabs,
  value,
  onValueChange,
  className,
}) => {
  const visible = tabs.filter((tb) => !tb.hidden);
  return (
    <RTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <div className="aegov-tab overflow-x-auto scrollbar-thin">
        <RTabs.List className="tab-items gap-6" aria-label="Sections">
          {visible.map((tab) => (
            <RTabs.Trigger
              key={tab.value}
              value={tab.value}
              className={cn("tab-link !py-3 whitespace-nowrap text-sm", value === tab.value && "tab-active")}
            >
              {tab.icon}
              {tab.label}
              {tab.count != null && (
                <span className="rounded-full bg-aeblack-50 px-2 py-0.5 text-xs tabular-nums">{tab.count}</span>
              )}
            </RTabs.Trigger>
          ))}
        </RTabs.List>
      </div>
      {visible.map((tab) => (
        <RTabs.Content key={tab.value} value={tab.value} className="pt-6 outline-none animate-fade-in">
          {tab.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  );
};

export const Segmented: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: React.ReactNode }[];
  className?: string;
}> = ({ value, onChange, options, className }) => (
  <div className={cn("inline-flex rounded-xl bg-aeblack-50 p-1", className)} role="radiogroup">
    {options.map((o) => (
      <button
        key={o.value}
        role="radio"
        aria-checked={value === o.value}
        onClick={() => onChange(o.value)}
        className={cn(
          "rounded-lg px-3 py-1.5 text-sm font-medium transition",
          value === o.value
            ? "bg-whitely-50 text-primary-700 shadow-sm"
            : "muted hover:text-aeblack-900"
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);
