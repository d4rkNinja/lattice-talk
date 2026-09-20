import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import { INVALID_PARAMS, ProtocolError, ResourceNotFoundError } from "@modelcontextprotocol/server";
import { isUserError } from "../core/errors.js";
import { assertId } from "../core/ids.js";
import { memoryList } from "../core/memory.js";
import { resolveInspectSessionIdAuthorized } from "../core/resolve.js";
import { sessionInfo } from "../core/session.js";
import type { BusDeps } from "../core/types.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";
import {
  MCP_ALIGNMENT,
  MCP_DOCS_HUB_URL,
  MCP_FEATURE_SPEC_DATE,
  MCP_INTRO_URL,
  MCP_SPEC_URL,
  MCP_TS_SDK_PACKAGE,
  MCP_WIRE_ERA,
} from "./protocol.js";
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
  if (err instanceof ProtocolError) {
    throw err;
  }
  if (isUserError(err)) {
    // -32602 for auth/validation denials: like a missing resource, the caller
    // gets no confirmation the session exists.
    throw new ProtocolError(INVALID_PARAMS, err.message, { uri });
  }
  const message = err instanceof Error ? err.message : String(err);
  throw new ProtocolError(-32603, message, { uri });
}

function throwResourceNotFound(uri: string): never {
  throw new ResourceNotFoundError(uri, "Resource not found");
}

function parseSessionId(raw: unknown, uri: string): string {
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  try {
    return assertId(String(value ?? ""), "session_id");
  } catch (err) {
    throwResourceError(err, uri);
  }
}

interface ListedResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

function listedDefaultSession(deps: BusDeps): { resources: ListedResource[] } {
  const sid = deps.config.defaultSessionId;
  if (!sid) return { resources: [] };
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

function listedDefaultMemory(deps: BusDeps): { resources: ListedResource[] } {
  const sid = deps.config.defaultSessionId;
  if (!sid) return { resources: [] };
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
 * of other requests. Reads enforce the same session + token authorization
 * as the read tools.
 */
export function registerResources(server: McpServer, deps: BusDeps): void {
  server.registerResource(
    "about",
    ABOUT_RESOURCE_URI,
    {
      title: "Lattice about",
      description:
        "Server identity, feature-aligned 2026-07-28 primitives, SDK v2 initialize-era wire. No secrets.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonContents(uri.href, {
        name: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        product: "Lattice",
        transport: "stdio",
        spec: MCP_FEATURE_SPEC_DATE,
        wire: MCP_WIRE_ERA,
        alignment: MCP_ALIGNMENT,
        spec_url: MCP_SPEC_URL,
        docs: MCP_DOCS_HUB_URL,
        docs_feature: MCP_INTRO_URL,
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
        await resolveInspectSessionIdAuthorized(deps, sessionId);
        const meta = await deps.store.getSessionMeta(sessionId);
        if (!meta) {
          throwResourceNotFound(uri.href);
        }
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
        await resolveInspectSessionIdAuthorized(deps, sessionId);
        const meta = await deps.store.getSessionMeta(sessionId);
        if (!meta) {
          throwResourceNotFound(uri.href);
        }
        return jsonContents(
          uri.href,
          await memoryList(deps, {
            session_id: sessionId,
            include_values: false,
            limit: 200,
          }),
        );
      } catch (err) {
        throwResourceError(err, uri.href);
      }
    },
  );
}
