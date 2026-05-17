/**
 * Aetherium Automata - Timeline Panel
 *
 * Top pane: per-deployment automata FSM graph + variables at scrubber position.
 * Bottom pane: multi-track execution trace with transport controls + speed.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAutomataStore, useProjectStore, useRuntimeViewStore } from '../../stores';
import type { Automata } from '../../types/automata';
import type { RuntimeSnapshotPoint } from '../../types/runtimeView';

// ============================================================================
// Palette / constants
// ============================================================================

const LABEL_COL_W = 140;
const RULER_H = 26;
const TRACK_H = 32;
const TRACK_COLORS = [
  '#3d8fe9', '#e96c3d', '#3de98f', '#e9d63d',
  '#c43de9', '#3de9e9', '#e93d7a', '#8fe93d',
];
const SPEED_OPTIONS = [0.1, 0.25, 0.5, 1, 2, 4, 8] as const;

function trackColor(i: number): string {
  return TRACK_COLORS[i % TRACK_COLORS.length] ?? '#3d8fe9';
}

// ============================================================================
// Formatting
// ============================================================================

function fmtRelativeMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const frac = String(Math.floor(ms % 1000)).padStart(3, '0');
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `T+ ${hh}:${mm}:${ss}.${frac}`;
}

function fmtRulerMs(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = (totalSec % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === 'string') return v.slice(0, 24);
  return JSON.stringify(v).slice(0, 24);
}

// ============================================================================
// Snapshot helpers
// ============================================================================

function snapshotAtMs(
  snaps: RuntimeSnapshotPoint[],
  relMs: number,
  startMs: number,
): RuntimeSnapshotPoint | null {
  if (!snaps.length) return null;
  const abs = startMs + relMs;
  let last = snaps[0] ?? null;
  for (const s of snaps) {
    if (s.timestamp <= abs) last = s;
    else break;
  }
  return last;
}

function buildSegments(
  snaps: RuntimeSnapshotPoint[],
  startMs: number,
  durationMs: number,
): Array<{ state: string; relStart: number; relEnd: number }> {
  if (!snaps.length || durationMs <= 0) return [];
  const out: Array<{ state: string; relStart: number; relEnd: number }> = [];
  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i]!;
    const next = snaps[i + 1];
    out.push({
      state: snap.state,
      relStart: snap.timestamp - startMs,
      relEnd: next ? next.timestamp - startMs : durationMs,
    });
  }
  return out;
}

// ============================================================================
// FSM tile (actual automata state machine as SVG)
// ============================================================================

const STATE_W = 80;
const STATE_H = 28;
const ARROW_SZ = 6;

interface FsmTileProps {
  automata: Automata;
  activeState: string | null;
  color: string;
  tileW: number;
  tileH: number;
}

const FsmTile: React.FC<FsmTileProps> = React.memo(({ automata, activeState, color, tileW, tileH }) => {
  const states = useMemo(() => Object.values(automata.states), [automata.states]);
  const transitions = useMemo(() => Object.values(automata.transitions), [automata.transitions]);

  const { scale, offsetX, offsetY } = useMemo(() => {
    const pad = 20;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of states) {
      const { x, y } = s.position ?? { x: 0, y: 0 };
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + STATE_W > maxX) maxX = x + STATE_W;
      if (y + STATE_H > maxY) maxY = y + STATE_H;
    }
    const rawW = maxX - minX || 1;
    const rawH = maxY - minY || 1;
    const availW = tileW - pad * 2;
    const availH = tileH - pad * 2;
    const s = Math.min(availW / rawW, availH / rawH, 1.4);
    return {
      scale: s,
      offsetX: pad + (availW - rawW * s) / 2 - minX * s,
      offsetY: pad + (availH - rawH * s) / 2 - minY * s,
    };
  }, [states, tileW, tileH]);

  const sw = STATE_W * scale;
  const sh = STATE_H * scale;
  const px = (x: number) => x * scale + offsetX;
  const py = (y: number) => y * scale + offsetY;

  const markerId = `arr-${automata.id.replace(/[^a-z0-9]/gi, '_')}`;

  return (
    <svg width={tileW} height={tileH} style={{ display: 'block' }}>
      <defs>
        <marker id={markerId} markerWidth={ARROW_SZ} markerHeight={ARROW_SZ} refX={ARROW_SZ - 1} refY={ARROW_SZ / 2} orient="auto">
          <path d={`M0,0 L${ARROW_SZ},${ARROW_SZ / 2} L0,${ARROW_SZ} Z`} fill="var(--color-text-disabled)" />
        </marker>
      </defs>

      {transitions.map((tr) => {
        const fs = automata.states[tr.from];
        const ts = automata.states[tr.to];
        if (!fs || !ts) return null;
        const fp = fs.position ?? { x: 0, y: 0 };
        const tp = ts.position ?? { x: 0, y: 0 };
        const x1 = px(fp.x) + sw / 2, y1 = py(fp.y) + sh / 2;
        const x2 = px(tp.x) + sw / 2, y2 = py(tp.y) + sh / 2;
        if (tr.from === tr.to) {
          return (
            <path key={tr.id} d={`M${x1 + sw / 2},${y1} C${x1 + sw / 2 + 20},${y1 - 25} ${x1 + sw / 2 + 20},${y1 + 5} ${x1 + sw / 2},${y1}`}
              fill="none" stroke="var(--color-text-disabled)" strokeWidth={1} opacity={0.35} markerEnd={`url(#${markerId})`} />
          );
        }
        const dist = Math.hypot(x2 - x1, y2 - y1);
        if (dist < 2) return null;
        const ux = (x2 - x1) / dist, uy = (y2 - y1) / dist;
        return (
          <line key={tr.id}
            x1={x1 + ux * (sw / 2 + 2)} y1={y1 + uy * (sh / 2 + 2)}
            x2={x2 - ux * (sw / 2 + ARROW_SZ + 2)} y2={y2 - uy * (sh / 2 + ARROW_SZ + 2)}
            stroke="var(--color-text-disabled)" strokeWidth={1} opacity={0.38}
            markerEnd={`url(#${markerId})`}
          />
        );
      })}

      {states.map((s) => {
        const { x, y } = s.position ?? { x: 0, y: 0 };
        const isActive = s.id === activeState || s.name === activeState;
        const isInitial = s.id === automata.initialState;
        const fs = Math.max(7, Math.min(11, sh * 0.45));
        return (
          <g key={s.id}>
            {isInitial && <circle cx={px(x) - 6} cy={py(y) + sh / 2} r={3} fill="var(--color-text-disabled)" opacity={0.5} />}
            <rect x={px(x)} y={py(y)} width={sw} height={sh} rx={sh * 0.28}
              fill={isActive ? color : 'var(--color-bg-3)'}
              stroke={isActive ? color : 'var(--color-border)'}
              strokeWidth={isActive ? 1.5 : 0.8}
              opacity={isActive ? 0.9 : 0.65}
            />
            <text x={px(x) + sw / 2} y={py(y) + sh / 2 + 1}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={fs} fontFamily="monospace"
              fill={isActive ? '#fff' : 'var(--color-text-secondary)'}
              fontWeight={isActive ? 700 : 400}
            >
              {s.name.slice(0, 15)}
            </text>
          </g>
        );
      })}
    </svg>
  );
});

// ============================================================================
// Variables table shown per tile
// ============================================================================

interface VarTableProps {
  variables: Record<string, unknown> | undefined;
  liveVariables: Record<string, unknown> | undefined;
  color: string;
}

const VarTable: React.FC<VarTableProps> = ({ variables, liveVariables, color }) => {
  // Merge: prefer snapshot vars, fall back to live deployment vars
  const vars = variables ?? liveVariables;
  if (!vars || Object.keys(vars).length === 0) return null;

  return (
    <div style={{ borderTop: '1px solid var(--color-border)', padding: '4px 8px', background: 'var(--color-bg-2)' }}>
      <div style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--color-text-disabled)', letterSpacing: '0.06em', marginBottom: 3 }}>
        VARIABLES{!variables && liveVariables ? ' (LIVE)' : ' @ CURSOR'}
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {Object.entries(vars).map(([k, v]) => (
            <tr key={k}>
              <td style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--color-text-secondary)', paddingRight: 6, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 80, textOverflow: 'ellipsis' }}>
                {k}
              </td>
              <td style={{ fontSize: 9, fontFamily: 'monospace', color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {fmtVal(v)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============================================================================
// Graph pane (tiled FSM views)
// ============================================================================

interface GraphTrack {
  deploymentId: string;
  label: string;
  automataName: string;
  networkName: string;
  networkColor: string;
  color: string;
  snaps: RuntimeSnapshotPoint[];
  automata: Automata | undefined;
  liveVariables: Record<string, unknown> | undefined;
  status: string;
  updatedAt: number;
}

interface GraphPaneProps {
  tracks: GraphTrack[];
  scrubberMs: number;
  startMs: number;
  height: number;
  containerW: number;
}

const GraphPane: React.FC<GraphPaneProps> = ({ tracks, scrubberMs, startMs, height, containerW }) => {
  if (tracks.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-disabled)', fontSize: 12, fontFamily: 'monospace' }}>
        No active deployments
      </div>
    );
  }

  const cols = tracks.length === 1 ? 1 : tracks.length <= 4 ? 2 : 3;
  const tileW = Math.floor((containerW - (cols - 1)) / cols);
  // Header: 32px, VarTable: 0-80px, remaining = FSM graph
  const HEADER_H = 32;
  const VAR_H = 80;
  const fsmH = Math.max(80, height - HEADER_H - VAR_H);

  return (
    <div style={{ height, overflowX: 'auto', overflowY: 'hidden', background: 'var(--color-bg-1)', display: 'flex', alignItems: 'flex-start' }}>
      {tracks.map((t) => {
        const snap = snapshotAtMs(t.snaps, scrubberMs, startMs);
        const activeState = snap?.state ?? null;
        return (
          <div key={t.deploymentId} style={{ flexShrink: 0, width: tileW, height, borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ height: HEADER_H, display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', background: 'var(--color-bg-2)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: t.color, flexShrink: 0, opacity: (t.status === 'stopped' || t.status === 'error') ? 0.45 : 1 }} />
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: t.networkColor, fontWeight: 600, background: t.networkColor + '22', padding: '1px 4px', borderRadius: 2, flexShrink: 0 }}>
                {t.networkName.toUpperCase().slice(0, 14)}
              </span>
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.automataName}
              </span>
              {(t.status === 'stopped' || t.status === 'error') && (
                <span style={{ marginLeft: 'auto', fontSize: 8, fontFamily: 'monospace', letterSpacing: '0.08em', color: t.status === 'error' ? '#e93d3d' : '#8fe93d', flexShrink: 0 }}>
                  {t.status === 'error' ? '✕ ERR' : '✓ DONE'}
                </span>
              )}
              {activeState && t.status !== 'stopped' && t.status !== 'error' && (
                <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'monospace', color: t.color, fontWeight: 600, flexShrink: 0 }}>
                  {activeState}
                </span>
              )}
            </div>
            {/* FSM */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative', opacity: (t.status === 'stopped' || t.status === 'error') ? 0.6 : 1 }}>
              {t.automata ? (
                <FsmTile automata={t.automata} activeState={activeState} color={t.color} tileW={tileW} tileH={fsmH} />
              ) : (
                <div style={{ height: fsmH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-disabled)', fontSize: 10, fontFamily: 'monospace' }}>
                  DEFINITION NOT LOADED
                </div>
              )}
            </div>
            {/* Variables */}
            <VarTable variables={snap?.variables} liveVariables={t.liveVariables} color={t.color} />
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// Ruler
// ============================================================================

const Ruler: React.FC<{ durationMs: number; zoom: number; scrollLeft: number; availableWidth: number }> = React.memo(
  ({ durationMs, zoom, scrollLeft, availableWidth }) => {
    const totalPx = availableWidth * zoom;
    const msPerPx = durationMs / Math.max(1, totalPx);
    const visibleMs = availableWidth * msPerPx;
    const firstMs = scrollLeft * msPerPx;

    const target = Math.max(1, Math.floor(availableWidth / 80));
    const rawInterval = visibleMs / target;
    const magnitudes = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000];
    const interval = magnitudes.find((m) => m >= rawInterval) ?? 60000;

    const ticks: Array<{ ms: number; x: number }> = [];
    for (let ms = Math.floor(firstMs / interval) * interval; ms <= firstMs + visibleMs; ms += interval) {
      const x = (ms - firstMs) / msPerPx;
      if (x >= -40 && x <= availableWidth + 10) ticks.push({ ms, x });
    }

    return (
      <div style={{ height: RULER_H, position: 'relative', background: 'var(--color-bg-2)', borderBottom: '1px solid var(--color-border)' }}>
        {ticks.map(({ ms, x }) => (
          <div key={ms} style={{ position: 'absolute', left: x, top: 0, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', pointerEvents: 'none' }}>
            <div style={{ width: 1, height: 8, background: 'var(--color-text-disabled)', marginTop: 4 }} />
            <span style={{ fontSize: 9, color: 'var(--color-text-secondary)', fontFamily: 'monospace', whiteSpace: 'nowrap', paddingLeft: 2, lineHeight: 1.2 }}>
              {fmtRulerMs(ms)}
            </span>
          </div>
        ))}
      </div>
    );
  },
);

// ============================================================================
// Track row
// ============================================================================

const TrackRow: React.FC<{
  label: string;
  segments: Array<{ state: string; relStart: number; relEnd: number }>;
  color: string;
  muted: boolean;
  durationMs: number;
  zoom: number;
  scrollLeft: number;
  availableWidth: number;
  scrubberMs: number;
  onScrub: (ms: number) => void;
  onToggleMute: () => void;
}> = React.memo(({ label, segments, color, muted, durationMs, zoom, scrollLeft, availableWidth, scrubberMs, onScrub, onToggleMute }) => {
  const totalPx = availableWidth * zoom;
  const msPerPx = durationMs / Math.max(1, totalPx);

  const visible = useMemo(() => {
    if (durationMs <= 0) return [];
    return segments
      .filter((seg) => seg.relEnd / msPerPx - scrollLeft > -10 && seg.relStart / msPerPx - scrollLeft < availableWidth + 10)
      .map((seg) => ({ ...seg, xStart: seg.relStart / msPerPx - scrollLeft, xEnd: seg.relEnd / msPerPx - scrollLeft }));
  }, [segments, durationMs, msPerPx, scrollLeft, availableWidth]);

  const scrubX = scrubberMs / msPerPx - scrollLeft;

  return (
    <div style={{ height: TRACK_H, display: 'flex', borderBottom: '1px solid var(--color-border)', opacity: muted ? 0.28 : 1 }}>
      <div style={{ width: LABEL_COL_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', borderRight: '1px solid var(--color-border)', background: 'var(--color-bg-2)' }}>
        <button type="button" onClick={onToggleMute} title={muted ? 'Unmute' : 'Mute'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: muted ? 'var(--color-text-disabled)' : color, fontSize: 10, flexShrink: 0 }}>
          {muted ? '⊘' : '◉'}
        </button>
        <span title={label} style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </div>
      <div
        style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: 'crosshair', background: 'var(--color-bg-1)' }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onScrub((e.clientX - rect.left + scrollLeft) * msPerPx);
        }}
      >
        {visible.map((seg, i) => {
          const w = Math.max(2, seg.xEnd - Math.max(0, seg.xStart));
          return (
            <div key={i} title={seg.state} style={{
              position: 'absolute', left: Math.max(0, seg.xStart), width: w,
              top: 4, height: TRACK_H - 8, background: color, opacity: 0.72,
              borderRadius: 3, overflow: 'hidden', display: 'flex', alignItems: 'center', paddingLeft: 4,
            }}>
              {w > 30 && <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{seg.state}</span>}
            </div>
          );
        })}
        {scrubX >= 0 && scrubX <= availableWidth && (
          <div style={{ position: 'absolute', left: scrubX, top: 0, bottom: 0, width: 1.5, background: 'rgba(255,255,255,0.9)', pointerEvents: 'none' }} />
        )}
      </div>
    </div>
  );
});

