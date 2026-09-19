import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { isUserError } from "../core/errors.js";
import { assertId } from "../core/ids.js";
import { memoryList } from "../core/memory.js";
import { sessionInfo } from "../core/session.js";
import type { BusDeps } from "../core/types.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";
import { MCP_INTRO_URL, MCP_SPEC_DATE, MCP_SPEC_URL, MCP_TS_SDK_PACKAGE } from "./protocol.js";
import {
  ABOUT_RESOURCE_URI,
  MEMORY_URI_TEMPLATE,
  SESSION_URI_TEMPLATE,
  memoryResourceUri,
  sessionResourceUri,
  suggestSessionIds,
} from "./uris.js";

function jsonContents(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data),
      },
    ],
  };
}

function throwResourceError(err: unknown, uri: string): never {
  if (isUserError(err)) {
    throw new McpError(ErrorCode.InvalidParams, err.message, { uri });
  }
  const message = err instanceof Error ? err.message : String(err);
  throw new McpError(ErrorCode.InternalError, message, { uri });
}

function parseSessionId(raw: unknown, uri: string): string {
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  try {
    return assertId(String(value ?? ""), "session_id");
  } catch (err) {
    throwResourceError(err, uri);
  }
}

function listedDefaultSession(deps: BusDeps) {
  const sid = deps.config.defaultSessionId;
  if (!sid) return { resources: [] as { uri: string; name: string; title: string; description: string; mimeType: string }[] };
  return {
    resources: [
      {
        uri: sessionResourceUri(sid),
        name: "session",
        title: "Default session",
        description: "Compact session_info for LATTICE_DEFAULT_SESSION_ID.",
        mimeType: "application/json",
      },
    ],
  };
}

function listedDefaultMemory(deps: BusDeps) {
  const sid = deps.config.defaultSessionId;
  if (!sid) return { resources: [] as { uri: string; name: string; title: string; description: string; mimeType: string }[] };
  return {
    resources: [
      {
        uri: memoryResourceUri(sid),
        name: "session-memory",
        title: "Default session memory",
        description: "Shared memory key list for LATTICE_DEFAULT_SESSION_ID.",
        mimeType: "application/json",
      },
    ],
  };
}

/**
 * Official MCP resources: one static identity doc + two URI templates.
 * Not a filesystem server. List contents come from process env (default
 * session), not from join_session, so they do not vary as a side effect
 * of other requests (2026-07-28 resources/list rule).
 */
export function registerResources(server: McpServer, deps: BusDeps): void {
  server.registerResource(
    "about",
    ABOUT_RESOURCE_URI,
    {
      title: "Lattice about",
      description:
        "Server identity, MCP 2026-07-28 primitives, and how to use this stdio session bus. No secrets.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonContents(uri.href, {
        name: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        product: "Lattice",
        transport: "stdio",
        spec: MCP_SPEC_DATE,
        spec_url: MCP_SPEC_URL,
        docs: MCP_INTRO_URL,
        sdk: MCP_TS_SDK_PACKAGE,
        primitives: ["tools", "resources", "prompts"],
        store: deps.store.kind,
        namespace: deps.config.namespace,
        default_session_id: deps.config.defaultSessionId ?? null,
        resources: {
          about: ABOUT_RESOURCE_URI,
          session: SESSION_URI_TEMPLATE,
          memory: MEMORY_URI_TEMPLATE,
        },
        how_to:
          "Call join_session, then tell_agent / tell_room / pull_messages / memory_*. Read lattice://session/{session_id} for a compact snapshot. Redis credentials stay in MCP env.",
      }),
  );

  server.registerResource(
    "session",
    new ResourceTemplate(SESSION_URI_TEMPLATE, {
      list: async () => listedDefaultSession(deps),
      complete: {
        session_id: (value) => suggestSessionIds(deps, value),
      },
    }),
    {
      title: "Session snapshot",
      description:
        "Read-only session_info (peers, rooms, store kind). Same data as the session_info tool. Not a filesystem.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const sessionId = parseSessionId(variables.session_id, uri.href);
      try {
        return jsonContents(uri.href, await sessionInfo(deps, { session_id: sessionId }));
      } catch (err) {
        throwResourceError(err, uri.href);
      }
    },
  );

  server.registerResource(
    "session-memory",
    new ResourceTemplate(MEMORY_URI_TEMPLATE, {
      list: async () => listedDefaultMemory(deps),
      complete: {
        session_id: (value) => suggestSessionIds(deps, value),
      },
    }),
    {
      title: "Session memory keys",
      description:
        "Read-only shared memory key list (no long values). Same compact view as memory_list without include_values.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const sessionId = parseSessionId(variables.session_id, uri.href);
      try {
        return jsonContents(
          uri.href,
          await memoryList(deps, { session_id: sessionId, include_values: false }),
        );
      } catch (err) {
        throwResourceError(err, uri.href);
      }
    },
  );
}
