// lb-inject "always-on" example — a LiquidBounce userscript that installs its
// hooks at load time and keeps them active for the whole session. Unlike
// inject-example.js it registers NO module; there is nothing to toggle.
//
// Drop this + the library (nf-inject.js + jars, OR nf-inject-bundled.js) in your
// scripts/ folder. Instrumentation requirements are the same as the README
// (-javaagent on any JRE, or a JDK runtime so it can self-attach).

// Load the library — auto-detect whichever deliverable is present (plain first).
// IMPORTANT: load() the library BEFORE registerScript(...) so our registration
// below takes precedence over the library's auto-load guard.
const _root = "" + Client.configSystem.rootFolder.getAbsolutePath();
(function () {
    const Files = Java.type("java.nio.file.Files");
    const Paths = Java.type("java.nio.file.Paths");
    const candidates = ["nf-inject.js", "nf-inject-bundled.js"];
    for (const name of candidates) {
        const p = Paths.get(_root, "scripts", name);
        if (Files.exists(p)) { load(p.toString()); return; }
    }
    throw new Error("InjectAlwaysOn: no nf-inject library found in scripts/ (expected one of: " + candidates.join(", ") + ")");
})();

// A script still must call registerScript(...) even with no module, otherwise
// LiquidBounce rejects it with "missing required information!".
registerScript({ name: "InjectAlwaysOn", version: "1.0.0", authors: ["Obus"] });

const System_ = Java.type("java.lang.System");

// Idempotency guard. LiquidBounce re-runs scripts on `.script reload`, which
// would stack duplicate injections (each load owns its own Inject handles). A
// shared sentinel (a bootstrap System property, visible across script contexts)
// makes the install happen at most once per game session.
if (System_.getProperty("nf.alwayson.installed") === null) {
    try {
        let ticks = 0;

        // Minecraft.tick fires continuously (even at the main menu), so this hook
        // is genuinely "always on". Chat a heartbeat roughly once a minute.
        Inject.inject("net.minecraft.client.Minecraft", "tick", "RETURN", function () {
            if (++ticks % 1200 === 0) {
                Client.displayChatMessage("§b[InjectAlwaysOn] tick hook alive — " + ticks + " ticks");
            }
        });

        System_.setProperty("nf.alwayson.installed", "true");
        Client.displayChatMessage("§a[InjectAlwaysOn] hook installed (active for the whole session)");
    } catch (e) {
        Client.displayChatMessage("§c[InjectAlwaysOn] failed to install: " + e);
    }
} else {
    Client.displayChatMessage("§e[InjectAlwaysOn] already installed this session — skipping re-inject");
}
