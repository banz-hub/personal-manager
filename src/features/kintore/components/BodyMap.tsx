import type { BodySide, MuscleId } from '../types'
import { muscleName } from '../data/muscles'

interface Props {
  side: BodySide
  selected: MuscleId[]
  onToggle: (muscle: MuscleId) => void
}

/** 各部位を構成する SVG 図形。viewBox は 0 0 200 400 */
type Shape =
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number }
  | { kind: 'path'; d: string }

const FRONT: Array<{ id: MuscleId; shapes: Shape[] }> = [
  {
    id: 'traps',
    shapes: [{ kind: 'path', d: 'M79 74 Q100 58 121 74 L114 85 Q100 77 86 85 Z' }],
  },
  {
    id: 'shoulders',
    shapes: [
      { kind: 'ellipse', cx: 68, cy: 90, rx: 15, ry: 14 },
      { kind: 'ellipse', cx: 132, cy: 90, rx: 15, ry: 14 },
    ],
  },
  {
    id: 'chest',
    shapes: [
      { kind: 'rect', x: 79, y: 82, w: 20, h: 34, r: 8 },
      { kind: 'rect', x: 101, y: 82, w: 20, h: 34, r: 8 },
    ],
  },
  {
    id: 'biceps',
    shapes: [
      { kind: 'ellipse', cx: 60, cy: 122, rx: 10, ry: 24 },
      { kind: 'ellipse', cx: 140, cy: 122, rx: 10, ry: 24 },
    ],
  },
  {
    id: 'forearms',
    shapes: [
      { kind: 'ellipse', cx: 53, cy: 172, rx: 9, ry: 26 },
      { kind: 'ellipse', cx: 147, cy: 172, rx: 9, ry: 26 },
    ],
  },
  {
    id: 'obliques',
    shapes: [
      { kind: 'rect', x: 75, y: 122, w: 9, h: 50, r: 4 },
      { kind: 'rect', x: 116, y: 122, w: 9, h: 50, r: 4 },
    ],
  },
  { id: 'abs', shapes: [{ kind: 'rect', x: 86, y: 120, w: 28, h: 56, r: 6 }] },
  {
    id: 'quads',
    shapes: [
      { kind: 'ellipse', cx: 87, cy: 248, rx: 16, ry: 46 },
      { kind: 'ellipse', cx: 113, cy: 248, rx: 16, ry: 46 },
    ],
  },
  {
    id: 'calves',
    shapes: [
      { kind: 'ellipse', cx: 86, cy: 342, rx: 12, ry: 33 },
      { kind: 'ellipse', cx: 114, cy: 342, rx: 12, ry: 33 },
    ],
  },
]

const BACK: Array<{ id: MuscleId; shapes: Shape[] }> = [
  {
    id: 'traps',
    shapes: [{ kind: 'path', d: 'M76 70 Q100 56 124 70 L118 106 L100 96 L82 106 Z' }],
  },
  {
    id: 'shoulders',
    shapes: [
      { kind: 'ellipse', cx: 68, cy: 92, rx: 15, ry: 14 },
      { kind: 'ellipse', cx: 132, cy: 92, rx: 15, ry: 14 },
    ],
  },
  {
    id: 'lats',
    shapes: [
      { kind: 'path', d: 'M82 100 L98 108 L98 150 L88 158 Q74 138 78 110 Z' },
      { kind: 'path', d: 'M118 100 L102 108 L102 150 L112 158 Q126 138 122 110 Z' },
    ],
  },
  {
    id: 'triceps',
    shapes: [
      { kind: 'ellipse', cx: 60, cy: 122, rx: 10, ry: 24 },
      { kind: 'ellipse', cx: 140, cy: 122, rx: 10, ry: 24 },
    ],
  },
  {
    id: 'forearms',
    shapes: [
      { kind: 'ellipse', cx: 53, cy: 172, rx: 9, ry: 26 },
      { kind: 'ellipse', cx: 147, cy: 172, rx: 9, ry: 26 },
    ],
  },
  { id: 'lowerback', shapes: [{ kind: 'rect', x: 85, y: 152, w: 30, h: 26, r: 6 }] },
  {
    id: 'glutes',
    shapes: [
      { kind: 'ellipse', cx: 88, cy: 194, rx: 17, ry: 18 },
      { kind: 'ellipse', cx: 112, cy: 194, rx: 17, ry: 18 },
    ],
  },
  {
    id: 'hamstrings',
    shapes: [
      { kind: 'ellipse', cx: 87, cy: 252, rx: 16, ry: 42 },
      { kind: 'ellipse', cx: 113, cy: 252, rx: 16, ry: 42 },
    ],
  },
  {
    id: 'calves',
    shapes: [
      { kind: 'ellipse', cx: 86, cy: 342, rx: 12, ry: 33 },
      { kind: 'ellipse', cx: 114, cy: 342, rx: 12, ry: 33 },
    ],
  },
]

function renderShape(shape: Shape, key: number) {
  if (shape.kind === 'ellipse') {
    return <ellipse key={key} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} />
  }
  if (shape.kind === 'rect') {
    return (
      <rect key={key} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.r} />
    )
  }
  return <path key={key} d={shape.d} />
}

/** 選択できない骨格部分 (頭・首・手・膝・足) */
function Skeleton({ side }: { side: BodySide }) {
  return (
    <g className="body-static">
      <ellipse cx={100} cy={30} rx={18} ry={22} />
      <rect x={91} y={48} width={18} height={16} rx={6} />
      <circle cx={51} cy={205} r={8} />
      <circle cx={149} cy={205} r={8} />
      {side === 'front' && <rect x={78} y={178} width={44} height={24} rx={10} />}
      <circle cx={87} cy={300} r={10} />
      <circle cx={113} cy={300} r={10} />
      <ellipse cx={86} cy={381} rx={10} ry={8} />
      <ellipse cx={114} cy={381} rx={10} ry={8} />
    </g>
  )
}

export default function BodyMap({ side, selected, onToggle }: Props) {
  const regions = side === 'front' ? FRONT : BACK
  const selectedSet = new Set(selected)

  return (
    <div className="bodymap">
      <div className="bodymap-label">{side === 'front' ? '前面' : '背面'}</div>
      <svg viewBox="0 0 200 400" role="group" aria-label={`${side === 'front' ? '前面' : '背面'}の部位選択`}>
        <Skeleton side={side} />
        {regions.map((region) => {
          const isSelected = selectedSet.has(region.id)
          return (
            <g
              key={region.id}
              className={`body-region${isSelected ? ' is-selected' : ''}`}
              role="checkbox"
              tabIndex={0}
              aria-checked={isSelected}
              aria-label={muscleName(region.id)}
              onClick={() => onToggle(region.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onToggle(region.id)
                }
              }}
            >
              <title>{muscleName(region.id)}</title>
              {region.shapes.map(renderShape)}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
