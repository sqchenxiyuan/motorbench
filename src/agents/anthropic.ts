// Claude through the computer-use toolset (computer_toolset_20260801).
//
// The model sees screenshots and calls toolset members (left_click, mouse_move,
// left_click_drag, scroll, type, key, ...). Each member call is translated into a
// harness action. Conversation history is append-only.
import Anthropic from '@anthropic-ai/sdk';
import type { Action, Agent, Env } from '../types.ts';
import { describeEnvironment } from '../types.ts';
import { ActionError } from '../env.ts';
import { parseModifiers } from '../keys.ts';

/** One wheel "click" of the scroll tool, in pixels. */
export const SCROLL_PX_PER_CLICK = 100;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicAgentOptions {
  model?: string;
  effort?: Effort;
  /** Upper bound on model turns per episode. */
  maxTurns?: number;
  /** Injected for tests; defaults to `new Anthropic()` (credentials from the environment). */
  client?: { messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } };
}

/** What a toolset member call asks the harness to do. */
export type Request =
  | { kind: 'action'; action: Action }
  | { kind: 'screenshot' }
  | { kind: 'zoom'; region: [number, number, number, number] }
  | { kind: 'cursor' };

type Input = Record<string, unknown>;

function xy(v: unknown, name: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new ActionError(`${name} must be [x, y]`);
  }
  return [v[0], v[1]];
}

function modifiers(v: unknown): string[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new ActionError('text must be a string of modifier keys');
  try {
    return parseModifiers(v);
  } catch (err) {
    throw new ActionError((err as Error).message);
  }
}

/** Translate one computer-toolset member call into a harness request. Pure; throws ActionError on bad input. */
export function translate(name: string, input: Input): Request {
  const clicks: Record<string, [button: 'left' | 'right' | 'middle', count: number]> = {
    left_click: ['left', 1],
    right_click: ['right', 1],
    middle_click: ['middle', 1],
    double_click: ['left', 2],
    triple_click: ['left', 3],
  };
  if (name in clicks) {
    const [button, count] = clicks[name];
    const action: Action = { type: 'click', button, count, modifiers: modifiers(input.text) };
    if (input.coordinate !== undefined && input.coordinate !== null) [action.x, action.y] = xy(input.coordinate, 'coordinate');
    return { kind: 'action', action };
  }
  switch (name) {
    case 'screenshot':
      return { kind: 'screenshot' };
    case 'cursor_position':
      return { kind: 'cursor' };
    case 'zoom': {
      const r = input.region;
      if (!Array.isArray(r) || r.length !== 4 || !r.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw new ActionError('region must be [x0, y0, x1, y1]');
      }
      return { kind: 'zoom', region: [r[0], r[1], r[2], r[3]] };
    }
    case 'mouse_move': {
      const [x, y] = xy(input.coordinate, 'coordinate');
      return { kind: 'action', action: { type: 'move', x, y } };
    }
    case 'left_click_drag':
      return {
        kind: 'action',
        action: { type: 'drag', path: [xy(input.start_coordinate, 'start_coordinate'), xy(input.coordinate, 'coordinate')], modifiers: modifiers(input.text) },
      };
    case 'left_mouse_down':
      return { kind: 'action', action: { type: 'mouse_down' } };
    case 'left_mouse_up':
      return { kind: 'action', action: { type: 'mouse_up' } };
    case 'scroll': {
      const amount = Number(input.scroll_amount);
      if (!Number.isFinite(amount) || amount < 0) throw new ActionError('scroll_amount must be a non-negative number');
      const px = amount * SCROLL_PX_PER_CLICK;
      const dir: Record<string, [number, number]> = { up: [0, -px], down: [0, px], left: [-px, 0], right: [px, 0] };
      const d = dir[String(input.scroll_direction)];
      if (!d) throw new ActionError('scroll_direction must be up, down, left or right');
      const action: Action = { type: 'scroll', dx: d[0], dy: d[1], modifiers: modifiers(input.text) };
      if (input.coordinate !== undefined && input.coordinate !== null) [action.x, action.y] = xy(input.coordinate, 'coordinate');
      return { kind: 'action', action };
    }
    case 'type':
      if (typeof input.text !== 'string') throw new ActionError('text must be a string');
      return { kind: 'action', action: { type: 'type', text: input.text } };
    case 'key':
      if (typeof input.text !== 'string') throw new ActionError('text must be a key name');
      return { kind: 'action', action: { type: 'key', keys: input.text, repeat: typeof input.repeat === 'number' ? input.repeat : undefined } };
    case 'hold_key':
      if (typeof input.text !== 'string') throw new ActionError('text must be a key name');
      return { kind: 'action', action: { type: 'key', keys: input.text, holdSeconds: Number(input.duration) || 0 } };
    case 'wait':
      return { kind: 'action', action: { type: 'wait', seconds: Number(input.duration) || 0 } };
    default:
      throw new ActionError(`unknown computer tool: ${name}`);
  }
}

