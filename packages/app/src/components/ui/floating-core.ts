import { useCallback, useState } from "react";
import type { View } from "react-native";

export type FloatingSide = "top" | "bottom" | "left" | "right";
export type FloatingAlign = "start" | "center" | "end";

export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export function useControllableOpenState({
  open,
  defaultOpen,
  onOpenChange,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}): [boolean, (next: boolean) => void] {
  const [internalOpen, setInternalOpen] = useState(Boolean(defaultOpen));
  const isControlled = typeof open === "boolean";
  const setValue = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  return [isControlled ? open : internalOpen, setValue];
}

export function measureFloatingElement(element: View): Promise<FloatingRect> {
  return new Promise((resolve) => {
    element.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });
}

export function computeFloatingPosition({
  triggerRect,
  contentSize,
  displayArea,
  side,
  align,
  offset,
  flipHorizontal = true,
  alignHorizontalSides = true,
}: {
  triggerRect: FloatingRect;
  contentSize: FloatingSize;
  displayArea: FloatingRect;
  side: FloatingSide;
  align: FloatingAlign;
  offset: number;
  flipHorizontal?: boolean;
  alignHorizontalSides?: boolean;
}): { x: number; y: number; actualSide: FloatingSide } {
  const spaceTop = triggerRect.y - displayArea.y;
  const spaceBottom = displayArea.y + displayArea.height - triggerRect.y - triggerRect.height;
  const spaceLeft = triggerRect.x - displayArea.x;
  const spaceRight = displayArea.x + displayArea.width - triggerRect.x - triggerRect.width;
  let actualSide = side;
  if (side === "bottom" && spaceBottom < contentSize.height && spaceTop > spaceBottom) {
    actualSide = "top";
  } else if (side === "top" && spaceTop < contentSize.height && spaceBottom > spaceTop) {
    actualSide = "bottom";
  } else if (
    flipHorizontal &&
    side === "left" &&
    spaceLeft < contentSize.width &&
    spaceRight > spaceLeft
  ) {
    actualSide = "right";
  } else if (
    flipHorizontal &&
    side === "right" &&
    spaceRight < contentSize.width &&
    spaceLeft > spaceRight
  ) {
    actualSide = "left";
  }

  const alignCoordinate = (start: number, size: number, content: number) =>
    align === "start"
      ? start
      : align === "end"
        ? start + size - content
        : start + (size - content) / 2;
  let x: number;
  let y: number;
  if (actualSide === "bottom" || actualSide === "top") {
    x = alignCoordinate(triggerRect.x, triggerRect.width, contentSize.width);
    y =
      actualSide === "bottom"
        ? triggerRect.y + triggerRect.height + offset
        : triggerRect.y - contentSize.height - offset;
  } else {
    x =
      actualSide === "left"
        ? triggerRect.x - contentSize.width - offset
        : triggerRect.x + triggerRect.width + offset;
    y = alignHorizontalSides
      ? alignCoordinate(triggerRect.y, triggerRect.height, contentSize.height)
      : triggerRect.y;
  }

  const padding = 8;
  return {
    x: Math.max(padding, Math.min(displayArea.width - contentSize.width - padding, x)),
    y: Math.max(
      displayArea.y + padding,
      Math.min(displayArea.y + displayArea.height - contentSize.height - padding, y),
    ),
    actualSide,
  };
}
