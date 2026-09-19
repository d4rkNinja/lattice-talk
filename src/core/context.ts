import type { AgentRecord } from "./types.js";

/** Process-local memory of the last successful join. Tools may still pass ids explicitly. */
export class RuntimeContext {
  sessionId?: string;
  agentId?: string;
  role?: string;
  harness?: string;
  displayName?: string;

  rememberJoin(sessionId: string, agent: AgentRecord): void {
    this.sessionId = sessionId;
    this.agentId = agent.agent_id;
    this.role = agent.role;
    this.harness = agent.harness;
    this.displayName = agent.display_name;
  }

  clearIf(sessionId: string, agentId: string): void {
    if (this.sessionId === sessionId && this.agentId === agentId) {
      this.sessionId = undefined;
      this.agentId = undefined;
      this.role = undefined;
      this.harness = undefined;
      this.displayName = undefined;
    }
  }
}
