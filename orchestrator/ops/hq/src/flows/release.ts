import type { Edge, Node } from "@xyflow/react";
import type { StageNodeData, NoteNodeData } from "../nodes";

type AnyNode = Node<StageNodeData, "stage"> | Node<NoteNodeData, "note">;

export const releaseNodes: AnyNode[] = [
  {
    id: "review-col",
    type: "stage",
    position: { x: 0, y: 140 },
    data: {
      kicker: "Review",
      title: "Готово к приёмке",
      body: "Child в Review, PR проверен.",
      tone: "blue",
      handles: { target: false, source: true },
    },
  },
  {
    id: "decision",
    type: "stage",
    position: { x: 280, y: 140 },
    data: {
      kicker: "Жест",
      title: "Review → In Progress",
      body: "Что написали в issue — решает путь.",
      tone: "warm",
    },
  },
  {
    id: "phrase",
    type: "stage",
    position: { x: 560, y: 20 },
    data: {
      kicker: "Релиз",
      title: "«Релизь» / «можно релизить»",
      body: "Явный intent на отправку в прод.",
      tone: "green",
    },
  },
  {
    id: "sync",
    type: "stage",
    position: { x: 560, y: 260 },
    data: {
      kicker: "Без фразы",
      title: "Подтянуть main в PR",
      body: "Проверка актуальности ветки.",
      tone: "accent",
    },
  },
  {
    id: "bump",
    type: "stage",
    position: { x: 840, y: 20 },
    data: {
      kicker: "Вотчер",
      title: "Версия + changelog",
      body: "Bump package.json, подготовка merge.",
      tone: "green",
    },
  },
  {
    id: "ok",
    type: "stage",
    position: { x: 840, y: 200 },
    data: {
      kicker: "Ок",
      title: "Снова Review",
      body: "Конфликта нет — карточка возвращается.",
      tone: "accent",
    },
  },
  {
    id: "conflict",
    type: "stage",
    position: { x: 840, y: 360 },
    data: {
      kicker: "Конфликт",
      title: "Доработка",
      body: "Воркер правит ветку (MODE B).",
      tone: "rose",
    },
  },
  {
    id: "merge",
    type: "stage",
    position: { x: 1120, y: 20 },
    data: {
      kicker: "Merge",
      title: "Squash в main",
      body: "PR закрыт, изменения в базе.",
      tone: "green",
    },
  },
  {
    id: "done",
    type: "stage",
    position: { x: 1400, y: 140 },
    data: {
      kicker: "Done",
      title: "Карточка закрыта",
      body: "Цикл цели завершён.",
      tone: "green",
      handles: { target: true, source: false },
    },
  },
  {
    id: "note",
    type: "note",
    position: { x: 240, y: 400 },
    data: {
      title: "Человек решает «отправляем»",
      body: "Без фразы про релиз штаб только синхронизирует ветку — в прод не пускает.",
    },
  },
];

export const releaseEdges: Edge[] = [
  { id: "x1", source: "review-col", target: "decision" },
  {
    id: "x2",
    source: "decision",
    target: "phrase",
    label: "есть фраза",
    style: { stroke: "rgba(143, 181, 111, 0.75)" },
    markerEnd: { type: "arrowclosed" as const, color: "rgba(143, 181, 111, 0.9)" },
  },
  {
    id: "x3",
    source: "decision",
    target: "sync",
    label: "нет фразы",
  },
  { id: "x4", source: "phrase", target: "bump" },
  { id: "x5", source: "bump", target: "merge" },
  { id: "x6", source: "merge", target: "done" },
  {
    id: "x7",
    source: "sync",
    target: "ok",
    label: "чисто",
  },
  {
    id: "x8",
    source: "sync",
    target: "conflict",
    label: "конфликт",
    style: { stroke: "rgba(212, 115, 106, 0.7)" },
    markerEnd: { type: "arrowclosed" as const, color: "rgba(212, 115, 106, 0.85)" },
  },
  {
    id: "x9",
    source: "ok",
    target: "review-col",
    label: "назад",
    style: { strokeDasharray: "5 4" },
  },
];

export const releaseMeta = {
  label: "Релиз",
  title: "Как карточка уходит в Done",
  lead: "Один и тот же жест на доске — два исхода: релиз или только sync main.",
  points: [
    {
      title: "С фразой",
      body: "«Релизь» → bump → merge → Done.",
    },
    {
      title: "Без фразы",
      body: "Подтянуть main; ок → снова Review; конфликт → доработка.",
    },
    {
      title: "Контроль",
      body: "В прод только после явной команды человека.",
    },
  ],
};
