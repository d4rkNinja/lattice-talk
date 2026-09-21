import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useEffect, useState } from "react";
import { agentJoinPrompt } from "../../cli/prompt.js";
import { saveFileConfig, type ResolvedConnection } from "../../cli/config-file.js";
import { ensureRoom } from "../../core/rooms.js";
import { ensureWorkspaceSession } from "../../core/session.js";
import { listPeersView, listRoomsInfo, type BusHandle, type RoomInfo } from "../bus.js";
import {
  ConfirmModal,
  Footer,
  Header,
  InputModal,
  Key,
  PromptModal,
  WorkspaceModal,
} from "../components.js";
import { colors } from "../theme.js";

type ModalState =
  | { type: "create" }
  | { type: "delete"; room: RoomInfo }
  | { type: "prompt"; roomId?: string }
  | { type: "workspace" }
  | { type: "new-workspace" };

export function RoomsScreen({
  bus,
  conn,
  onOpenRoom,
  onWorkspaceChanged,
  onSetup,
}: {
  bus: BusHandle;
  conn: ResolvedConnection;
  onOpenRoom(roomId: string): void;
  onWorkspaceChanged(workspace: string): void;
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
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [refresh]);

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
      saveFileConfig({ ...conn, workspace: ws });
      setModal(null);
      onWorkspaceChanged(ws);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setModal(null);
    }
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
      <box flexDirection="row" flexGrow={1} padding={1} gap={1}>
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
                Press <span fg={colors.accent}>n</span> to create one — agents can
                then join it.
              </text>
            </box>
          ) : (
            rooms.map((r, i) => (
              <box
                key={r.id}
                flexDirection="row"
                paddingX={1}
                backgroundColor={i === clamped ? colors.panelAlt : undefined}
              >
                <text>
                  <span fg={i === clamped ? colors.accent : colors.dim}>
                    {i === clamped ? "▸ " : "  "}
                  </span>
                  <span fg={i === clamped ? colors.fg : colors.muted}>#{r.id}</span>
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
              {s === workspace ? "▸ " : "· "}
              {s}
            </text>
          ))}
          <text fg={colors.dim}> </text>
          <text fg={colors.muted}>
            Press <span fg={colors.accent}>w</span> to switch or create a
            workspace.
          </text>
        </box>
      </box>
      <Footer>
        <Key k="↑↓/jk" label="move" />
        <Key k="⏎" label="open" />
        <Key k="n" label="new room" />
        <Key k="d" label="delete" />
        <Key k="p" label="prompt" />
        <Key k="w" label="workspace" />
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
    </box>
  );
}
