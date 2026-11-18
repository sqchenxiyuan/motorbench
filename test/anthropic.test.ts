// The Claude adapter, exercised against real task pages with a scripted stand-in for
// the API (no network, no credentials).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { Bench } from '../src/session.ts';
import { AnthropicAgent, translate } from '../src/agents/anthropic.ts';
import type { Action } from '../src/types.ts';

let bench: Bench;
before(async () => {
  bench = await Bench.start();
});
after(() => bench.close());

type Params = Anthropic.MessageCreateParamsNonStreaming;
type Turn = (params: Params) => unknown[];

let ids = 0;
const call = (name: string, input: Record<string, unknown> = {}) => ({ type: 'tool_use', id: `toolu_${++ids}`, name, toolset_name: 'computer', input });
const say = (text: string) => ({ type: 'text', text });

/** A fake Messages API that plays back scripted turns and records the requests it got. */
function scripted(turns: Turn[]) {
  const requests: Params[] = [];
  const client = {
    messages: {
      async create(params: Params) {
        requests.push(structuredClone(params));
        const content = turns[requests.length - 1](params);
        const usesTools = content.some((b) => (b as { type: string }).type === 'tool_use');
        return {
          id: `msg_${requests.length}`,
          type: 'message',
          role: 'assistant',
          model: params.model,
          content,
          stop_reason: usesTools ? 'tool_use' : 'end_turn',
          usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 },
        } as unknown as Anthropic.Message;
      },
    },
  };
  return { client, requests };
}

async function solution(task: string, level: number, seed: number): Promise<Action[]> {
  const ep = await bench.open({ task, level, seed }, { privileged: true });
  try {
    return await ep.env.solution!();
  } finally {
    await ep.close();
  }
}

const results = (req: Params) => (req.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]).filter((b) => b.type === 'tool_result');

test('a click from the model completes the task and ends the loop', async () => {
  const [click] = (await solution('click', 2, 3)) as Extract<Action, { type: 'click' }>[];
  const { client, requests } = scripted([() => [say('Clicking the blue circle.'), call('left_click', { coordinate: [click.x, click.y] })]]);
  const ep = await bench.open({ task: 'click', level: 2, seed: 3 });
  try {
    await new AnthropicAgent({ client, model: 'test-model' }).run(ep.env);
    const { status } = await ep.finish();
    assert.equal(status.success, true);
    assert.equal(requests.length, 1, 'no further request once the episode is over');

    const req = requests[0];
    assert.deepEqual(req.tools, [{ type: 'computer_toolset_20260801' }]);
    assert.equal(req.model, 'test-model');
    const first = req.messages[0].content as Anthropic.ContentBlockParam[];
    assert.equal(first[0].type, 'text');
    assert.match((first[0] as Anthropic.TextBlockParam).text, /Click the blue circle\./);
    assert.equal(first[1].type, 'image');
    assert.deepEqual(ep.env.reported.usage, { turns: 1, input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 });
    assert.equal(ep.env.reported.stop, 'episode_over');
  } finally {
    await ep.close();
  }
});

test('screenshots, batched actions and tool results round-trip correctly', async () => {
  const sol = await solution('type-text', 1, 4);
  const click = sol[0] as Extract<Action, { type: 'click' }>;
  const text = (sol[1] as Extract<Action, { type: 'type' }>).text;
  const { client, requests } = scripted([
    () => [call('screenshot'), call('cursor_position')],
    () => [call('left_click', { coordinate: [click.x, click.y] }), call('type', { text })],
  ]);
  const ep = await bench.open({ task: 'type-text', level: 1, seed: 4 });
  try {
    await new AnthropicAgent({ client }).run(ep.env);
    assert.equal((await ep.finish()).status.success, true);

    // Second request: history is [user, assistant, user(tool results)].
    assert.equal(requests[1].messages.length, 3);
    assert.equal(requests[1].messages[1].role, 'assistant');
    const [shot, cursor] = results(requests[1]);
    assert.equal(shot.toolset_name, 'computer');
    assert.equal((shot.content as Anthropic.ImageBlockParam[])[0].type, 'image');
    assert.equal(cursor.toolset_name, 'computer');
    assert.match(cursor.content as string, /^X=\d+,Y=\d+$/);
    assert.equal(shot.tool_use_id, (requests[1].messages[1].content as Anthropic.ToolUseBlockParam[])[0].id);
  } finally {
    await ep.close();
  }
});

