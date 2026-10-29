import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from "react";

// Единая реализация drag-reorder на Pointer Events — работает и мышью, и тапом
// (Pointer Events унифицируют mouse/touch/pen), без HTML5 DnD (не работает на тач-устройствах).
// Move/up слушаются на window, а не через setPointerCapture на хендле: capture не всегда
// надёжно перенаправляет события при быстром перемещении курсора/пальца далеко от точки
// начала драга, из-за чего события могли "теряться" и порядок не сохранялся.
// Используется на странице тест-плана (порядок кейсов) и тест-рана (порядок результатов).

export interface DragHandleProps {
  onPointerDown: (e: ReactPointerEvent) => void;
  style: CSSProperties;
}

interface UseDragReorder {
  containerRef: RefObject<HTMLDivElement>;
  order: string[];
  draggingId: string | null;
  getHandleProps: (id: string) => DragHandleProps;
}

export function useDragReorder(
  sourceIds: string[],
  onReorder: (ids: string[]) => void,
  disabled = false
): UseDragReorder {
  const [order, setOrder] = useState<string[]>(sourceIds);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const orderRef = useRef<string[]>(sourceIds);
  const draggingRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  // Пока идёт перетаскивание — не перезатираем локальный live-порядок обновлением сверху.
  useEffect(() => {
    if (draggingRef.current) return;
    setOrder(sourceIds);
    orderRef.current = sourceIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIds.join("|")]);

  const moveTo = useCallback((draggedId: string, hoverId: string) => {
    if (draggedId === hoverId) return;
    setOrder((prev) => {
      if (!prev.includes(hoverId) || !prev.includes(draggedId)) return prev;
      const next = [...prev];
      const from = next.indexOf(draggedId);
      next.splice(from, 1);
      const to = next.indexOf(hoverId);
      next.splice(to, 0, draggedId);
      orderRef.current = next;
      return next;
    });
  }, []);

  // Слушатели вешаются на window ровно на время активного драга — так move/up
  // долетают независимо от того, какой элемент физически находится под курсором/пальцем.
  useEffect(() => {
    if (!draggingId || !containerRef.current) return;
    const container = containerRef.current;

    const handleMove = (e: PointerEvent) => {
      const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-drag-id]"));
      for (const row of rows) {
        const rid = row.dataset.dragId;
        if (!rid || rid === draggingId) continue;
        const rect = row.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          moveTo(draggingId, rid);
          break;
        }
      }
    };

    const handleUp = () => {
      draggingRef.current = null;
      setDraggingId(null);
      onReorderRef.current(orderRef.current);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [draggingId, moveTo]);

  const getHandleProps = useCallback(
    (id: string): DragHandleProps => ({
      onPointerDown: (e) => {
        if (disabled) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        draggingRef.current = id;
        setDraggingId(id);
        e.preventDefault();
      },
      style: { touchAction: "none", cursor: disabled ? "default" : "grab" },
    }),
    [disabled]
  );

  return { containerRef, order, draggingId, getHandleProps };
}
