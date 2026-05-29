# lb-inject examples

Worked examples for the `Inject` API. See the [top-level README](../README.md)
for the full API reference and how instrumentation is obtained.

## `inject-example.js`

A self-contained LiquidBounce userscript. It registers a module **InjectDemo**
that, while enabled, patches three points of `net.minecraft.client.Minecraft`
with mixin-style hooks, and removes them (restoring the original bytecode) when
disabled:

- `getFps` at `HEAD` — counts every call (render thread, so a JS hook is safe).
- `tick` at `RETURN` — periodic chat message.
- `tick` at `BEFORE_INVOKE` of `getFps` — fires right before that call site
  (the 5th `inject` arg is the target `"owner.member"`).

### Run it

1. Build the jars (or grab them from `dist/`):

   ```bash
   ./build.sh          # -> dist/nf-inject-agent.jar + dist/nf-holder.jar
   ```

2. Copy the deliverables into your LiquidBounce `scripts/` folder. The example
   auto-detects whichever library file is present (plain preferred), so pick one:

   **Plain library** (three files):
   ```
   scripts/
     nf-inject.js            # the library  (from repo root)
     nf-inject-agent.jar     # from dist/
     nf-holder.jar           # from dist/   (MUST sit next to the agent jar)
     inject-example.js       # this example
   ```

   **Single-file bundle** (jars embedded; runtime-attach path only — see the
   top-level README):
   ```
   scripts/
     nf-inject-bundled.js    # from dist/ (self-extracts the jars)
     inject-example.js       # this example
   ```

3. Make sure instrumentation is available (the library auto-detects which):
   - launch LiquidBounce with `-javaagent:nf-inject-agent.jar` (works on **any
     JRE** — add it via the launcher's custom JVM args), **or**
   - run on a **JDK** runtime (has `jdk.attach`, e.g. GraalVM in LiquidLauncher)
     so the library can self-attach at runtime.

   If neither is present, `Inject.inject(...)` throws with guidance and the
   error is logged to `logs/latest.log` as a failed script load.

4. Start the client, open the ClickGUI, and toggle the **InjectDemo** module.
   You'll see a chat line listing the injected hooks on enable, and a removal
   line on disable.

### Adapt it

Change the class/method/position to hook whatever you need. Targets are
**Mojang-mapped** and version-specific (currently MC `26.1.2`) — use the names
for the version you run against (see the mappings link in the top-level README).
Positions: `HEAD`, `RETURN`, `BEFORE_INVOKE`, `AFTER_INVOKE`, `BEFORE_FIELD`,
`AFTER_FIELD`.
