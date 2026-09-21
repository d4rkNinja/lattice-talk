import {
  useKeyboard,
  useTerminalDimensions,
} from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { agentJoinPrompt } from "../../cli/prompt.js";
import type { ResolvedConnection } from "../../cli/config-file.js";
import type { LatticeMessage } from "../../core/types.js";
import {
  formatTime,
  listPeersView,
  listRoomsInfo,
  pollRoomMessages,
  subscribeRoomFeed,
  type BusHandle,
  type PeerView,
  type RoomInfo,
} from "../bus.js";
import { FadeIn, Footer, Header, Key, LiveDot, PromptModal } from "../components.js";
import { colors, kindColor } from "../theme.js";

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

function MessageLine({
  m,
  width,
  animate,
}: {
  m: LatticeMessage;
  width: number;
  animate: boolean;
}) {
  const head = ` ${formatTime(m.ts)}  ${m.from}`;
  const tag = ` · ${m.role}${m.harness && m.harness !== "unknown" ? `/${m.harness}` : ""}${m.kind !== "chat" ? ` · ${m.kind}` : ""}`;
  const bodyWidth = Math.max(20, width - 4);
  const inner = (
    <>
      <text>
        <span fg={colors.dim}>{head}</span>
        <span fg={colors.dim}>{tag}</span>
        {m.truncated ? <span fg={colors.warn}>  (truncated)</span> : null}
      </text>
      {wrap(m.body, bodyWidth).map((line, i) => (
        <text key={i} fg={kindColor[m.kind] ?? colors.fg} selectable>
          {"        "}
          {line}
        </text>
      ))}
    </>
  );
  // Only messages arriving after the initial load animate — history renders flat.
  return animate ? (
    <FadeIn flexDirection="column" paddingX={1} duration={180}>
      {inner}
    </FadeIn>
  ) : (
    <box flexDirection="column" paddingX={1}>
      {inner}
    </box>
  );
}

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
  const [promptOpen, setPromptOpen] = useState(false);
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

  useKeyboard((key) => {
    if (promptOpen) return;
    switch (key.name) {
      case "escape":
      case "b":
        onBack();
        break;
      case "p":
        setPromptOpen(true);
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
          borderColor={colors.borderActive}
          title={`#${cur?.displayName ?? roomId}`}
          titleColor={colors.accent}
          flexGrow={1}
          flexDirection="column"
        >
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
                <LiveDot label={`watching #${roomId} — no messages yet`} />
                <text fg={colors.muted}>
                  Press <span fg={colors.accent}>p</span> for a prompt to paste
                  into an agent — it will join and start talking here.
                </text>
              </box>
            ) : (
              messages.map((m) => (
                <MessageLine
                  key={m.id}
                  m={m}
                  width={feedWidth}
                  animate={
                    initialIdsRef.current !== null && !initialIdsRef.current.has(m.id)
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
                {r.id === roomId ? "▸ " : "  "}#{r.id}
              </text>
            ))}
            <text fg={colors.dim}> </text>
            <text fg={colors.dim}>←→ switch room</text>
          </box>
          <box
            border
            borderStyle="rounded"
            borderColor={colors.border}
            title="Agents"
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
                const row = (
                  <>
                    <text>
                      <span fg={p.online ? colors.good : colors.dim}>
                        {p.online ? "● " : "○ "}
                      </span>
                      <span fg={p.online ? colors.fg : colors.muted}>
                        {p.display_name}
                      </span>
                    </text>
                    <text fg={colors.dim}>
                      {"    "}
                      {p.agent_id} · {p.role}
                      {p.harness !== "unknown" ? ` · ${p.harness}` : ""}
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
        <Key k="←→" label="switch room" />
        <Key k="↑↓" label="scroll" />
        <Key k="f" label="follow" />
        <Key k="p" label="prompt" />
      </Footer>

      {promptOpen ? (
        <PromptModal
          text={agentJoinPrompt({
            workspace,
            roomId,
            tokenProtected: Boolean(conn.joinToken),
          })}
          onClose={() => setPromptOpen(false)}
        />
      ) : null}
    </box>
  );
}
