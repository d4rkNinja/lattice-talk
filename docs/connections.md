# Connection profiles

A *connection profile* is a named, saved Redis connection — "personal",
"office", "team-staging" — each with its own namespace, workspace, join token,
and optional SSH tunnel. The active profile's fields are mirrored into the
flat top-level keys of `~/.lattice/config.json`, so everything that reads the
config (`serve`, `mcp add`, harness env injection, the dashboard) always sees
the active connection without knowing profiles exist.

```json
{
  "active": "office",
  "redisUrl": "redis://10.20.0.5:6379/0",
  "namespace": "prod",
  "workspace": "api",
  "sshHost": "bastion.example.com",
  "sshUser": "deploy",
  "sshPort": "2222",
  "profiles": {
    "office":   { "redisUrl": "redis://10.20.0.5:6379/0", "namespace": "prod",
                  "workspace": "api", "sshHost": "bastion.example.com",
                  "sshUser": "deploy", "sshPort": "2222" },
    "personal": { "redisUrl": "redis://127.0.0.1:6379", "namespace": "dev",
                  "workspace": "main" }
  }
}
```

## CLI

```bash
lattice-talk connections                  # list — ▸ marks active
lattice-talk connections show office      # one profile, secrets masked
lattice-talk connections add personal --redis redis://127.0.0.1:6379
lattice-talk connections add office \
  --redis redis://10.20.0.5:6379/0 --namespace prod --workspace api \
  --token $OFFICE_TOKEN \
  --ssh deploy@bastion.example.com:2222 --ssh-key ~/.ssh/id_ed25519
lattice-talk connections use office       # test, switch, re-point harnesses
lattice-talk connections remove personal
```

`add` flags:

| Flag | Meaning |
| --- | --- |
| `--redis URL` | Redis URL (`redis://` / `rediss://`). Omit it to open the guided setup screen instead — same form the dashboard uses, saved into this profile. |
| `--namespace` / `--ns` | Key namespace (default `dev`). |
| `--workspace` / `--ws` | Session id agents join. |
| `--token` | Join token for protected workspaces. |
| `--ssh [user@]host[:port]` | Bastion — opens `ssh -N -L` before connecting. |
| `--ssh-key PATH` | Identity file for the tunnel. |
| `--ssh-local-port N` | Pin the local forward port (default: free ephemeral). |
| `--switch` | Make this profile active immediately. |
| `--no-test` | Skip the connectivity check (`use` also accepts it). |

Rules:

- `add` tests the connection before saving; `--no-test` skips. `use` tests
  before switching and stays on the current connection if the target is
  unreachable — `--no-test` overrides.
- `add` auto-activates only when nothing is configured yet; otherwise pass
  `--switch` or run `connections use <name>` after.
- Switching (or deleting the active profile, which promotes the next one)
  rewrites every installed harness's MCP env and regenerates `/l-talk-new`
  prompt files, so agents launched after the switch land on the new bus.
  Restart running harness sessions — env is baked at process spawn.
- Env vars still win: `LATTICE_REDIS_URL` etc. override the active profile
  without touching it.

## In the dashboard

Press `c` on the rooms screen. Pick a profile → **Use this connection**
(pings the bus, then switches and re-points installed harnesses), **Delete**
(confirms; deleting the active profile promotes the next one and reconnects),
or **+ New connection** — names the profile, then drops into the guided setup
form including the SSH tunnel section. `lattice-talk setup --profile <name>`
does the same from the shell.

The plain `s` setup flow edits the *active* connection — when a profile is
active, saving writes back into that profile so the two never diverge.

## SSH tunnels

Each profile can carry its own bastion — handy when "office" needs the tunnel
and "personal" doesn't. `--ssh` accepts `[user@]host[:port]`; auth is
non-interactive (ssh agent, key file, `~/.ssh/config`; `BatchMode=yes`). The
dashboard, `serve`, `bridge`, and harness-spawned MCP servers all open the
tunnel themselves — it travels with the connection, not the process.
