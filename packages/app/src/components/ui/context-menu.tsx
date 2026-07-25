import type { ComponentProps, ReactElement } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  type ActionStatus,
} from "./dropdown-menu";

export type { ActionStatus };
export const ContextMenu = DropdownMenu;
export const ContextMenuItem = DropdownMenuItem;
export const ContextMenuLabel = DropdownMenuLabel;
export const ContextMenuSeparator = DropdownMenuSeparator;
export const ContextMenuHint = DropdownMenuHint;

export function ContextMenuTrigger({
  enabled = true,
  enabledOnMobile = false,
  enabledOnWeb = true,
  longPressDelayMs: _longPressDelayMs,
  ...props
}: ComponentProps<typeof DropdownMenuTrigger> & {
  enabled?: boolean;
  enabledOnMobile?: boolean;
  enabledOnWeb?: boolean;
  longPressDelayMs?: number;
}): ReactElement {
  const active = enabled && enabledOnWeb;
  void enabledOnMobile;
  return (
    <DropdownMenuTrigger {...props} activation="context" disabled={props.disabled || !active} />
  );
}

export function ContextMenuContent(
  props: ComponentProps<typeof DropdownMenuContent> & {
    mobileMode?: "dropdown" | "sheet";
  },
): ReactElement | null {
  const { mobileMode: _mobileMode, ...contentProps } = props;
  return <DropdownMenuContent {...contentProps} motion="fade" scrollable />;
}