// ============================================================================
// Transport bar
// ============================================================================

const btnS: React.CSSProperties = {
  background: 'none', border: '1px solid var(--color-border)',
  borderRadius: 4, cursor: 'pointer', padding: '2px 7px',
  color: 'var(--color-text-primary)', fontSize: 12, lineHeight: 1.4,
};

const TransportBar: React.FC<{
  scrubberMs: number; durationMs: number; isPlaying: boolean; speed: number;
  onPlay: () => void; onStepBack: () => void; onStepForward: () => void;
  onRewind: () => void; onSkipEnd: () => void; onSetSpeed: (s: number) => void;
  zoom: number; onZoom: (z: number) => void;
}> = ({ scrubberMs, isPlaying, speed, onPlay, onStepBack, onStepForward, onRewind, onSkipEnd, onSetSpeed, zoom, onZoom }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--color-bg-2)', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
    <button type="button" onClick={onRewind} title="Rewind" style={btnS}>⏮</button>
    <button type="button" onClick={onStepBack} title="Step back" style={btnS}>⏪</button>
    <button type="button" onClick={onPlay} title={isPlaying ? 'Pause' : 'Play'}
      style={{ ...btnS, background: 'var(--color-primary)', borderColor: 'transparent', borderRadius: '50%', width: 28, height: 28, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
      {isPlaying ? '⏸' : '▶'}
    </button>
    <button type="button" onClick={onStepForward} title="Step forward" style={btnS}>⏩</button>
    <button type="button" onClick={onSkipEnd} title="Skip to end" style={btnS}>⏭</button>

    <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--color-text-primary)', marginLeft: 6, minWidth: 138, letterSpacing: '0.03em' }}>
      {fmtRelativeMs(scrubberMs)}
    </span>

    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 8 }}>
      <span style={{ fontSize: 9, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>SPEED</span>
      {SPEED_OPTIONS.map((s) => (
        <button key={s} type="button" onClick={() => onSetSpeed(s)} title={`${s}× speed`}
          style={{ background: speed === s ? 'var(--color-primary)' : 'none', border: `1px solid ${speed === s ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 3, cursor: 'pointer', padding: '1px 5px', color: speed === s ? '#fff' : 'var(--color-text-secondary)', fontSize: 9, fontFamily: 'monospace' }}>
          {s}×
        </button>
      ))}
    </div>

    <div style={{ flex: 1 }} />
    <span style={{ fontSize: 9, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>ZOOM</span>
    <input type="range" min={20} max={2000} step={5} value={Math.round(zoom * 100)} onChange={(e) => onZoom(Number(e.target.value) / 100)} style={{ width: 80 }} />
    <span style={{ fontSize: 9, color: 'var(--color-text-secondary)', fontFamily: 'monospace', minWidth: 36, textAlign: 'right' }}>{Math.round(zoom * 100)}%</span>
  </div>
);

// ============================================================================
// Timeline Panel (root)
// ============================================================================

export const TimelinePanel: React.FC = () => {
  const deployments = useRuntimeViewStore((s) => s.deployments);
  const snapshots   = useRuntimeViewStore((s) => s.snapshots);
  const project     = useProjectStore((s) => s.project);
  const automataMap = useAutomataStore((s) => s.automata);

  const [zoom, setZoom]             = useState(1);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrubberMs, setScrubberMs] = useState(0);
  const [isPlaying, setIsPlaying]   = useState(false);
  const [speed, setSpeed]           = useState<number>(1);
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [filterLatest, setFilterLatest] = useState(true);
  const [splitRatio, setSplitRatio] = useState(0.52);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const [containerH, setContainerH] = useState(600);
  const [containerW, setContainerW] = useState(900);
  const [trackAreaW, setTrackAreaW] = useState(800);

  const playRef = useRef<{ raf: number; lastTime: number; accumMs: number } | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const durationRef = useRef(0);

  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.target === containerRef.current) { setContainerH(e.contentRect.height); setContainerW(e.contentRect.width); }
        if (e.target === trackAreaRef.current) setTrackAreaW(Math.max(200, e.contentRect.width - LABEL_COL_W));
      }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    if (trackAreaRef.current) obs.observe(trackAreaRef.current);
    return () => obs.disconnect();
  }, []);

  const tracks: GraphTrack[] = useMemo(() => {
    const out: GraphTrack[] = [];
    let idx = 0;

    const networkFor = (automataId: string): { name: string; color: string } => {
      if (project) {
        for (const net of project.networks) {
          if (net.automataIds.includes(automataId)) return { name: net.name, color: net.color ?? '#888' };
        }
      }
      return { name: 'Unassigned', color: '#888' };
    };

    for (const [deploymentId, dep] of deployments) {
      const rawSnaps = snapshots.get(deploymentId) ?? [];
      const sorted = [...rawSnaps].sort((a, b) => a.timestamp - b.timestamp);
      const { name: networkName, color: networkColor } = networkFor(dep.automataId);
      const automata = project?.automata[dep.automataId] ?? automataMap.get(dep.automataId);
      const automataName = automata?.config.name ?? dep.automataId;
      const deviceShort = dep.deviceId.slice(0, 10);

      out.push({
        deploymentId,
        label: `${automataName.slice(0, 14)}@${deviceShort}`,
        automataName,
        networkName,
        networkColor,
        color: trackColor(idx),
        snaps: sorted,
        automata,
        liveVariables: dep.variables,
        status: dep.status,
        updatedAt: dep.updatedAt,
      });
      idx++;
    }
    return out;
  }, [deployments, snapshots, project, automataMap]);

  // When filterLatest is on, keep only the most recently updated track per
  // (automataName, deviceId) group. This hides old deployment attempts that
  // accumulate in the timeline when the same automata is deployed multiple times.
  const filteredTracks = useMemo(() => {
    if (!filterLatest) return tracks;
    const best = new Map<string, GraphTrack>();
    for (const t of tracks) {
      const key = `${t.automataName}\0${t.label.split('@')[1] ?? ''}`;
      const existing = best.get(key);
      if (!existing || t.updatedAt > existing.updatedAt) best.set(key, t);
    }
    return tracks.filter((t) => {
      const key = `${t.automataName}\0${t.label.split('@')[1] ?? ''}`;
      return best.get(key)?.deploymentId === t.deploymentId;
    });
  }, [tracks, filterLatest]);

  const { startMs, durationMs } = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const t of filteredTracks) for (const s of t.snaps) { if (s.timestamp < min) min = s.timestamp; if (s.timestamp > max) max = s.timestamp; }
    if (!Number.isFinite(min)) return { startMs: 0, durationMs: 0 };
    const pad = Math.max(500, (max - min) * 0.04);
    return { startMs: min, durationMs: max - min + pad };
  }, [filteredTracks]);

  durationRef.current = durationMs;

  const trackSegments = useMemo(
    () => new Map(filteredTracks.map((t) => [t.deploymentId, buildSegments(t.snaps, startMs, durationMs)])),
    [filteredTracks, startMs, durationMs],
  );

  // Playback — only pushes to React state at PLAYBACK_FPS to avoid 60fps re-renders
  const stopPlay = useCallback(() => {
    setIsPlaying(false);
    if (playRef.current) { cancelAnimationFrame(playRef.current.raf); playRef.current = null; }
  }, []);

  const startPlay = useCallback(() => {
    setIsPlaying(true);
    const tick = (now: number): void => {
      const ref = playRef.current;
      if (!ref) return;
      const elapsed = (now - ref.lastTime) * speedRef.current;
      ref.lastTime = now;
      ref.accumMs += elapsed;

      if (ref.accumMs >= durationRef.current) {
        setScrubberMs(durationRef.current);
        stopPlay();
        return;
      }

      setScrubberMs(ref.accumMs);
      ref.raf = requestAnimationFrame(tick);
    };
    const now = performance.now();
    playRef.current = { raf: 0, lastTime: now, accumMs: scrubberMs };
    playRef.current.raf = requestAnimationFrame(tick);
  }, [scrubberMs, stopPlay]);

  // Keep accumMs in sync when user scrubs while paused
  const setScrub = useCallback((ms: number) => {
    const clamped = Math.max(0, Math.min(durationMs, ms));
    setScrubberMs(clamped);
    if (playRef.current) playRef.current.accumMs = clamped;
  }, [durationMs]);

  const handlePlay = useCallback(() => { if (isPlaying) stopPlay(); else startPlay(); }, [isPlaying, startPlay, stopPlay]);

  const allEvents = useMemo(() => {
    const times = new Set<number>();
    for (const t of filteredTracks) for (const s of t.snaps) times.add(s.timestamp - startMs);
    return [...times].sort((a, b) => a - b);
  }, [filteredTracks, startMs]);

  const handleStepBack = useCallback(() => {
    const prev = [...allEvents].reverse().find((t) => t < scrubberMs - 1);
    if (prev !== undefined) setScrub(prev);
  }, [allEvents, scrubberMs, setScrub]);

  const handleStepForward = useCallback(() => {
    const next = allEvents.find((t) => t > scrubberMs + 1);
    if (next !== undefined) setScrub(next);
  }, [allEvents, scrubberMs, setScrub]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) setZoom((z) => Math.min(20, Math.max(0.2, z * (e.deltaY < 0 ? 1.12 : 0.89))));
    else setScrollLeft((s) => Math.max(0, s + e.deltaX + e.deltaY));
  }, []);

  const splitterRef = useRef<{ startY: number; startRatio: number } | null>(null);
  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    splitterRef.current = { startY: e.clientY, startRatio: splitRatio };
    const onMove = (ev: MouseEvent): void => {
      if (!splitterRef.current) return;
      setSplitRatio(Math.min(0.85, Math.max(0.15, splitterRef.current.startRatio + (ev.clientY - splitterRef.current.startY) / containerH)));
    };
    const onUp = (): void => { splitterRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [splitRatio, containerH]);

  if (tracks.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--color-text-secondary)', background: 'var(--color-bg-1)' }}>
        <span style={{ fontSize: 36 }}>⏱</span>
        <p style={{ margin: 0, fontSize: 13, fontFamily: 'monospace' }}>No deployments — connect and start an automata to populate the timeline.</p>
      </div>
    );
  }

  const hiddenCount = tracks.length - filteredTracks.length;

  const TRANSPORT_H = 44;
  const SPLITTER_H = 8;
  const graphH = Math.floor(containerH * splitRatio);
  const maxScroll = Math.max(0, trackAreaW * zoom - trackAreaW);

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg-1)' }}>

      {/* ── Graph pane ── */}
      <div style={{ height: graphH, flexShrink: 0, overflow: 'hidden', position: 'relative', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ position: 'absolute', top: 5, left: 8, fontSize: 9, fontFamily: 'monospace', color: 'var(--color-text-disabled)', letterSpacing: '0.07em', zIndex: 2, pointerEvents: 'none' }}>
          AUTOMATA STATE AT CURSOR
        </div>
        <GraphPane tracks={filteredTracks} scrubberMs={scrubberMs} startMs={startMs} height={graphH} containerW={containerW} />
      </div>

      {/* ── Splitter ── */}
      <div onMouseDown={handleSplitterMouseDown} style={{ height: SPLITTER_H, flexShrink: 0, cursor: 'row-resize', background: 'var(--color-bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 3, borderRadius: 2, background: 'var(--color-border)' }} />
      </div>

      {/* ── Transport bar ── */}
      <TransportBar scrubberMs={scrubberMs} durationMs={durationMs} isPlaying={isPlaying} speed={speed}
        onPlay={handlePlay} onStepBack={handleStepBack} onStepForward={handleStepForward}
        onRewind={() => { stopPlay(); setScrub(0); }} onSkipEnd={() => { stopPlay(); setScrub(durationMs); }}
        onSetSpeed={setSpeed} zoom={zoom} onZoom={setZoom} />

      {/* ── Execution trace ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '2px 10px', background: 'var(--color-bg-2)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--color-text-secondary)', letterSpacing: '0.08em', fontWeight: 600 }}>SYSTEM EXECUTION TRACE</span>
          <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--color-text-disabled)', marginLeft: 12 }}>SAMPLE_RATE: realtime</span>
          <div style={{ flex: 1 }} />
          {hiddenCount > 0 && (
            <span style={{ fontSize: 9, color: 'var(--color-text-disabled)', fontFamily: 'monospace', marginRight: 6 }}>
              {hiddenCount} OLDER HIDDEN
            </span>
          )}
          <button type="button"
            onClick={() => setFilterLatest((v) => !v)}
            title={filterLatest ? 'Show all deployment attempts' : 'Show only latest per device'}
            style={{ background: filterLatest ? 'var(--color-primary)' : 'none', border: `1px solid ${filterLatest ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 3, cursor: 'pointer', padding: '1px 6px', color: filterLatest ? '#fff' : 'var(--color-text-secondary)', fontSize: 9, fontFamily: 'monospace', marginRight: 8 }}>
            LATEST ONLY
          </button>
          <span style={{ fontSize: 9, color: 'var(--color-text-disabled)', fontFamily: 'monospace' }}>{filteredTracks.length} TRACK{filteredTracks.length !== 1 ? 'S' : ''}</span>
        </div>

        <div ref={trackAreaRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }} onWheel={handleWheel}>
          {/* Ruler */}
          <div style={{ display: 'flex', flexShrink: 0 }}>
            <div style={{ width: LABEL_COL_W, flexShrink: 0, background: 'var(--color-bg-2)', borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)', height: RULER_H }} />
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {durationMs > 0 && <Ruler durationMs={durationMs} zoom={zoom} scrollLeft={scrollLeft} availableWidth={trackAreaW} />}
            </div>
          </div>

          {/* Tracks */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
            {filteredTracks.map((t) => (
              <TrackRow key={t.deploymentId} label={t.label}
                segments={trackSegments.get(t.deploymentId) ?? []}
                color={t.color} muted={mutedTracks.has(t.deploymentId)}
                durationMs={durationMs} zoom={zoom} scrollLeft={scrollLeft} availableWidth={trackAreaW}
                scrubberMs={scrubberMs}
                onScrub={setScrub}
                onToggleMute={() => setMutedTracks((prev) => { const n = new Set(prev); n.has(t.deploymentId) ? n.delete(t.deploymentId) : n.add(t.deploymentId); return n; })}
              />
            ))}
          </div>
        </div>

        {maxScroll > 0 && (
          <div style={{ display: 'flex', flexShrink: 0, borderTop: '1px solid var(--color-border)' }}>
            <div style={{ width: LABEL_COL_W, flexShrink: 0, background: 'var(--color-bg-2)' }} />
            <input type="range" min={0} max={maxScroll} step={1} value={Math.min(scrollLeft, maxScroll)} onChange={(e) => setScrollLeft(Number(e.target.value))} style={{ flex: 1, margin: '3px 0' }} />
          </div>
        )}
      </div>
    </div>
  );
};
