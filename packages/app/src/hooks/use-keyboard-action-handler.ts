import { useEffect, useRef } from "react";

import {
  keyboardActionDispatcher,
  type KeyboardActionDefinition,
  type KeyboardActionId,
} from "@/keyboard/keyboard-action-dispatcher";

interface UseKeyboardActionHandlerInput {
  handlerId: string;
  actions: readonly KeyboardActionId[];
  enabled: boolean;
  priority: number;
  isActive?: () => boolean;
  handle: (action: KeyboardActionDefinition) => boolean;
}

export function useKeyboardActionHandler(input: UseKeyboardActionHandlerInput) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const actionsKey = input.actions.join("\u0000");

  useEffect(() => {
    return keyboardActionDispatcher.registerHandler({
      handlerId: inputRef.current.handlerId,
      actions: inputRef.current.actions,
      enabled: true,
      priority: inputRef.current.priority,
      isActive: () => {
        const current = inputRef.current;
        return current.enabled && (current.isActive ? current.isActive() : true);
      },
      handle: (action) => inputRef.current.handle(action),
    });
  }, [actionsKey, input.handlerId, input.priority]);
}