test('a failed action is reported and halts the rest of the batch', async () => {
  const { client, requests } = scripted([
    () => [call('left_click', { coordinate: [99999, 10] }), call('left_click', { coordinate: [300, 300] }), call('nonsense')],
    () => [say('I give up.')],
  ]);
  const ep = await bench.open({ task: 'click', level: 1, seed: 1 });
  try {
    await new AnthropicAgent({ client }).run(ep.env);
    const [bad, skipped, alsoSkipped] = results(requests[1]);
    assert.equal(bad.is_error, true);
    assert.match(bad.content as string, /outside the 1280x800 screen/);
    assert.equal(skipped.is_error, true);
    assert.match(skipped.content as string, /Not executed/);
    assert.match(alsoSkipped.content as string, /Not executed/);
    assert.equal(ep.env.actions, 1, 'only the first action was attempted');
    assert.equal(ep.env.reported.stop, 'end_turn');
    assert.equal((await ep.finish()).status.score, 0);
  } finally {
    await ep.close();
  }
});

test('a refusal ends the episode with an error', async () => {
  const client = {
    messages: {
      create: async () => ({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, usage: { input_tokens: 1, output_tokens: 0 } }) as unknown as Anthropic.Message,
    },
  };
  const ep = await bench.open({ task: 'click', level: 1, seed: 1 });
  try {
    await assert.rejects(new AnthropicAgent({ client }).run(ep.env), /declined the request \(cyber\)/);
  } finally {
    await ep.close();
  }
});

test('toolset members translate to harness actions', () => {
  const action = (name: string, input: Record<string, unknown>) => {
    const r = translate(name, input);
    assert.equal(r.kind, 'action');
    return (r as { action: Action }).action;
  };
  assert.deepEqual(action('left_click', { coordinate: [10, 20] }), { type: 'click', button: 'left', count: 1, modifiers: undefined, x: 10, y: 20 });
  assert.deepEqual(action('double_click', { coordinate: [10, 20] }), { type: 'click', button: 'left', count: 2, modifiers: undefined, x: 10, y: 20 });
  assert.deepEqual(action('right_click', {}), { type: 'click', button: 'right', count: 1, modifiers: undefined });
  assert.deepEqual(action('left_click', { coordinate: [1, 2], text: 'ctrl+shift' }), { type: 'click', button: 'left', count: 1, modifiers: ['Control', 'Shift'], x: 1, y: 2 });
  assert.deepEqual(action('mouse_move', { coordinate: [5, 6] }), { type: 'move', x: 5, y: 6 });
  assert.deepEqual(action('left_click_drag', { start_coordinate: [1, 2], coordinate: [3, 4] }), { type: 'drag', path: [[1, 2], [3, 4]], modifiers: undefined });
  assert.deepEqual(action('left_mouse_down', {}), { type: 'mouse_down' });
  assert.deepEqual(action('left_mouse_up', {}), { type: 'mouse_up' });
  assert.deepEqual(action('scroll', { scroll_direction: 'down', scroll_amount: 3, coordinate: [7, 8] }), { type: 'scroll', dx: 0, dy: 300, modifiers: undefined, x: 7, y: 8 });
  assert.deepEqual(action('scroll', { scroll_direction: 'left', scroll_amount: 1 }), { type: 'scroll', dx: -100, dy: 0, modifiers: undefined });
  assert.deepEqual(action('type', { text: 'hi' }), { type: 'type', text: 'hi' });
  assert.deepEqual(action('key', { text: 'ctrl+s', repeat: 2 }), { type: 'key', keys: 'ctrl+s', repeat: 2 });
  assert.deepEqual(action('hold_key', { text: 'shift', duration: 1.5 }), { type: 'key', keys: 'shift', holdSeconds: 1.5 });
  assert.deepEqual(action('wait', { duration: 2 }), { type: 'wait', seconds: 2 });
  assert.deepEqual(translate('screenshot', {}), { kind: 'screenshot' });
  assert.deepEqual(translate('cursor_position', {}), { kind: 'cursor' });
  assert.deepEqual(translate('zoom', { region: [1, 2, 3, 4] }), { kind: 'zoom', region: [1, 2, 3, 4] });
  assert.throws(() => translate('mouse_move', { coordinate: [1] }), /coordinate must be \[x, y\]/);
  assert.throws(() => translate('scroll', { scroll_direction: 'sideways', scroll_amount: 1 }), /scroll_direction/);
  assert.throws(() => translate('left_click', { coordinate: [1, 2], text: 'ctrl+a' }), /not a modifier/);
  assert.throws(() => translate('teleport', {}), /unknown computer tool/);
});
