# dsh-scratch-cleaner

[English](./README.md) | [中文](./README.zh.md)

A DeepSeek Harness host plugin that gives an agent one designated place for throwaway scripts, and empties that place at the end of every turn.

**In one line:** zero configuration, no API keys, no model downloads — install it and the workspace stops collecting one-off scripts.

## Before and after

A day of agent work, without the plugin:

```
project/
  src/…
  probe-config.mjs        ← written to answer one question
  probe2.mjs              ← the answer was wrong, so a second probe
  check-final.mjs         ← "final" for about ten minutes
```

The same day, with the plugin:

```
project/
  src/…
  .dsh-scratch/           ← emptied at the end of every turn
```

and each turn end says exactly what it removed:

```
scratch-cleaner: turn 12 deleted 3 entries from D:\project\.dsh-scratch: probe-config.mjs, probe2.mjs, check-final.mjs
```

## The problem

Ask an agent to investigate something and it writes a script: a probe of a config file, a one-off harness for a tricky API, a temporary driver that checks one assumption. That is exactly what you want it to do — and it is also how a clean repository quietly fills up with `probe.mjs`, `probe2.mjs`, `check-final.mjs`.

Three things make this worse than ordinary clutter:

- **You cannot tell what is rubbish.** The script that verified last week's assumption looks exactly like the script that fixes tomorrow's bug.
- **Deleting by hand is a judgement call every time**, so it is done late if at all.
- **Deleting by rule is dangerous.** "Remove files younger than a day and not referenced anywhere" eventually removes something real.

Warnings in the prompt help a little, and only a little: the workspace still ends up holding both kinds of file, with nothing to distinguish them.

## What it costs, what it buys

Cost, stated plainly — this is a small plugin, not a performance feature:

- One directory read per session per turn end, plus removal of whatever that directory holds. Nothing runs during a turn, so cleanup never slows the agent's own work.
- No file watcher, no polling, no background process, no index, no network call, and no runtime dependency (the schema helper is bundled into the built entry).
- The cost is bounded by one directory, so it does not grow with the size of the workspace, and it does not walk the project tree.

What it buys:

- The workspace stays the size of the project, so tree-walking tools — file search, editor indexing, diffs — stop carrying one-off scripts.
- Later turns stop reading the agent's own obsolete probes, which keeps the context about the work rather than about the scaffolding.
- Nothing has to be classified: there is no scan, no age heuristic, and nothing to get wrong.

## The idea

Stop trying to recognise rubbish. Give throwaway work a **place**, and make that place temporary:

1. Tell the agent, in the system prompt, that throwaway scripts belong in `<working directory>/.dsh-scratch/`.
2. When the turn ends, delete what is in that directory.

The convention does the sorting; the directory does the containing; the turn end does the cleaning. A script that must survive is by definition not a throwaway script, so it never goes in that directory — and everything inside it can be deleted without inspecting a single file.

## What makes it careful

- **It touches one directory.** Only the immediate children of the configured scratch directory are read and removed. A probe left loose in the workspace is never touched — the plugin cannot clean up after an agent that ignores the convention, and does not try.
- **It cleans at turn end, not mid-turn.** The answer the turn produced can still refer to the scripts it wrote.
- **It says what it did.** With `logReclaimed` on (the default) each turn end logs the names it removed, so the cleanup is auditable rather than mysterious.
- **It does not invent a working directory.** The path comes from the session header; a session without one is skipped rather than guessed at.
- **One failure does not stop the rest.** If an entry cannot be removed, the remaining entries are still processed and the next turn end retries.

Deletion is immediate and final: there is no trash and no retention window. That is the point — anything worth keeping does not belong in the scratch directory.

## Install

```sh
# from the npm registry
dsh plugin add @nutshelllee/dsh-scratch-cleaner

# or from a checkout
dsh plugin add link:/absolute/path/to/dsh-scratch-cleaner
```

Then enable it in the profile manifest (`dsh.profile.bundles`) and restart the app so the host half loads. In the DSH desktop app the plugin page installs it by package name.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `scratchDir` | `.dsh-scratch` | Scratch directory name, resolved inside each session's working directory. |
| `logReclaimed` | `true` | Log one line per turn naming what was deleted. |

Override in the profile patch, on the same row id:

```yaml
- id: scratch-cleaner
  config:
    scratchDir: .probe
    logReclaimed: true
```

## Verify

```sh
node test/scratch-cleaner.test.mjs
```

Nine behaviour tests run against isolated working directories; none of them touch real sessions. They cover the defaults, a custom scratch directory, nested trees, an empty directory, a missing directory, a session without a working directory, and the case that matters most: loose scripts beside the scratch directory must survive.

# Rebuild

`lib/index.js` is the readable source; `lib/plugin.js` is the built entry the loader imports, with `schemastery` bundled in so a profile install has nothing to resolve at load time.

```sh
node build.mjs
```

## Compatibility

| DSH (`@deepseek-ai/*`) | Status |
| --- | --- |
| 0.2.0-rc.2 (DSH NEXT desktop `2.0.17-next`) | verified in daily use |
| other versions | untested; the plugin uses only `systemPrompt` and `session/event` |

## Limits

- Deletion is final. A script a later turn needs must not be left in the scratch directory.
- The plugin cannot see through a convention that is ignored: if the agent writes probes elsewhere, they stay there.
- An entry that cannot be removed is retried at the next turn end; failures are logged, never silent.

## Releases

A new version number is published only when runtime behaviour, the public interface, or the installation path changes. Documentation-only changes ride along with the next real change instead of taking a number of their own — the version list is public, and every number is something someone may pin.

What each published version contains is in [docs/CHANGELOG.md](./docs/CHANGELOG.md).

## License

MIT
