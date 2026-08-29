import type { Edge, Node } from "@xyflow/react";
import type { StageNodeData, NoteNodeData } from "./nodes";

type StageNode = Node<StageNodeData, "stage">;
type NoteNode = Node<NoteNodeData, "note">;

export const cycleNodes: Array<StageNode | NoteNode> = [
  {
    id: "inbox",
    type: "stage",
    position: { x: 0, y: 120 },
    data: {
      kicker: "Inbox",
      title: "Цель сформулирована",
      body: "Карточка на доске. Штаб ещё не трогает код.",
      tone: "default",
      handles: { target: false, source: true },
    },
  },
  {
    id: "start",
    type: "stage",
    position: { x: 260, y: 120 },
    data: {
      kicker: "Старт",
      title: "Inbox → В работе",
      body: "Или запасной жест /orchestrate на Goal.",
      tone: "accent",
    },
  },
  {
    id: "plan",
    type: "stage",
    position: { x: 520, y: 40 },
    data: {
      kicker: "Стратег",
      title: "План и child-задачи",
      body: "Цель режется на задачи по репозиториям.",
      tone: "warm",
    },
  },
  {
    id: "work",
    type: "stage",
    position: { x: 780, y: 40 },
    data: {
      kicker: "Исполнители",
      title: "Работа в репозиториях",
      body: "Правки, PR, интеграция между модулями.",
      tone: "blue",
    },
  },
  {
    id: "review",
    type: "stage",
    position: { x: 1040, y: 120 },
    data: {
      kicker: "Ревью",
      title: "Проверка PR",
      body: "pass / blocked → колонка Review; changes → снова в работу.",
      tone: "blue",
    },
  },
  {
    id: "accept",
    type: "stage",
    position: { x: 1300, y: 120 },
    data: {
      kicker: "Приёмка",
      title: "Вы смотрите результат",
      body: "Контроль остаётся у человека.",
      tone: "warm",
    },
  },
  {
    id: "release",
    type: "stage",
    position: { x: 1560, y: 40 },
    data: {
      kicker: "Релиз",
      title: "«Релизь» + In Progress",
      body: "Вотчер поднимает версию, мержит, закрывает.",
      tone: "green",
    },
  },
  {
    id: "done",
    type: "stage",
    position: { x: 1820, y: 120 },
    data: {
      kicker: "Done",
      title: "Цель закрыта",
      body: "Карточка в Готово.",
      tone: "green",
      handles: { target: true, source: false },
    },
  },
  {
    id: "fix",
    type: "stage",
    position: { x: 1040, y: 300 },
    data: {
      kicker: "Правки",
      title: "Снова В работе",
      body: "Замечания в issue → возврат карточки → доработка.",
      tone: "rose",
    },
  },
  {
    id: "note",
    type: "note",
    position: { x: 520, y: 280 },
    data: {
      title: "Один жест управления",
      body: "Вы двигаете карточку. Штаб ведёт план, работу и проверки.",
    },
  },
];

export const cycleEdges: Edge[] = [
  { id: "e1", source: "inbox", target: "start", label: "жест" },
  { id: "e2", source: "start", target: "plan" },
  { id: "e3", source: "plan", target: "work" },
  { id: "e4", source: "work", target: "review", label: "PR" },
  { id: "e5", source: "review", target: "accept", label: "pass" },
  {
    id: "e6",
    source: "review",
    target: "fix",
    label: "changes",
    style: { stroke: "rgba(212, 115, 106, 0.7)" },
    markerEnd: { type: "arrowclosed" as const, color: "rgba(212, 115, 106, 0.85)" },
  },
  {
    id: "e7",
    source: "fix",
    target: "work",
    label: "MODE B",
    style: { stroke: "rgba(212, 115, 106, 0.7)" },
    markerEnd: { type: "arrowclosed" as const, color: "rgba(212, 115, 106, 0.85)" },
  },
  { id: "e8", source: "accept", target: "release", label: "релизь" },
  { id: "e9", source: "release", target: "done" },
];

export const cycleMeta = {
  label: "Цикл",
  title: "Жизненный цикл цели",
  lead: "От формулировки до Done — через план, работу, ревью и вашу команду на релиз.",
  points: [
    {
      title: "Старт",
      body: "Карточка Inbox → В работе (или /orchestrate).",
    },
    {
      title: "План и исполнение",
      body: "Стратег режет цель, исполнители открывают PR.",
    },
    {
      title: "Ревью и правки",
      body: "pass ведёт к приёмке; changes возвращают в работу.",
    },
    {
      title: "Релиз",
      body: "Фраза «релизь» + жест на доске закрывает цикл.",
    },
  ],
};
