// The contract between the benchmark and an agent.
//
// An agent gets an Env for one task instance. It can look (screenshot / zoom) and
// act (mouse / keyboard). It never gets access to the page's DOM or JavaScript.

export type Button = 'left' | 'right' | 'middle';

/**
 * Harness action space. Coordinates are CSS pixels of the viewport (identical to
 * screenshot pixels), origin top-left.
 *
 * The pointer travels in a straight line between consecutive positions, and tasks
 * score the whole path, not just the end points.
 */
export type Action =
  | { type: 'move'; x: number; y: number }
  /** Click at (x, y), or at the current pointer position when omitted. count 2 = double-click. */
  | { type: 'click'; x?: number; y?: number; button?: Button; count?: number; modifiers?: string[] }
  | { type: 'mouse_down'; button?: Button }
  | { type: 'mouse_up'; button?: Button }
  /** Press at path[0], move through every point in order, release at the last one. */
  | { type: 'drag'; path: [number, number][]; button?: Button; modifiers?: string[] }
  /** Wheel scroll by (dx, dy) pixels, at (x, y) or at the current pointer position. */
  | { type: 'scroll'; x?: number; y?: number; dx: number; dy: number; modifiers?: string[] }
  | { type: 'type'; text: string }
  /** A key or combination such as "Enter", "Control+Shift+KeyK", "ctrl+a". */
  | { type: 'key'; keys: string; repeat?: number; holdSeconds?: number }
  | { type: 'wait'; seconds: number };

export interface TaskInfo {
  task: string;
  title: string;
  category: string;
  level: number;
  seed: number;
  /** What to do. Also shown in the bar at the top of the page. */
  instruction: string;
  viewport: { width: number; height: number };
  /** Action budget for this episode. */
  maxActions: number;
}

export interface ActResult {
  /** false if the action was rejected (bad coordinates, unknown key, budget exhausted...). */
  ok: boolean;
  error?: string;
  /** true once the episode is over: the task completed itself or the budget ran out. */
  done: boolean;
}

export interface Env {
  readonly task: TaskInfo;
  /** PNG of the viewport, one image pixel per CSS pixel. */
  screenshot(): Promise<Buffer>;
  /** PNG of the region [x0, y0, x1, y1] at up to 2x resolution. */
  zoom(region: [number, number, number, number]): Promise<Buffer>;
  act(action: Action): Promise<ActResult>;
  /** Current pointer position. */
  cursor(): { x: number; y: number };
  readonly done: boolean;
  readonly actionsLeft: number;
  /** Attach agent-side data (token usage, turns, ...) to the episode record. */
  report(data: Record<string, unknown>): void;
  /** Reference solution. Only available to agents that declare `privileged`. */
  solution?(): Promise<Action[]>;
}

export interface Agent {
  readonly name: string;
  /** Privileged agents may read the reference solution (oracle baselines only). */
  readonly privileged?: boolean;
  /** Settings worth recording next to the results (model, effort, ...). */
  describe?(): Record<string, unknown>;
  /**
   * Work on one task instance. Return when finished. May be called concurrently
   * for different episodes, so keep per-episode state local to the call.
   */
  run(env: Env): Promise<void>;
}

export interface TaskStatus {
  done: boolean;
  success: boolean;
  score: number;
  metrics: Record<string, unknown>;
  errors: string[];
}

export type EndedBy = 'task_complete' | 'agent_stopped' | 'budget' | 'timeout' | 'error';

export interface EpisodeResult {
  task: string;
  category: string;
  level: number;
  seed: number;
  instruction: string;
  /** 0..1, continuous. */
  score: number;
  /** Strict pass/fail. */
  success: boolean;
  endedBy: EndedBy;
  error?: string;
  actions: number;
  screenshots: number;
  seconds: number;
  metrics: Record<string, unknown>;
  agent?: Record<string, unknown>;
  /** Episode directory relative to the run directory. */
  dir: string;
}

/** Environment facts every model-driven agent should be told, in the same words. */
export function describeEnvironment(t: TaskInfo): string {
  return [
    'You are operating a computer with a mouse and a keyboard. The screen shows one full-screen page with a single small interaction task.',
    `Task: ${t.instruction}`,
    '',
    'Facts about this environment:',
    `- The screen is ${t.viewport.width}x${t.viewport.height} pixels. Coordinates are screenshot pixels with the origin at the top-left corner.`,
    '- The task instruction is repeated in the dark bar at the top of the screen.',
    '- The pointer is drawn in screenshots as a black arrow; its tip is the pointer position.',
    '- Between two consecutive pointer positions the pointer travels in a straight line, and the whole path it takes can matter, not only where it ends up.',
    `- You have a budget of ${t.maxActions} actions. Screenshots do not count as actions.`,
    '- The episode ends by itself as soon as the task is completed. If you are finished, or cannot make further progress, stop using tools and reply with one short sentence.',
  ].join('\n');
}
