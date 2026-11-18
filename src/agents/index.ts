// Agent registry. To benchmark your own agent, implement the Agent interface from
// ../types.ts and add a line here (see README "Plugging in an agent").
import type { Agent } from '../types.ts';
import { AnthropicAgent } from './anthropic.ts';
import type { Effort } from './anthropic.ts';
import { NoopAgent, OracleAgent, RandomAgent } from './scripted.ts';

export interface AgentOptions {
  model?: string;
  effort?: string;
  sigma?: number;
  maxTurns?: number;
}

export const AGENTS: Record<string, { about: string; make(o: AgentOptions): Agent }> = {
  oracle: { about: 'replays the reference solution (must score 100)', make: () => new OracleAgent(0) },
  noisy: { about: 'reference solution with Gaussian pixel noise (--sigma, default 3)', make: (o) => new OracleAgent(o.sigma ?? 3) },
  random: { about: 'random mouse/keyboard input (should score ~0)', make: () => new RandomAgent() },
  noop: { about: 'does nothing (must score 0)', make: () => new NoopAgent() },
  anthropic: {
    about: 'Claude via the computer-use toolset (--model, --effort); needs Anthropic API credentials',
    make: (o) => new AnthropicAgent({ model: o.model, effort: o.effort as Effort | undefined, maxTurns: o.maxTurns }),
  },
};

export function makeAgent(name: string, opts: AgentOptions = {}): Agent {
  const entry = AGENTS[name];
  if (!entry) throw new Error(`unknown agent "${name}". Available: ${Object.keys(AGENTS).join(', ')}`);
  return entry.make(opts);
}
