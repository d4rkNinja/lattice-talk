import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useEffect, useState } from "react";
import { agentJoinPrompt } from "../../cli/prompt.js";
import { JOIN_COMMAND_ROOM, refreshJoinCommands } from "../../cli/commands.js";
import {
  activateProfile,
  applyConnectionToHarnesses,
  deleteProfile,
  describeConnection,
  listProfiles,
  saveProfile,
} from "../../cli/connections.js";
import {
  loadFileConfig,
  saveFileConfig,
  type ResolvedConnection,
} from "../../cli/config-file.js";
import { pingBus } from "../bus.js";
import { ensureRoom } from "../../core/rooms.js";
import { ensureWorkspaceSession } from "../../core/session.js";
import {
  listPeersView,
  listRoomsInfo,
  subscribeSessionMeta,
  type BusHandle,
  type RoomInfo,
} from "../bus.js";
import {
  ConfirmModal,
  ConnectionsModal,
  FadeIn,
  Footer,
  Header,
  InputModal,
  Key,
  PromptModal,
  WorkspaceModal,
} from "../components.js";
import { colors, glyphs } from "../theme.js";

type ModalState =
  | { type: "create" }
  | { type: "delete"; room: RoomInfo }
  | { type: "prompt"; roomId?: string }
  | { type: "workspace" }
  | { type: "new-workspace" }
  | { type: "connections" }
  | { type: "new-connection" }
  | { type: "delete-connection"; name: string };

