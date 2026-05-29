# lb-inject

Runtime **bytecode injection** (mixin-style head/return/invoke/field hooks) for
**LiquidBounce** GraalJS scripts — with **no JDK required at runtime**.

A script calls `Inject.inject(class, method, position, hook)` and the library
rewrites the already-loaded method to call your hook. The heavy lifting (ASM +
the agent) lives in one precompiled, generic jar that's shipped with the
library; the script side is plain JS.

```js
// In your userscript — see examples/ for the ensureLib(...) loader preamble.
load(ensureLib("1.0.0"));                              // defines globalThis.Inject
var h = Inject.inject("net.minecraft.client.Minecraft", "getFps", "HEAD",
          function () { Client.displayChatMessage("getFps!"); });
Inject.remove(h);   Inject.list();   Inject.removeAll();
```

## Files

| file | what |
|---|---|
| `nf-inject.js` | the script library source (`Inject` API). `build`/`make-bundle.sh` emit versioned copies into `dist/`. |
| `dist/nf-inject-<ver>.js` | versioned plain library — deploy this (the version is in the name so multiple versions can coexist). |
| `dist/nf-inject-bundled-<ver>.js` | versioned single-file build with both jars embedded (self-extracts on load). |
| `dist/nf-inject-agent.jar` | generic precompiled agent (premain + agentmain + a parameterized ASM injector + the attacher). ASM is **not** bundled — Fabric already provides it (bundling triggers Fabric's "duplicate ASM classes" check). |
| `dist/nf-holder.jar` | bootstrap state holder, loaded via the agent jar's `Boot-Class-Path`. **Must sit next to `nf-inject-agent.jar`** at runtime. |
| `examples/` | worked userscripts (module-toggle + always-on) and their README. |
| `src/NfInject.java`, `src/NfHolder.java`, `src/NfAttacher.java` | sources for the jars. |
| `build.sh` | compiles → `dist/nf-inject-agent.jar` + `dist/nf-holder.jar` (JDK 21). |
| `make-bundle.sh` | emits the versioned `dist/nf-inject-bundled-<ver>.js` + `dist/nf-inject-<ver>.js`. |

## Layout & versioning

Libraries live in **`scripts/lib/`**, named with their version
(`nf-inject-1.0.0.js` / `nf-inject-bundled-1.0.0.js`). Putting them in a
subfolder means LiquidBounce does **not** auto-load them as standalone scripts
(it only auto-loads `main.*` inside a subfolder), and the version in the name
lets several versions coexist so an old script keeps working when you add a new
one. Your script pins the version it wants via `ensureLib("1.0.0")` (see
`examples/`), which exposes itself as `Inject.VERSION`.

If you drop a library file directly in `scripts/` instead, it still works: on
first load it **relocates itself into `scripts/lib/`**. The bundle's jars
self-extract into `scripts/lib/nf-inject-<ver>/` (holder kept next to the agent
so the manifest's relative `Boot-Class-Path` resolves) — not a random temp dir.

> LiquidBounce logs a one-line `WARN: Unable to find main inside the directory
> lib.` each launch, because it scans every subfolder for a `main.*`. It's
> harmless. To silence it you may drop a no-op `main.js` (calling
> `registerScript(...)`) into `scripts/lib/` yourself — we don't ship one.

## Positions

`HEAD`, `RETURN`, `BEFORE_INVOKE`, `AFTER_INVOKE`, `BEFORE_FIELD`, `AFTER_FIELD`
(map to Mixin `@At` `HEAD`/`RETURN`/`INVOKE`/`FIELD`). The `*_INVOKE`/`*_FIELD`
positions take a 5th arg — the target `"owner.member"`, e.g.
`Inject.inject(cls, "tick", "BEFORE_INVOKE", hook, "net.minecraft.client.Minecraft.getFps")`.

Not supported (need a richer hook ABI than a no-arg `Runnable` — args / return /
cancel): Mixin `@Redirect`, `@Overwrite`, `@ModifyArg(s)`, `@ModifyVariable`,
`@ModifyConstant`, `@ModifyReturnValue`, cancellable `@Inject`, and `TAIL`.

## Hooks

`hook` is a **JS function** or a **`java.lang.Runnable`**, run at the injection
point. A JS function runs on whatever thread the patched method runs on, so it's
safe for points on the client/render thread (ticks, render, `getFps`, …). For
points that fire on other threads, pass a precompiled `java.lang.Runnable`.

## How `Instrumentation` is obtained (auto-detected)

Bytecode injection needs a `java.lang.instrument.Instrumentation`. `Inject.ensure()`
(called automatically on first `inject`) picks the right method:

1. **`-javaagent:nf-inject-agent.jar`** at launch → the agent's `premain` already
   published everything. **Works on any JRE — no JDK, no attach.** Add it via the
   launcher's custom JVM args.
2. **A JDK runtime** (the `java.home` has the `jdk.attach` module, e.g. **GraalVM**
   in LiquidLauncher) → the library spawns the bundled attacher to attach + load
   the agent at runtime. No `-javaagent` flag needed.
3. Neither → throws with guidance.

> Of LiquidLauncher's Java options, **Temurin/Zulu JREs lack `jdk.attach`** (and
> `jdk.compiler`), so on those the **`-javaagent` route is required**; **GraalVM**
> (a JDK) supports the runtime-attach route directly.

The injected bytecode calls into the bootstrap-loaded `NfHolder.fire(<id>)` — so
the patched class (loaded by Fabric's Knot loader) resolves nothing but a
bootstrap class. ASM is not bundled (Fabric provides it); the agent only
compiles against it.

## Build

```bash
./build.sh            # -> dist/nf-inject-agent.jar + dist/nf-holder.jar (needs JDK 21 at JAVA_HOME)
./make-bundle.sh      # -> dist/nf-inject-bundled-<ver>.js + dist/nf-inject-<ver>.js (run after build.sh)
```

The jars are generic — build once and reuse for any script/injection. The
version comes from the `VERSION` constant in `nf-inject.js`; `make-bundle.sh`
stamps it into the output filenames.

## Single-file bundle

`make-bundle.sh` produces `dist/nf-inject-bundled-<ver>.js`: both jars embedded
as base64. You ship **one** file — drop it in `scripts/` (it relocates itself
into `scripts/lib/`) and `load()` it from your script (use `ensureLib(...)`,
see `examples/`). On load it self-extracts the jars into
`scripts/lib/nf-inject-<ver>/` (holder next to the agent so the manifest's
relative `Boot-Class-Path` resolves) and points `Inject.agentJar` there.

This only helps the **runtime-attach path** (JDK runtime, e.g. GraalVM): the
attach API loads the agent from a filesystem path at the moment you inject, so
self-extracting just-in-time works. The **`-javaagent` path can't use the
bundle** — that flag is read by the JVM at launch (before any script runs) and
needs the jar on disk then, so those users still ship `nf-inject-agent.jar` +
`nf-holder.jar`. (There's no in-memory route: `loadAgent` takes a file, and
defining classes in memory would itself require the `Instrumentation` the jar
provides.)

## Notes / caveats

- Precompiled bytecode of the agent is version-agnostic, but the **classes you
  target** (MC/LB) are Mojang-mapped and version-specific (currently MC `26.1.2`)
  — use the correct names for the version you run against.
- `remove`/`removeAll` restore the original bytecode (`removeTransformer` +
  retransform), then drop the hook.
- LiquidBounce auto-loads **every** `.js` in `scripts/` as a standalone script,
  so the library file (`nf-inject.js` / `nf-inject-bundled.js`) gets loaded on
  its own too. To avoid a "missing required information" error, the library
  calls `registerScript(...)` with benign info, so that stray load is just a
  harmless empty script named `nf-inject (library)` in your script list.
- In your own script, `load()` the library **before** your `registerScript(...)`
  so your registration takes precedence.
- Modules only activate **in-game** — toggling a module that injects (like the
  example) does nothing at the main menu; join a world first.
