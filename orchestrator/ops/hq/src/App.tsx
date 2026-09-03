import { useMemo, useState } from "react";
import { FlowCanvas } from "./FlowCanvas";
import { auditEdges, auditMeta, auditNodes } from "./flows/audit";
import { cycleEdges, cycleMeta, cycleNodes } from "./flows/cycle";
import { releaseEdges, releaseMeta, releaseNodes } from "./flows/release";
import { rolesEdges, rolesMeta, rolesNodes } from "./flows/roles";

const tabs = [
  { id: "cycle", meta: cycleMeta, nodes: cycleNodes, edges: cycleEdges },
  { id: "roles", meta: rolesMeta, nodes: rolesNodes, edges: rolesEdges },
  { id: "release", meta: releaseMeta, nodes: releaseNodes, edges: releaseEdges },
  { id: "audit", meta: auditMeta, nodes: auditNodes, edges: auditEdges },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<TabId>("cycle");
  const active = useMemo(() => tabs.find((t) => t.id === tab) ?? tabs[0], [tab]);

  return (
    <div className="app">
      <header className="topbar">
        <p className="brand">
          Win Predict <span>HQ</span>
        </p>
        <nav className="tabs" aria-label="Схемы">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.meta.label}
            </button>
          ))}
        </nav>
        <p className="hint">Масштаб: scroll · перемещение: drag по холсту</p>
      </header>

      <div className="stage">
        <aside className="aside">
          <p className="label">{active.meta.label}</p>
          <h2>{active.meta.title}</h2>
          <p>{active.meta.lead}</p>
          <ul>
            {active.meta.points.map((point) => (
              <li key={point.title}>
                <strong>{point.title}</strong>
                {point.body}
              </li>
            ))}
          </ul>
        </aside>
        <div className="canvas">
          <FlowCanvas key={active.id} nodes={active.nodes} edges={active.edges} />
        </div>
      </div>
    </div>
  );
}