export function RoomsScreen({
  bus,
  conn,
  onOpenRoom,
  onWorkspaceChanged,
  onConnectionChanged,
  onNewConnection,
  onSetup,
}: {
  bus: BusHandle;
  conn: ResolvedConnection;
  onOpenRoom(roomId: string): void;
  onWorkspaceChanged(workspace: string): void;
  onConnectionChanged(conn: ResolvedConnection): void;
  onNewConnection(name: string): void;
  onSetup(): void;
}) {
  const renderer = useRenderer();
  const workspace = conn.workspace ?? "main";
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [peerCount, setPeerCount] = useState(0);
  const [onlineCount, setOnlineCount] = useState(0);
  const [sessions, setSessions] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const [r, peers, s] = await Promise.all([
        listRoomsInfo(bus, workspace),
        listPeersView(bus, workspace),
        bus.store.listSessions(),
      ]);
      setRooms(r);
      setPeerCount(peers.length);
      setOnlineCount(peers.filter((p) => p.online).length);
      setSessions(s);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [bus, workspace]);

  useEffect(() => {
    void refresh();
    // Room/agent changes wake us via pub/sub; the interval is a safety net.
    let cancelled = false;
    let unsub: (() => Promise<void>) | undefined;
    subscribeSessionMeta(bus, workspace, () => void refresh())
      .then((u) => {
        if (cancelled) void u();
        else unsub = u;
      })
      .catch(() => {});
    const t = setInterval(() => void refresh(), 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
      void unsub?.();
    };
  }, [bus, refresh, workspace]);

  const createRoom = async (name: string) => {
    try {
      await ensureRoom(bus.deps, workspace, name.trim(), "lattice");
      setModal({ type: "prompt", roomId: name.trim() });
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setModal(null);
    }
  };

  const deleteRoom = async (roomId: string) => {
    try {
      await bus.store.deleteRoom(workspace, roomId);
      setModal(null);
      setSelected((s) => Math.max(0, s - 1));
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setModal(null);
    }
  };

  const switchWorkspace = async (ws: string) => {
    try {
      await ensureWorkspaceSession(bus.deps, ws);
      // Keep the active profile in sync so it doesn't point at a stale
      // workspace next time it's selected.
      const { config } = loadFileConfig();
      if (config.active && config.profiles?.[config.active]) {
        saveProfile(config.active, { ...conn, workspace: ws }, { activate: true });
      } else {
        saveFileConfig({ ...conn, workspace: ws });
      }
      // Installed /l-talk-new commands embed the workspace — rewrite them so
      // a fresh session can't join the one we just left. Best-effort.
      try {
        refreshJoinCommands(
          agentJoinPrompt({
            workspace: ws,
            roomId: JOIN_COMMAND_ROOM,
            tokenProtected: Boolean(conn.joinToken),
          }),
        );
      } catch {}
      setModal(null);
      onWorkspaceChanged(ws);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setModal(null);
    }
  };

  const [connBusy, setConnBusy] = useState(false);
  const profiles =
    modal?.type === "connections"
      ? listProfiles(loadFileConfig().config).map((p) => ({
          name: p.name,
          active: p.active,
          summary: describeConnection(p.conn),
        }))
      : [];

  const switchConnection = async (name: string) => {
    if (connBusy) return;
    setConnBusy(true);
    try {
      const { config } = loadFileConfig();
      const profile = config.profiles?.[name];
      if (!profile) throw new Error(`profile ${JSON.stringify(name)} not found`);
      const next = { namespace: "dev", ...profile };
      await pingBus(next);
      activateProfile(name);
      try {
        applyConnectionToHarnesses(next, () => {}, () => {});
      } catch {}
      setModal(null);
      onConnectionChanged(next);
    } catch (e) {
      setConnBusy(false);
      setModal(null);
      setError(`could not switch to "${name}": ${e instanceof Error ? e.message : e}`);
    }
  };

  const deleteConnection = (name: string) => {
    const result = deleteProfile(name);
    setModal(null);
    if (result.conn) onConnectionChanged(result.conn);
  };

  const clamped = Math.min(selected, Math.max(0, rooms.length - 1));
  const selectedRoom = rooms[clamped];

  useKeyboard((key) => {
    if (modal) return;
    switch (key.name) {
      case "up":
      case "k":
        setSelected((s) => Math.max(0, s - 1));
        break;
      case "down":
      case "j":
        setSelected((s) => Math.min(rooms.length - 1, s + 1));
        break;
      case "return":
        if (selectedRoom) onOpenRoom(selectedRoom.id);
        break;
      case "n":
        setModal({ type: "create" });
        break;
      case "d":
        if (selectedRoom) setModal({ type: "delete", room: selectedRoom });
        break;
      case "p":
        setModal({ type: "prompt", roomId: selectedRoom?.id });
        break;
      case "w":
        setModal({ type: "workspace" });
        break;
      case "c":
        setModal({ type: "connections" });
        break;
      case "s":
        onSetup();
        break;
      case "q":
        renderer.destroy();
        break;
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={colors.bg}>
      <Header
        left={`ns:${conn.namespace}  ws:${workspace}`}
        right={`${onlineCount}/${peerCount} agents online`}
      />
      <FadeIn flexDirection="row" flexGrow={1} padding={1} gap={1} duration={200}>
        <box
          border
          borderStyle="rounded"
          borderColor={colors.border}
          title="Rooms"
          titleColor={colors.accent}
          flexGrow={1}
          flexDirection="column"
          padding={1}
        >
          {rooms.length === 0 ? (
            <box flexDirection="column" gap={1} padding={1}>
              <text fg={colors.muted}>No rooms yet in workspace "{workspace}".</text>
              <text fg={colors.muted}>
                Press <span fg={colors.accent}>n</span> to create one {glyphs.dash} agents can
                then join it.
              </text>
            </box>
          ) : (
            rooms.map((r, i) => (
              <box
                key={r.id}
                flexDirection="row"
                paddingX={1}
                backgroundColor={i === clamped ? colors.select : undefined}
              >
                <text>
                  <span fg={i === clamped ? colors.accent : colors.dim}>
                    {i === clamped ? `${glyphs.pointer} ` : "  "}
                  </span>
                  <span fg={i === clamped ? colors.accent : colors.muted}>#{r.id}</span>
                  <span fg={colors.dim}>
                    {"  "}
                    {r.members} member{r.members === 1 ? "" : "s"}
                  </span>
                </text>
              </box>
            ))
          )}
          {error ? <text fg={colors.bad}> {error}</text> : null}
        </box>
        <box
          border
          borderStyle="rounded"
          borderColor={colors.border}
          title="Workspace"
          titleColor={colors.accent}
          width={34}
          padding={1}
          flexDirection="column"
          gap={1}
        >
          <text fg={colors.fg}>
            <strong>{workspace}</strong>
          </text>
          <text fg={colors.muted}>
            Rooms are channels inside this workspace. Agents join the workspace
            once, then join rooms.
          </text>
          <text fg={colors.muted}>
            Known workspaces on this bus:
          </text>
          {sessions.slice(0, 8).map((s) => (
            <text key={s} fg={s === workspace ? colors.accent : colors.muted}>
              {"  "}
              {s === workspace ? `${glyphs.pointer} ` : `${glyphs.bullet} `}
              {s}
            </text>
          ))}
          <text fg={colors.dim}> </text>
          <text fg={colors.muted}>
            Press <span fg={colors.accent}>w</span> to switch or create a
            workspace.
          </text>
        </box>
      </FadeIn>
      <Footer>
        <Key k={`${glyphs.updown}/jk`} label="move" />
        <Key k={glyphs.enter} label="open" />
        <Key k="n" label="new room" />
        <Key k="d" label="delete" />
        <Key k="p" label="prompt" />
        <Key k="w" label="workspace" />
        <Key k="c" label="connections" />
        <Key k="s" label="setup" />
        <Key k="q" label="quit" />
      </Footer>

      {modal?.type === "create" ? (
        <InputModal
          title="New room"
          placeholder="room name, e.g. design or backend"
          hint="Letters, digits, . _ - only. Agents join it with join_room."
          onSubmit={(v) => (v.trim() ? void createRoom(v) : setModal(null))}
          onCancel={() => setModal(null)}
        />
      ) : null}

      {modal?.type === "delete" ? (
        <ConfirmModal
          title={`Delete #${modal.room.id}?`}
          body={`This removes #${modal.room.id}, its message history and read cursors. Agents in it lose access.`}
          confirmLabel="delete"
          onConfirm={() => void deleteRoom(modal.room.id)}
          onCancel={() => setModal(null)}
        />
      ) : null}

      {modal?.type === "prompt" ? (
        <PromptModal
          text={agentJoinPrompt({
            workspace,
            roomId: modal.roomId,
            tokenProtected: Boolean(conn.joinToken),
          })}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.type === "workspace" ? (
        <WorkspaceModal
          sessions={sessions}
          current={workspace}
          onPick={(v) => {
            if (v === "__new__") setModal({ type: "new-workspace" });
            else void switchWorkspace(v);
          }}
          onCancel={() => setModal(null)}
        />
      ) : null}

      {modal?.type === "new-workspace" ? (
        <InputModal
          title="New workspace"
          placeholder="workspace name, e.g. my-project"
          hint="Creates a session agents will join with join_session."
          onSubmit={(v) => (v.trim() ? void switchWorkspace(v.trim()) : setModal(null))}
          onCancel={() => setModal(null)}
        />
      ) : null}

      {modal?.type === "connections" ? (
        <ConnectionsModal
          rows={profiles}
          busy={connBusy}
          onUse={(name) => void switchConnection(name)}
          onDelete={(name) => setModal({ type: "delete-connection", name })}
          onNew={() => setModal({ type: "new-connection" })}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.type === "new-connection" ? (
        <InputModal
          title="New connection"
          placeholder="profile name, e.g. personal or office"
          hint="Letters, digits, . _ - only. Guided setup runs next — including SSH tunnel options."
          onSubmit={(v) => {
            const name = v.trim();
            if (!name) {
              setModal(null);
              return;
            }
            setModal(null);
            onNewConnection(name);
          }}
          onCancel={() => setModal(null)}
        />
      ) : null}

      {modal?.type === "delete-connection" ? (
        <ConfirmModal
          title={`Delete "${modal.name}"?`}
          body="Removes this saved connection. If it was active, the next profile becomes active and the dashboard reconnects."
          confirmLabel="delete"
          onConfirm={() => deleteConnection(modal.name)}
          onCancel={() => setModal({ type: "connections" })}
        />
      ) : null}
    </box>
  );
}
