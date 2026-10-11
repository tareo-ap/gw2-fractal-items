# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.
User-facing setup and usage docs live in `README.md`; this file only holds working rules.

## Project in one paragraph

A web app that loads all Guild Wars 2 items from the official API into SQLite and shows which
gizmos and consumables might be usable in Fractals of the Mist (criterion: `game_types` contains `Dungeon`).
`server/` is a Node.js backend (Hono, `node:sqlite`), `web/` is React + Vite, `shared/` holds types and rules
used by both. There is also a static read-only build for GitHub Pages that reads `site-data/` instead of the API.

## Commands

```bash
npm run dev            # server (3000) and web (5173) together
npm test               # backend tests (node:test, against a fake GW2 API)
npm run typecheck      # server and web
npm run format         # Prettier, writes changes
npm run format:check   # Prettier, check only
npm run build:pages    # static GitHub Pages build (needs site-data/)
```

Run `npm run typecheck`, `npm test` and `npm run format:check` before reporting a task as done.

## Code style

- Formatting is enforced by `.editorconfig` and Prettier (`.prettierrc.json`): 4 spaces, single quotes,
  semicolons, 120 columns. YAML uses 2 spaces. Do not hand-format; run `npm run format`.
- `site-data/` and `package-lock.json` are generated and excluded from Prettier.
- Everything in the repository is in English: code, comments, test names, commit messages, server messages.
  Only the German UI strings (`web/src/lib/i18n.ts`) and German test data stay German.
- Names must be understandable without context. Prefer `fractalCandidate` over `fc`, `itemDetails` over `d`.
  If a name uses a term from Guild Wars 2 or from a library (e.g. "gizmo", "tonic", "game type",
  Hono's "context"), explain it once in a comment where it is defined, or see the glossary below.
- Comment the "why", and give every exported function and non-trivial loop a short comment saying what it does.
- Formatting-only changes and logic changes go into separate commits.

## Glossary (Guild Wars 2 terms)

| Term                     | Meaning                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fractals of the Mist     | Instanced 5-player dungeon content. The API marks items usable there with game type `Dungeon`.                                                                  |
| Game type (`game_types`) | Where an item may be used: `Activity`, `Dungeon`, `Pve`, `Pvp`, `PvpLobby`, `Wvw`.                                                                              |
| Candidate                | An item whose game types contain `Dungeon`, so it might work in Fractals. Whether it really does is tested by hand (test status).                               |
| Gizmo                    | Item type for usable miscellaneous items (kits, toys, tonics, etc.).                                                                                            |
| Consumable               | Item type for things that are used up (food, utility, boosters, tonics...). Its `details.type` is the subtype (`Food`, `Utility`, `Generic`, `Immediate`, ...). |
| Tonic                    | Transformation item. Exists as Gizmo or Consumable; the app shows them in their own tab across both types.                                                      |
| Rarity                   | Item quality, `Junk` to `Legendary`.                                                                                                                            |
| Build ID                 | Version number of the game client. A new build means a patch, which triggers an update check.                                                                   |

## Agent workflow

The project owner ("Dev") has local subagents in `~/.claude/agents`: researcher, architect, developer, tester, reviewer, docs-writer.
For feature work use them in this order:

1. **researcher** when a technical question is open (API fields, library choice).
2. **architect** writes a short plan to `docs/plan.md`. Dev sees the plan before anything is built.
3. Per task: **developer** implements, **tester** adds and runs tests, **reviewer** reviews.
   At most two review rounds; round two only looks at what changed after round one.

Report in the thread which agent did what. Small, mechanical changes (typos, config) do not need the full chain.

`docs/` is local only (in `.gitignore`), so plans and research notes never reach GitHub.

## Git rules

- Work on a feature branch, never directly on `main`.
- Ask Dev before **every** commit; Dev looks over the code first.
- Never push. Dev pushes to Forgejo; GitHub is only a push mirror of Forgejo.
- Use the commit author from the repo git config. Never write real names, e-mail addresses or other personal data
  into the repository (code, docs, commit messages); refer to the project owner as "Dev".

## Pitfalls

- `npm run dev` runs the server with `node --watch`. Editing files under `server/` or `shared/` restarts it,
  which aborts a running item update (takes several minutes and cannot resume). If Dev says an update is running,
  only touch `web/` or wait.
- `site-data/` is about 10 MB of JSON. Anything added to the export (e.g. descriptions) grows every export commit;
  measure the size before changing the export format.
