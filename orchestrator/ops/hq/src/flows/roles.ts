import type { Edge, Node } from "@xyflow/react";
import type { ActorNodeData, StageNodeData, NoteNodeData } from "../nodes";

type AnyNode =
  | Node<ActorNodeData, "actor">
  | Node<StageNodeData, "stage">
  | Node<NoteNodeData, "note">;

export const rolesNodes: AnyNode[] = [
  {
    id: "human",
    type: "actor",
    position: { x: 80, y: 0 },
    data: {
      title: "Человек",
      body: "Цель, приёмка, «релизь»",
      tone: "warm",
    },
  },
  {
    id: "strategist",
    type: "actor",
    position: { x: 320, y: 0 },
    data: {
      title: "Стратег",
      body: "План и child-задачи",
      tone: "accent",
    },
  },
  {
    id: "workers",
    type: "actor",
    position: { x: 560, y: 0 },
    data: {
      title: "Исполнители",
      body: "Код в нужных репо",
      tone: "blue",
    },
  },
  {
    id: "reviewer",
    type: "actor",
    position: { x: 800, y: 0 },
    data: {
      title: "Ревьюер",
      body: "PR + Playwright по demo",
      tone: "blue",
    },
  },
  {
    id: "watcher",
    type: "actor",
    position: { x: 1040, y: 0 },
    data: {
      title: "Вотчер",
      body: "Доска, sync, merge",
      tone: "green",
    },
  },

  {
    id: "goal",
    type: "stage",
    position: { x: 40, y: 200 },
    data: {
      kicker: "Вход",
      title: "Goal на доске",
      body: "Формулировка и колонка.",
      tone: "warm",
      handles: { target: true, source: true },
    },
  },
  {
    id: "plan",
    type: "stage",
    position: { x: 280, y: 200 },
    data: {
      kicker: "План",
      title: "Разрез на задачи",
      body: "Что, где, в каком порядке.",
      tone: "accent",
    },
  },
  {
    id: "prs",
    type: "stage",
    position: { x: 520, y: 200 },
    data: {
      kicker: "Исполнение",
      title: "PR по репозиториям",
      body: "UI, данные, app, admin…",
      tone: "blue",
    },
  },
  {
    id: "verdict",
    type: "stage",
    position: { x: 760, y: 200 },
    data: {
      kicker: "Контроль",
      title: "pass / changes / blocked",
      body: "До приёмки человеком.",
      tone: "blue",
    },
  },
  {
    id: "ship",
    type: "stage",
    position: { x: 1000, y: 200 },
    data: {
      kicker: "Выход",
      title: "Merge и Done",
      body: "По вашей команде на релиз.",
      tone: "green",
      handles: { target: true, source: false },
    },
  },
  {
    id: "note",
    type: "note",
    position: { x: 400, y: 380 },
    data: {
      title: "Разделение ответственности",
      body: "Люди решают «что» и «можно в прод». Штаб держит ритм между колонками.",
    },
  },
];

export const rolesEdges: Edge[] = [
  { id: "r1", source: "human", target: "goal" },
  { id: "r2", source: "strategist", target: "plan" },
  { id: "r3", source: "workers", target: "prs" },
  { id: "r4", source: "reviewer", target: "verdict" },
  { id: "r5", source: "watcher", target: "ship" },
  { id: "r6", source: "goal", target: "plan" },
  { id: "r7", source: "plan", target: "prs" },
  { id: "r8", source: "prs", target: "verdict", label: "PR" },
  { id: "r9", source: "verdict", target: "ship", label: "ок" },
  {
    id: "r10",
    source: "human",
    target: "ship",
    label: "релизь",
    style: { stroke: "rgba(212, 161, 90, 0.75)" },
    markerEnd: { type: "arrowclosed" as const, color: "rgba(212, 161, 90, 0.9)" },
  },
];

export const rolesMeta = {
  label: "Роли",
  title: "Кто ведёт какой участок",
  lead: "Пять участников: от формулировки цели до merge. Стыки видны на схеме.",
  points: [
    {
      title: "Человек",
      body: "Ставит цель, принимает результат, даёт команду на релиз.",
    },
    {
      title: "Стратег и исполнители",
      body: "Режут работу и делают изменения в репозиториях.",
    },
    {
      title: "Ревьюер и вотчер",
      body: "Визуальная проверка demo, merge и автодеплой web-продуктов.",
    },
  ],
};
