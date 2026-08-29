import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "./nodes";

const defaultEdgeOptions = {
  type: "smoothstep" as const,
  animated: true,
  style: { strokeWidth: 1.6 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: "rgba(62, 207, 190, 0.75)",
  },
};

type FlowCanvasProps = {
  nodes: Node[];
  edges: Edge[];
};

export function FlowCanvas({ nodes, edges }: FlowCanvasProps) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.35}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll
      zoomOnScroll
    >
      <Background gap={22} size={1} color="rgba(232, 237, 233, 0.08)" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        maskColor="rgba(12, 16, 22, 0.72)"
        nodeColor={(n) => {
          const tone = (n.data as { tone?: string } | undefined)?.tone;
          if (tone === "warm") return "#d4a15a";
          if (tone === "blue") return "#7aa2d4";
          if (tone === "green") return "#8fb56f";
          if (tone === "rose") return "#d4736a";
          if (tone === "accent") return "#3ecfbe";
          return "#2a3340";
        }}
      />
    </ReactFlow>
  );
}
