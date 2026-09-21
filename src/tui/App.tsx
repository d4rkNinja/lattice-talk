import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadFileConfig,
  resolveConnection,
  type ResolvedConnection,
} from "../cli/config-file.js";
import { ensureWorkspaceSession } from "../core/session.js";
import { connectBus, type BusHandle } from "./bus.js";
import { colors, glyphs } from "./theme.js";
import { RoomsScreen } from "./screens/RoomsScreen.js";
import { RoomScreen } from "./screens/RoomScreen.js";
import { SetupScreen } from "./screens/SetupScreen.js";
import { FadeIn, Logo, Spinner } from "./components.js";
import { VERSION } from "./version.js";

type View =
  | { type: "rooms" }
  | { type: "room"; roomId: string };

export function App({ forceSetup = false }: { forceSetup?: boolean }) {
  const renderer = useRenderer();
  const [phase, setPhase] = useState<"loading" | "setup" | "ready">("loading");
  const [conn, setConn] = useState<ResolvedConnection>({ namespace: "dev" });
  const [notice, setNotice] = useState<string>();
  const [view, setView] = useState<View>({ type: "rooms" });
  const [bus, setBus] = useState<BusHandle | null>(null);
  const busRef = useRef<BusHandle | null>(null);

  const openBus = useCallback(async (c: ResolvedConnection): Promise<BusHandle> => {
    const next = await connectBus(c);
    try {
      await ensureWorkspaceSession(next.deps, c.workspace ?? "main");
    } catch (error) {
      await next.close();
      throw error;
    }
    const previous = busRef.current;
    busRef.current = next;
    setBus(next);
    if (previous && previous !== next) await previous.close();
    return next;
  }, []);

  useEffect(() => {
    void (async () => {
      const { config, corrupt } = loadFileConfig();
      const resolved = resolveConnection(config);
      setConn(resolved);
      if (corrupt) setNotice(`config file was unreadable ${glyphs.dash} please re-enter your details`);
      if (forceSetup || !resolved.redisUrl || !resolved.workspace) {
        setPhase("setup");
        return;
      }
      try {
        await openBus(resolved);
        setPhase("ready");
      } catch (e) {
        setNotice(
          `could not reach Redis at ${resolved.redisUrl} ${glyphs.dash} ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        setPhase("setup");
      }
    })();
    return () => {
      void busRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") renderer.destroy();
  });

  if (phase === "loading") {
    return (
      <box
        width="100%"
        height="100%"
        backgroundColor={colors.bg}
        justifyContent="center"
        alignItems="center"
        flexDirection="column"
        gap={1}
      >
        <FadeIn duration={350}>
          <Logo />
        </FadeIn>
        <text fg={colors.dim}>v{VERSION}</text>
        <Spinner label="connecting to your bus" />
      </box>
    );
  }

  if (phase === "setup" || !bus) {
    return (
      <SetupScreen
        initial={conn}
        notice={notice}
        onSaved={(c) => {
          setConn(c);
          setNotice(undefined);
          void openBus(c)
            .then(() => setPhase("ready"))
            .catch((e) => {
              setNotice(e instanceof Error ? e.message : String(e));
              setPhase("setup");
            });
        }}
      />
    );
  }

  return view.type === "room" ? (
    <RoomScreen
      bus={bus}
      conn={conn}
      roomId={view.roomId}
      onBack={() => setView({ type: "rooms" })}
      onOpenRoom={(id) => setView({ type: "room", roomId: id })}
    />
  ) : (
    <RoomsScreen
      bus={bus}
      conn={conn}
      onOpenRoom={(id) => setView({ type: "room", roomId: id })}
      onWorkspaceChanged={(ws) => {
        const next = { ...conn, workspace: ws };
        setConn(next);
        setView({ type: "rooms" });
      }}
      onSetup={() => setPhase("setup")}
    />
  );
}
