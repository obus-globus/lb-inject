// lb-inject usage example — a self-contained LiquidBounce userscript.
//
// Drop this whole folder's deliverables into your LiquidBounce `scripts/` dir:
//   scripts/
//     nf-inject.js            (the library)
//     nf-inject-agent.jar     (the precompiled agent)
//     nf-holder.jar           (bootstrap holder; MUST sit next to the agent jar)
//     inject-example.js       (this file)
//
// It registers a module "InjectDemo". While enabled, it patches three points of
// net.minecraft.client.Minecraft with mixin-style hooks; disabling removes them
// and restores the original bytecode.
//
// Requires instrumentation, auto-detected by the library (see README):
//   - launched with -javaagent:nf-inject-agent.jar   -> works on ANY JRE, or
//   - a JDK runtime (jdk.attach, e.g. GraalVM)        -> self-attaches at runtime.
// If neither is available, Inject.inject(...) throws with guidance and the error
// is logged to the Minecraft log (latest.log) as a failed script load.

// Load the library — defines globalThis.Inject. Adjust the path if your scripts
// folder differs; Client.configSystem.rootFolder is the LiquidBounce root.
const _root = "" + Client.configSystem.rootFolder.getAbsolutePath();
load(_root + "/scripts/nf-inject.js");

const script = registerScript({ name: "InjectDemo", version: "1.0.0", authors: ["Obus"] });

script.registerModule(
    { name: "InjectDemo", category: "Misc", description: "Demonstrates runtime bytecode injection via lb-inject" },
    function (mod) {
        // Handles returned by Inject.inject(...), removed on disable.
        let handles = [];
        let fpsCalls = 0;

        mod.on("enable", function () {
            handles = [];
            fpsCalls = 0;

            // 1) HEAD of Minecraft.getFps — runs every time the FPS getter is
            //    called (render thread, so a JS hook is safe here).
            handles.push(Inject.inject(
                "net.minecraft.client.Minecraft", "getFps", "HEAD",
                function () { fpsCalls++; }
            ));

            // 2) RETURN of Minecraft.tick — fires once per client tick, right
            //    before the method returns.
            handles.push(Inject.inject(
                "net.minecraft.client.Minecraft", "tick", "RETURN",
                function () {
                    if (fpsCalls > 0 && fpsCalls % 600 === 0) {
                        Client.displayChatMessage("§b[InjectDemo] getFps called " + fpsCalls + " times");
                    }
                }
            ));

            // 3) BEFORE a specific call inside a method (mixin @At INVOKE). The
            //    5th arg is the target "owner.member" the hook fires around.
            //    Here: just before Minecraft.tick calls Minecraft.getFps.
            handles.push(Inject.inject(
                "net.minecraft.client.Minecraft", "tick", "BEFORE_INVOKE",
                function () { /* runs right before the getFps() call site */ },
                "net.minecraft.client.Minecraft.getFps"
            ));

            Client.displayChatMessage("§a[InjectDemo] injected " + handles.length + " hooks: " + Inject.list().join(", "));
        });

        mod.on("disable", function () {
            // Remove every hook this module added; restores original bytecode.
            const removed = handles.length;
            handles.forEach(function (h) { Inject.remove(h); });
            handles = [];
            Client.displayChatMessage("§c[InjectDemo] removed " + removed + " hooks (getFps was called " + fpsCalls + "x)");
        });
    }
);
