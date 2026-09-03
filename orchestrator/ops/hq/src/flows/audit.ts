import type { Edge, Node } from "@xyflow/react";
import type { StageNodeData, NoteNodeData } from "../nodes";

type AnyNode = Node<StageNodeData, "stage"> | Node<NoteNodeData, "note">;

export const auditNodes: AnyNode[] = [
  {
    id: "timer",
    type: "stage",
    position: { x: 0, y: 120 },
    data: {
      kicker: "Таймер",
      title: "Еженедельный обход prod",
      body: "product-audit.timer — отдельно от очереди Goal.",
      tone: "accent",
      handles: { target: false, source: true },
    },
  },
  {
    id: "walk",
    type: "stage",
    position: { x: 280, y: 120 },
    data: {
      kicker: "Аудитор",
      title: "Playwright по prod URL",
      body: "Маршруты из audit-routes.json, скриншоты и замечания.",
      tone: "blue",
    },
  },
  {
    id: "draft",
    type: "stage",
    position: { x: 560, y: 120 },
    data: {
      kicker: "Inbox",
      title: "Draft Goal на доске",
      body: "Label product-audit + продукт. Оркестратор не стартует.",
      tone: "warm",
    },
  },
  {
    id: "human",
    type: "stage",
    position: { x: 840, y: 120 },
    data: {
      kicker: "Человек",
      title: "Inbox → In Progress",
      body: "Явный жест — только тогда штаб берёт цель в работу.",
      tone: "warm",
    },
  },
  {
    id: "cycle",
    type: "stage",
    position: { x: 1120, y: 120 },
    data: {
      kicker: "Цикл",
      title: "Обычный пайплайн",
      body: "План, PR, preview, ревью, релиз — как на вкладке «Цикл».",
      tone: "green",
      handles: { target: true, source: false },
    },
  },
  {
    id: "note",
    type: "note",
    position: { x: 280, y: 300 },
    data: {
      title: "Параллельный вход",
      body: "Аудит не блокирует текущие Goal. Новые карточки ждут вашего решения в Inbox.",
    },
  },
];

export const auditEdges: Edge[] = [
  { id: "a1", source: "timer", target: "walk" },
  { id: "a2", source: "walk", target: "draft" },
  { id: "a3", source: "draft", target: "human", label: "draft" },
  { id: "a4", source: "human", target: "cycle", label: "жест" },
];

export const auditMeta = {
  label: "Аудит",
  title: "Product-audit: prod → Inbox",
  lead: "Раз в неделю штаб смотрит живой prod и предлагает цели — без автостарта.",
  points: [
    {
      title: "Обход",
      body: "Playwright MCP по настроенным URL каждого продукта.",
    },
    {
      title: "Draft в Inbox",
      body: "Issue создаётся черновиком; оркестратор молчит до In Progress.",
    },
    {
      title: "Human gate",
      body: "Вы решаете, какие находки превращать в полноценную Goal.",
    },
  ],
};