const image = (png: Buffer): Anthropic.ImageBlockParam => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
});

export class AnthropicAgent implements Agent {
  readonly name: string;
  private model: string;
  private effort: Effort;
  private maxTurns: number;
  private client: NonNullable<AnthropicAgentOptions['client']> | null;

  constructor(opts: AnthropicAgentOptions = {}) {
    this.model = opts.model ?? 'claude-opus-5-5';
    this.effort = opts.effort ?? 'medium';
    this.maxTurns = opts.maxTurns ?? 60;
    this.client = opts.client ?? null;
    this.name = this.model;
  }

  describe() {
    return {
      provider: 'anthropic',
      model: this.model,
      effort: this.effort,
      tool: 'computer_toolset_20260801',
      max_turns: this.maxTurns,
      scroll_px_per_click: SCROLL_PX_PER_CLICK,
    };
  }

  async run(env: Env): Promise<void> {
    const client = (this.client ??= new Anthropic());
    const usage = { turns: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    let stop = 'max_turns';

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: describeEnvironment(env.task) }, image(await env.screenshot())] },
    ];

    try {
      for (let turn = 0; turn < this.maxTurns; turn++) {
        const response = await client.messages.create({
          model: this.model,
          max_tokens: 16000,
          tools: [{ type: 'computer_toolset_20260801' }],
          output_config: { effort: this.effort },
          cache_control: { type: 'ephemeral' },
          messages,
        });
        usage.turns++;
        usage.input_tokens += response.usage.input_tokens;
        usage.output_tokens += response.usage.output_tokens;
        usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;
        usage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens ?? 0;

        if (response.stop_reason === 'refusal') {
          throw new Error(`the model declined the request (${response.stop_details?.category ?? 'no category'})`);
        }
        messages.push({ role: 'assistant', content: response.content });

        const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (calls.length === 0) {
          stop = response.stop_reason ?? 'end_turn';
          break;
        }
        messages.push({ role: 'user', content: await this.runCalls(env, calls) });
        if (env.done) {
          stop = 'episode_over';
          break;
        }
      }
    } finally {
      env.report({ usage, stop });
    }
  }

  /** Run one turn's tool calls in order. After a failure the rest of the batch is not executed. */
  private async runCalls(env: Env, calls: Anthropic.ToolUseBlock[]): Promise<Anthropic.ToolResultBlockParam[]> {
    const results: Anthropic.ToolResultBlockParam[] = [];
    let skip: string | null = null;
    for (const call of calls) {
      const result: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: call.id };
      if (call.toolset_name) result.toolset_name = call.toolset_name;
      if (skip) {
        result.content = skip;
        result.is_error = true;
      } else {
        try {
          result.content = await this.runCall(env, call);
        } catch (err) {
          if (!(err instanceof ActionError)) throw err;
          result.content = `Error: ${err.message}`;
          result.is_error = true;
          skip = 'Not executed: an earlier computer action in this turn failed.';
        }
        if (env.done) skip = 'Not executed: the episode is over.';
      }
      results.push(result);
    }
    return results;
  }

  private async runCall(env: Env, call: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam['content']> {
    if (call.toolset_name !== 'computer') throw new ActionError(`unknown tool: ${call.name}`);
    const req = translate(call.name, (call.input ?? {}) as Input);
    switch (req.kind) {
      case 'screenshot':
        return [image(await env.screenshot())];
      case 'zoom':
        return [image(await env.zoom(req.region))];
      case 'cursor': {
        const p = env.cursor();
        return `X=${Math.round(p.x)},Y=${Math.round(p.y)}`;
      }
      case 'action': {
        const res = await env.act(req.action);
        if (!res.ok) throw new ActionError(res.error ?? 'action failed');
        return res.done ? 'OK. The episode is over.' : 'OK';
      }
    }
  }
}
