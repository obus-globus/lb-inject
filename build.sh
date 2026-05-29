#!/usr/bin/env bash
# Builds dist/nf-inject-agent.jar: the generic injection agent (NfInject) with
# ASM bundled in, plus the agent manifest. Compiled with JDK 21 so the jar loads
# on any Java 21+ runtime (LiquidBounce's minimum).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
JAVAC="$JAVA_HOME/bin/javac"; JAR="$JAVA_HOME/bin/jar"

# ASM to bundle (any 9.x reads the MC/LB class versions). Override with ASM_JAR=.
ASM_JAR="${ASM_JAR:-$(find "$HOME/.gradle/caches" -name 'asm-9*.jar' ! -name '*sources*' 2>/dev/null | sort -V | tail -1)}"
[ -f "$ASM_JAR" ] || { echo "FAIL: no ASM jar found (set ASM_JAR=)" >&2; exit 1; }
echo "ASM: $ASM_JAR"

rm -rf build && mkdir -p build dist
"$JAVAC" --release 21 --add-modules jdk.attach -cp "$ASM_JAR" -d build src/NfInject.java src/NfAttacher.java
( cd build && "$JAR" xf "$ASM_JAR" org )   # unpack ASM classes into build/org/objectweb/asm
rm -rf build/META-INF                       # drop ASM's manifest/module-info noise

cat > build/MANIFEST.MF <<'EOF'
Manifest-Version: 1.0
Premain-Class: NfInject
Agent-Class: NfInject
Can-Retransform-Classes: true
Can-Redefine-Classes: true
EOF

"$JAR" cfm dist/nf-inject-agent.jar build/MANIFEST.MF -C build NfInject.class -C build NfAttacher.class -C build org
echo "built dist/nf-inject-agent.jar ($(du -h dist/nf-inject-agent.jar | cut -f1))"
