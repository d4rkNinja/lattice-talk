import {
  useKeyboard,
  useTerminalDimensions,
} from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentJoinPrompt } from "../../cli/prompt.js";
import type { ResolvedConnection } from "../../cli/config-file.js";
import type { LatticeMessage } from "../../core/types.js";
import {
  formatTime,
  listPeersView,
  listRoomsInfo,
  pollRoomMessages,
  removePeer,
  subscribeRoomFeed,
  type BusHandle,
  type PeerView,
  type RoomInfo,
} from "../bus.js";
import {
  AgentsModal,
  ConfirmModal,
  FadeIn,
  Footer,
  Header,
  Key,
  LiveDot,
  PromptModal,
  type AgentRow,
} from "../components.js";
import { filterMessages, groupMessages, type MessageGroup } from "../feed.js";
import { agentColor, asciiGlyphs, colors, glyphs, kindColor } from "../theme.js";

function wrap(body: string, width: number): string[] {
  const words = body.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/**
 * One run of consecutive same-sender messages: a colored gutter bar, a
 * timestamped name header once, then each message's body under its own
 * timestamp. Everything takes the sender's agent color so a conversation
 * reads by color; non-chat kinds keep their semantic body color.
 */
function MessageGroupView({
  group,
  name,
  width,
  animate,
}: {
  group: MessageGroup;
  name: string;
  width: number;
  animate: boolean;
}) {
  const color = agentColor(group.from);
  const bodyWidth = Math.max(20, width - 8);
  const inner = (
    <box
      border={["left"]}
      borderStyle={asciiGlyphs ? "single" : "heavy"}
      borderColor={color}
      paddingLeft={1}
      flexDirection="column"
    >
      {group.messages.map((m, i) => (
        <box key={m.id} flexDirection="column">
          <text>
            <span fg={color}>{formatTime(m.ts)}</span>
            {i === 0 ? (
              <>
                <span fg={color}>
                  {"  "}
                  <strong>{name}</strong>
                </span>
                <span fg={colors.dim}>
                  {` ${glyphs.sep} ${m.role}${m.harness && m.harness !== "unknown" ? `/${m.harness}` : ""}${m.kind !== "chat" ? ` ${glyphs.sep} ${m.kind}` : ""}`}
                </span>
              </>
            ) : null}
            {m.truncated ? <span fg={colors.warn}>  (truncated)</span> : null}
          </text>
          {wrap(m.body, bodyWidth).map((line, k) => (
            <text
              key={k}
              fg={m.kind === "chat" ? color : (kindColor[m.kind] ?? colors.fg)}
              selectable
            >
              {"    "}
              {line}
            </text>
          ))}
        </box>
      ))}
    </box>
  );
  // Only groups arriving after the initial load animate — history renders flat.
  return animate ? (
    <FadeIn flexDirection="column" paddingX={1} marginTop={1} duration={180}>
      {inner}
    </FadeIn>
  ) : (
    <box flexDirection="column" paddingX={1} marginTop={1}>
      {inner}
    </box>
  );
}

type ModalState =
  | { type: "prompt" }
  | { type: "agents" }
  | { type: "remove"; peer: AgentRow };

export function RoomScreen({
  bus,
  conn,
  roomId,
  onBack,
  onOpenRoom,
}: {
  bus: BusHandle;
  conn: ResolvedConnection;
  roomId: string;
  onBack(): void;
  onOpenRoom(roomId: string): void;
}) {
  const workspace = conn.workspace ?? "main";
  const { width: termWidth } = useTerminalDimensions();
  const [messages, setMessages] = useState<LatticeMessage[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [peers, setPeers] = useState<PeerView[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [paused, setPaused] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const lastIdRef = useRef("0");
  // Ids in the first loaded page render flat; anything after animates in.
  const initialIdsRef = useRef<Set<string> | null>(null);
  // Same for the peer roster — agents present at first load render flat.
  const initialPeersRef = useRef<Set<string> | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  const refresh = useCallback(async () => {
    try {
      const firstLoad = lastIdRef.current === "0";
      const [page, r, p] = await Promise.all([
        pollRoomMessages(bus, workspace, roomId, lastIdRef.current),
        listRoomsInfo(bus, workspace),
        listPeersView(bus, workspace),
      ]);
      if (page.messages.length) {
        lastIdRef.current = page.lastId;
        if (firstLoad) initialIdsRef.current = new Set(page.messages.map((m) => m.id));
        setMessages((prev) => [...prev, ...page.messages].slice(-500));
      } else if (firstLoad) {
        initialIdsRef.current = new Set();
      }
      if (initialPeersRef.current === null) {
        initialPeersRef.current = new Set(p.map((x) => x.agent_id));
      }
      setRooms(r);
      setPeers(p);
      setError(undefined);
    } catch {
      // transient bus errors keep the last good frame
    }
  }, [bus, workspace, roomId]);

  useEffect(() => {
    lastIdRef.current = "0";
    initialIdsRef.current = null;
    initialPeersRef.current = null;
    setMessages([]);
    void refresh();
    // Push-driven refresh; the slow interval is only a safety net for a
    // dropped notify or a reconnect.
    let cancelled = false;
    let unsub: (() => Promise<void>) | undefined;
    subscribeRoomFeed(bus, workspace, roomId, () => void refresh())
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
  }, [bus, refresh, roomId, workspace]);

  const togglePause = useCallback((agentId: string) => {
    setPaused((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setPaused(new Set());
    setFocus(null);
  }, []);

  const kickAgent = useCallback(
    async (peer: AgentRow) => {
      try {
        await removePeer(bus, workspace, peer.agent_id);
        setPaused((prev) => {
          if (!prev.has(peer.agent_id)) return prev;
          const next = new Set(prev);
          next.delete(peer.agent_id);
          return next;
        });
        setFocus((f) => (f === peer.agent_id ? null : f));
        setModal(null);
        void refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setModal(null);
      }
    },
    [bus, workspace, refresh],
  );

  useKeyboard((key) => {
    if (modal) return;
    switch (key.name) {
      case "escape":
      case "b":
        onBack();
        break;
      case "p":
        setModal({ type: "prompt" });
        break;
      case "a":
        setModal({ type: "agents" });
        break;
      case "x":
        clearFilters();
        break;
      case "left":
      case "right": {
        if (rooms.length < 2) break;
        const cur = rooms.findIndex((r) => r.id === roomId);
        const base = cur === -1 ? 0 : cur;
        const next =
          (base + (key.name === "left" ? -1 : 1) + rooms.length) % rooms.length;
        if (rooms[next].id !== roomId) onOpenRoom(rooms[next].id);
        break;
      }
      case "f": {
        const sb = scrollRef.current;
        if (sb) sb.scrollTop = sb.scrollHeight;
        break;
      }
    }
  });

  const sidebarW = 30;
  const feedWidth = Math.max(30, termWidth - sidebarW - 8);
  const cur = rooms.find((r) => r.id === roomId);
  const peerById = useMemo(
    () => new Map(peers.map((p) => [p.agent_id, p])),
    [peers],
  );
  const senderName = (id: string) => peerById.get(id)?.display_name ?? id;
  const visible = filterMessages(messages, { paused, focus });
  const groups = groupMessages(visible);
  const filtersActive = focus !== null || paused.size > 0;

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={colors.bg}>
      <Header
        left={`ns:${conn.namespace}  ws:${workspace}  #${roomId}`}
        right={<LiveDot label="live feed (view only)" />}
      />
      <box flexDirection="row" flexGrow={1} padding={1} gap={1}>
        <FadeIn
          key={roomId}
          flexGrow={1}
          flexDirection="column"
          duration={140}
        >
        <box
          border
          borderStyle="rounded"
          borderColor={filtersActive ? colors.warn : colors.borderActive}
          title={`#${cur?.displayName ?? roomId}`}
          titleColor={colors.accent}
          flexGrow={1}
          flexDirection="column"
        >
          {filtersActive ? (
            <text paddingX={1}>
              <span fg={colors.warn}>
                {focus
                  ? `focused: ${senderName(focus)}`
                  : `paused: ${[...paused].map((id) => senderName(id)).join(", ")}`}
              </span>
              <span fg={colors.dim}>{` ${glyphs.sep} x clears ${glyphs.sep} a manages`}</span>
            </text>
          ) : null}
          {error ? <text fg={colors.bad} paddingX={1}>{error}</text> : null}
          <scrollbox
            ref={scrollRef}
            height="100%"
            focused
            stickyScroll
            stickyStart="bottom"
            style={{
              scrollbarOptions: {
                trackOptions: {
                  foregroundColor: colors.accent,
                  backgroundColor: colors.border,
                },
              },
            }}
          >
            {messages.length === 0 ? (
              <box padding={1} flexDirection="column" gap={1}>
                <LiveDot label={`watching #${roomId} ${glyphs.dash} no messages yet`} />
                <text fg={colors.muted}>
                  Press <span fg={colors.accent}>p</span> for a prompt to paste
                  into an agent {glyphs.dash} it will join and start talking here.
                </text>
              </box>
            ) : groups.length === 0 ? (
              <box padding={1} flexDirection="column" gap={1}>
                <text fg={colors.muted}>
                  Every message is hidden by the active filters.
                </text>
                <text fg={colors.muted}>
                  Press <span fg={colors.accent}>x</span> to clear them.
                </text>
              </box>
            ) : (
              groups.map((g) => (
                <MessageGroupView
                  key={g.key}
                  group={g}
                  name={senderName(g.from)}
                  width={feedWidth}
                  animate={
                    initialIdsRef.current !== null &&
                    !g.messages.every((m) => initialIdsRef.current!.has(m.id))
                  }
                />
              ))
            )}
          </scrollbox>
        </box>
        </FadeIn>
        <box flexDirection="column" width={sidebarW} gap={1}>
          <box
            border
            borderStyle="rounded"
            borderColor={colors.border}
            title="Channels"
            titleColor={colors.accent}
            padding={1}
            flexDirection="column"
          >
            {rooms.map((r) => (
              <text key={r.id} fg={r.id === roomId ? colors.accent : colors.muted}>
                {r.id === roomId ? `${glyphs.pointer} ` : "  "}#{r.id}
              </text>
            ))}
            <text fg={colors.dim}> </text>
            <text fg={colors.dim}>{glyphs.leftright} switch room</text>
          </box>
          <box
            border
            borderStyle="rounded"
            borderColor={colors.border}
            title={`Agents ${glyphs.sep} a to manage`}
            titleColor={colors.accent}
            padding={1}
            flexDirection="column"
            flexGrow={1}
          >
            {peers.length === 0 ? (
              <text fg={colors.muted}>No agents joined yet.</text>
            ) : (
              peers.map((p) => {
                const isNew =
                  initialPeersRef.current !== null &&
                  !initialPeersRef.current.has(p.agent_id);
                const isPaused = paused.has(p.agent_id);
                const isFocused = focus === p.agent_id;
                const row = (
                  <>
                    <text>
                      <span fg={p.online ? colors.good : colors.dim}>
                        {p.online ? `${glyphs.dotOn} ` : `${glyphs.dotOff} `}
                      </span>
                      <span
                        fg={isPaused ? colors.dim : agentColor(p.agent_id)}
                      >
                        {isFocused ? `${glyphs.pointer} ` : ""}
                        {p.display_name}
                      </span>
                      {isPaused ? <span fg={colors.warn}> paused</span> : null}
                    </text>
                    <text fg={colors.dim}>
                      {"    "}
                      {p.agent_id} {glyphs.sep} {p.role}
                      {p.harness !== "unknown" ? ` ${glyphs.sep} ${p.harness}` : ""}
                      {p.wake ? ` ${glyphs.sep} auto-wake` : ""}
                    </text>
                  </>
                );
                return isNew ? (
                  <FadeIn key={p.agent_id} flexDirection="column" duration={220}>
                    {row}
                  </FadeIn>
                ) : (
                  <box key={p.agent_id} flexDirection="column">
                    {row}
                  </box>
                );
              })
            )}
          </box>
        </box>
      </box>
      <Footer>
        <Key k="b/esc" label="rooms" />
        <Key k={glyphs.leftright} label="switch room" />
        <Key k={glyphs.updown} label="scroll" />
        <Key k="f" label="follow" />
        <Key k="a" label="agents" />
        <Key k="x" label="clear filters" />
        <Key k="p" label="prompt" />
      </Footer>

      {modal?.type === "prompt" ? (
        <PromptModal
          text={agentJoinPrompt({
            workspace,
            roomId,
            tokenProtected: Boolean(conn.joinToken),
          })}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.type === "agents" ? (
        <AgentsModal
          peers={peers}
          paused={paused}
          focus={focus}
          onFocus={setFocus}
          onTogglePause={togglePause}
          onRemove={(peer) => setModal({ type: "remove", peer })}
          onClearFilters={clearFilters}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.type === "remove" ? (
        <ConfirmModal
          title={`Remove ${modal.peer.display_name}?`}
          body={`This kicks ${modal.peer.display_name} out of the session ${glyphs.dash} presence, room memberships and read cursors are dropped. Their past messages stay.`}
          confirmLabel="remove"
          onConfirm={() => void kickAgent(modal.peer)}
          onCancel={() => setModal({ type: "agents" })}
        />
      ) : null}
    </box>
  );
}
