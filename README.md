# lb-inject

Runtime **bytecode injection** (mixin-style head/return/invoke/field hooks) for
**LiquidBounce** GraalJS scripts — with **no JDK required at runtime**.

A script calls `Inject.inject(class, method, position, hook)` and the library
rewrites the already-loaded method to call your hook. The heavy lifting (ASM +
the agent) lives in one precompiled, generic jar that's shipped with the
library; the script side is plain JS.

```js
load("/abs/path/nf-inject.js");                       // defines globalThis.Inject
var h = Inject.inject("net.minecraft.client.Minecraft", "getFps", "HEAD",
          function () { net.ccbluex.liquidbounce.utils.client.ClientChat.chat("getFps!"); });
Inject.remove(h);   Inject.list();   Inject.removeAll();
```

## Files

| file | what |
|---|---|
| `nf-inject.js` | the script library (`Inject` API). Load/inline it in your script. |
| `dist/nf-inject-agent.jar` | generic precompiled agent (premain + agentmain + a parameterized ASM injector + the attacher). Ship it in your `scripts/` folder. ASM is **not** bundled — Fabric already provides it (bundling triggers Fabric's "duplicate ASM classes" check). |
| `dist/nf-holder.jar` | bootstrap state holder, loaded via the agent jar's `Boot-Class-Path`. **Must sit next to `nf-inject-agent.jar`** at runtime. |
| `examples/inject-example.js` | a worked, self-contained userscript: registers a module that injects HEAD/RETURN/INVOKE hooks on enable and removes them on disable. |
| `src/NfInject.java`, `src/NfHolder.java`, `src/NfAttacher.java` | sources for the jars. |
| `build.sh` | compiles → `dist/nf-inject-agent.jar` + `dist/nf-holder.jar` (JDK 21). |

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

The injected bytecode is **bootstrap-only** —
`((Runnable) System.getProperties().get("nf.hook.<id>")).run()` — so the patched
class (loaded by Fabric's Knot loader) needs to resolve nothing but JDK classes;
ASM is bundled in the agent jar, so the injector works regardless of which
classloader loads the agent.

## Build

```bash
./build.sh            # -> dist/nf-inject-agent.jar + dist/nf-holder.jar (needs JDK 21 at JAVA_HOME)
./make-bundle.sh      # -> dist/nf-inject-bundled.js (optional single-file build; run after build.sh)
```

The jars are generic — build once and reuse for any script/injection.

## Single-file bundle (optional)

`make-bundle.sh` produces `dist/nf-inject-bundled.js`: both jars embedded as
base64. `load()` it like `nf-inject.js`, but you only ship **one** file — on
load it self-extracts the jars to a cache dir (`<java.io.tmpdir>/nf-inject/`,
holder kept next to the agent so the manifest's relative `Boot-Class-Path`
resolves) and points `Inject.agentJar` there.

```js
load("/abs/path/nf-inject-bundled.js");   // defines globalThis.Inject
Inject.inject("net.minecraft.client.Minecraft", "getFps", "HEAD", fn);
```

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
