// lb-inject — runtime bytecode injection for LiquidBounce GraalJS scripts.
//
//   load("/abs/path/nf-inject.js");           // defines globalThis.Inject
//   var h = Inject.inject("net.minecraft.client.Minecraft", "getFps", "HEAD",
//             function () { /* JS hook — runs at the inject point */ });
//   Inject.remove(h);  Inject.list();  Inject.removeAll();
//
// Positions: HEAD, RETURN, BEFORE_INVOKE, AFTER_INVOKE, BEFORE_FIELD, AFTER_FIELD.
// The *_INVOKE/_FIELD positions take a 5th arg = target "owner.member"
// (e.g. "net.minecraft.client.Minecraft.getFps").
//
// hook: a JS function OR a java.lang.Runnable, run at the injection point. A JS
// function runs on whatever thread the patched method runs on, so it's only safe
// for points on the client/render thread (ticks, render, getFps, …). For points
// that fire on other threads, pass a precompiled java.lang.Runnable instead.
//
// Instrumentation is obtained with NO JDK needed at runtime, via the precompiled
// nf-inject-agent.jar (ASM bundled). The library auto-detects how to load it:
//   1. launched with `-javaagent:nf-inject-agent.jar`  -> premain already ran
//      (works on any JRE; nothing else needed)
//   2. else a JDK runtime (jdk.attach present, e.g. GraalVM)  -> the lib spawns
//      the bundled attacher to attach + loadAgent at runtime
//   3. neither -> throws with guidance.
// The injected bytecode is bootstrap-only:
//   ((Runnable) System.getProperties().get("nf.hook.<id>")).run()

(function () {
    const System_ = Java.type("java.lang.System");
    const ProcessBuilder = Java.type("java.lang.ProcessBuilder");
    const ProcessHandle = Java.type("java.lang.ProcessHandle");
    const JString = Java.type("java.lang.String");
    const Paths = Java.type("java.nio.file.Paths");
    const Files = Java.type("java.nio.file.Files");
    const RunnableAdapter = Java.extend(Java.type("java.lang.Runnable"));

    const Integer_ = Java.type("java.lang.Integer");

    function rootFolder() {
        try { return "" + Client.configSystem.rootFolder.getAbsolutePath(); }
        catch (e) { return "" + System_.getProperty("user.dir"); }
    }

    // NfHolder is bootstrap-loaded once the agent is active; before that, Java.type
    // throws (class not found), which we treat as "not loaded yet".
    function holder() { try { return Java.type("NfHolder"); } catch (e) { return null; } }

    const Inject = {
        // Path to the precompiled generic agent jar (nf-holder.jar must sit next to
        // it). Defaults to <LiquidBounce>/scripts/nf-inject-agent.jar.
        agentJar: null,
        _handles: {},
        _n: 0,

        _jar() { return this.agentJar ? ("" + this.agentJar) : Paths.get(rootFolder(), "scripts", "nf-inject-agent.jar").toString(); },

        ready() { const H = holder(); return H !== null && H.injector !== null; },

        // Ensure NfHolder.injector / .inst are available (idempotent).
        ensure() {
            if (this.ready()) return;                                   // -javaagent premain, or prior attach
            const jar = this._jar();
            if (!Files.exists(Paths.get(jar))) throw new Error("nf-inject: agent jar not found at " + jar + " (set Inject.agentJar)");
            // JDK path: spawn the bundled external attacher (needs jdk.attach in java.home)
            const javaBin = "" + System_.getProperty("java.home") + "/bin/java";
            const pid = "" + ProcessHandle.current().pid();
            const pb = new ProcessBuilder(Java.to([javaBin, "-cp", jar, "--add-modules", "jdk.attach", "NfAttacher", pid, jar], "java.lang.String[]"));
            pb.redirectErrorStream(true);
            const proc = pb.start();
            const out = "" + new JString(proc.getInputStream().readAllBytes());
            proc.waitFor();
            if (!this.ready()) {
                throw new Error("nf-inject: could not obtain Instrumentation. Launch with " +
                    "-javaagent:" + jar + " (works on any JRE), or use a JDK runtime (jdk.attach) " +
                    "so the attacher can attach. Attacher said: " + out.trim());
            }
        },

        inject(className, method, position, hook, invokeTarget) {
            this.ensure();
            const H = holder();
            const id = ++this._n;
            const runnable = (typeof hook === "function") ? new RunnableAdapter({ run: hook }) : hook;
            H.hooks.put(Integer_.valueOf(id), runnable);
            const internal = ("" + className).replace(/\./g, "/");
            let tOwner = null, tName = null;
            if (invokeTarget) {
                const s = ("" + invokeTarget).replace(/\//g, ".");
                const dot = s.lastIndexOf(".");
                tOwner = s.slice(0, dot).replace(/\./g, "/");
                tName = s.slice(dot + 1);
            }
            const tr = H.injector.apply(Java.to([H.inst, internal, method, position, id, tOwner, tName], "java.lang.Object[]"));
            const handle = "inj#" + id;
            this._handles[handle] = { tr, id, internal };
            return handle;
        },

        remove(handle) {
            const h = this._handles[handle];
            if (!h) return "no such handle: " + handle;
            const H = holder();
            H.remover.apply(Java.to([H.inst, h.tr, h.internal], "java.lang.Object[]"));
            H.hooks.remove(Integer_.valueOf(h.id));
            delete this._handles[handle];
            return "removed " + handle;
        },
        removeAll() { const ks = Object.keys(this._handles); ks.forEach((k) => this.remove(k)); return "removed " + ks.length; },
        list() { return Object.keys(this._handles); },
    };

    globalThis.Inject = Inject;
})();
