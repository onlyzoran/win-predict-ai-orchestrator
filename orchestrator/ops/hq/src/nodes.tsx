import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type Tone = "default" | "accent" | "warm" | "blue" | "green" | "rose";

export type StageNodeData = {
  kicker?: string;
  title: string;
  body?: string;
  tone?: Tone;
  handles?: {
    target?: boolean;
    source?: boolean;
  };
};

function StageNodeComponent({ data }: NodeProps) {
  const d = data as StageNodeData;
  const tone = d.tone ?? "default";
  const showTarget = d.handles?.target !== false;
  const showSource = d.handles?.source !== false;

  return (
    <div className={`node tone-${tone}`}>
      {showTarget ? <Handle className="handle" type="target" position={Position.Left} /> : null}
      {d.kicker ? <div className="node-kicker">{d.kicker}</div> : null}
      <h3 className="node-title">{d.title}</h3>
      {d.body ? <p className="node-body">{d.body}</p> : null}
      {showSource ? <Handle className="handle" type="source" position={Position.Right} /> : null}
    </div>
  );
}

export const StageNode = memo(StageNodeComponent);

export type ActorNodeData = {
  title: string;
  body?: string;
  tone?: Tone;
};

function ActorNodeComponent({ data }: NodeProps) {
  const d = data as ActorNodeData;
  const tone = d.tone ?? "accent";

  return (
    <div className={`node node-actor tone-${tone}`}>
      <Handle className="handle" type="target" position={Position.Top} />
      <h3 className="node-title">{d.title}</h3>
      {d.body ? <p className="node-body">{d.body}</p> : null}
      <Handle className="handle" type="source" position={Position.Bottom} />
    </div>
  );
}

export const ActorNode = memo(ActorNodeComponent);

export type NoteNodeData = {
  title: string;
  body?: string;
};

function NoteNodeComponent({ data }: NodeProps) {
  const d = data as NoteNodeData;

  return (
    <div className="node node-note">
      <div className="node-kicker">Заметка</div>
      <h3 className="node-title">{d.title}</h3>
      {d.body ? <p className="node-body">{d.body}</p> : null}
    </div>
  );
}

export const NoteNode = memo(NoteNodeComponent);

export const nodeTypes = {
  stage: StageNode,
  actor: ActorNode,
  note: NoteNode,
};
