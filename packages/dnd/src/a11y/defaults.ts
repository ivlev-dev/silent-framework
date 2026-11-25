import type {
  Announcements,
  ScreenReaderInstructions,
} from "../core/types.js";

/**
 * Объявления по умолчанию для `aria-live`-региона.
 *
 * Сообщения строятся по идентификаторам, поэтому не зависят от разметки
 * приложения и работают для любых типов элементов.
 */
export const defaultAnnouncements: Announcements = {
  onDragStart({ active }) {
    return `Захвачен элемент ${String(active.id)}.`;
  },
  onDragOver({ active, over }) {
    if (over === null) {
      return undefined;
    }
    return `Элемент ${String(active.id)} над ${String(over.id)}.`;
  },
  onDragEnd({ active, over }) {
    if (over === null) {
      return `Элемент ${String(active.id)} отпущен.`;
    }
    return `Элемент ${String(active.id)} опущен над ${String(over.id)}.`;
  },
  onDragCancel({ active }) {
    return `Перетаскивание элемента ${String(active.id)} отменено.`;
  },
};

/** Инструкции для `aria-describedby` перетаскиваемого элемента. */
export const defaultScreenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    "Чтобы начать перетаскивание, нажмите пробел или Enter. "
    + "Перемещайте элемент стрелками, пробел или Enter завершает, Escape отменяет.",
};

/** Объединяет пользовательские объявления с набором по умолчанию. */
export function resolveAnnouncements(
  overrides: Partial<Announcements> | undefined,
): Announcements {
  if (overrides === undefined) {
    return defaultAnnouncements;
  }
  const resolved: Announcements = {
    onDragStart: overrides.onDragStart ?? defaultAnnouncements.onDragStart,
  };
  if (overrides.onDragMove !== undefined) {
    resolved.onDragMove = overrides.onDragMove;
  }
  if (overrides.onDragOver !== undefined) {
    resolved.onDragOver = overrides.onDragOver;
  }
  if (overrides.onDragEnd !== undefined) {
    resolved.onDragEnd = overrides.onDragEnd;
  }
  if (overrides.onDragCancel !== undefined) {
    resolved.onDragCancel = overrides.onDragCancel;
  }
  return resolved;
}

/** Объединяет пользовательские инструкции с набором по умолчанию. */
export function resolveInstructions(
  overrides: ScreenReaderInstructions | undefined,
): ScreenReaderInstructions {
  if (overrides === undefined) {
    return defaultScreenReaderInstructions;
  }
  return { draggable: overrides.draggable };
}
