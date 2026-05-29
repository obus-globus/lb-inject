import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.security.ProtectionDomain;
import java.util.Properties;
import java.util.function.Function;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

/**
 * Generic, precompiled injection agent for LiquidBounce GraalJS scripts.
 *
 * Two ways it gets an {@link Instrumentation}, both routed through the same
 * static init:
 *   - launch-time:  java -javaagent:nf-inject-agent.jar   -> premain(..)
 *   - runtime:      VirtualMachine.attach(pid).loadAgent(jar) -> agentmain(..)
 *
 * On init it publishes, in System properties:
 *   "nf.inst"            the Instrumentation
 *   "nf.inject.injector" Function<Object[],Object>  apply([inst, classInternal,
 *                          method, position, hookId, targetOwner|null,
 *                          targetName|null]) -> the registered ClassFileTransformer
 *   "nf.inject.remover"  Function<Object[],Object>  apply([inst, transformer,
 *                          classInternal]) -> "removed"
 *   "nf.inject.ready"    "true"
 *
 * The script side puts its hook Runnable at  "nf.hook.<id>"  and the injected
 * bytecode is BOOTSTRAP-ONLY — it does
 *     ((Runnable) System.getProperties().get("nf.hook.<id>")).run()
 * so the target class (loaded by Fabric's Knot loader) needs to resolve nothing
 * but JDK classes. ASM is bundled into this jar, so the injector itself works no
 * matter which classloader loads the agent.
 *
 * Positions: HEAD, RETURN, BEFORE_INVOKE, AFTER_INVOKE, BEFORE_FIELD, AFTER_FIELD.
 */
public final class NfInject {

    public static void premain(String args, Instrumentation inst) { init(inst); }
    public static void agentmain(String args, Instrumentation inst) { init(inst); }

    private static void init(Instrumentation inst) {
        Properties p = System.getProperties();
        p.put("nf.inst", inst);
        p.put("nf.inject.injector", (Function<Object[], Object>) NfInject::inject);
        p.put("nf.inject.remover", (Function<Object[], Object>) NfInject::remove);
        p.put("nf.inject.ready", "true");
    }

    private static Object inject(Object[] a) {
        final Instrumentation inst = (Instrumentation) a[0];
        final String clazz = (String) a[1];          // internal name: net/minecraft/client/Minecraft
        final String method = (String) a[2];
        final String pos = (String) a[3];
        final int id = ((Number) a[4]).intValue();
        final String tOwner = (String) a[5];          // INVOKE/FIELD target owner (internal) or null
        final String tName = (String) a[6];           // INVOKE/FIELD target member or null
        final String key = "nf.hook." + id;

        ClassFileTransformer tr = new ClassFileTransformer() {
            @Override
            public byte[] transform(ClassLoader loader, String cn, Class<?> cbr, ProtectionDomain pd, byte[] buf) {
                if (cn == null || !cn.equals(clazz)) return null;
                ClassReader cr = new ClassReader(buf);
                ClassWriter cw = new ClassWriter(cr, ClassWriter.COMPUTE_MAXS);
                cr.accept(new ClassVisitor(Opcodes.ASM9, cw) {
                    @Override
                    public MethodVisitor visitMethod(int ac, String n, String d, String s, String[] e) {
                        MethodVisitor mv = super.visitMethod(ac, n, d, s, e);
                        if (mv == null || !n.equals(method)) return mv;
                        return new MethodVisitor(Opcodes.ASM9, mv) {
                            // ((Runnable) System.getProperties().get(key)).run()  — bootstrap-only
                            private void fire() {
                                super.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/System", "getProperties", "()Ljava/util/Properties;", false);
                                super.visitLdcInsn(key);
                                super.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/Properties", "get", "(Ljava/lang/Object;)Ljava/lang/Object;", false);
                                super.visitTypeInsn(Opcodes.CHECKCAST, "java/lang/Runnable");
                                super.visitMethodInsn(Opcodes.INVOKEINTERFACE, "java/lang/Runnable", "run", "()V", true);
                            }
                            @Override public void visitCode() {
                                super.visitCode();
                                if (pos.equals("HEAD")) fire();
                            }
                            @Override public void visitInsn(int op) {
                                if (op >= Opcodes.IRETURN && op <= Opcodes.RETURN && pos.equals("RETURN")) fire();
                                super.visitInsn(op);
                            }
                            @Override public void visitMethodInsn(int op, String o, String nm, String dd, boolean itf) {
                                boolean m = tOwner != null && o.equals(tOwner) && nm.equals(tName);
                                if (m && pos.equals("BEFORE_INVOKE")) fire();
                                super.visitMethodInsn(op, o, nm, dd, itf);
                                if (m && pos.equals("AFTER_INVOKE")) fire();
                            }
                            @Override public void visitFieldInsn(int op, String o, String nm, String dd) {
                                boolean m = tOwner != null && o.equals(tOwner) && nm.equals(tName);
                                if (m && pos.equals("BEFORE_FIELD")) fire();
                                super.visitFieldInsn(op, o, nm, dd);
                                if (m && pos.equals("AFTER_FIELD")) fire();
                            }
                        };
                    }
                }, 0);
                return cw.toByteArray();
            }
        };
        inst.addTransformer(tr, true);
        try {
            inst.retransformClasses(Class.forName(clazz.replace('/', '.'), false, Thread.currentThread().getContextClassLoader()));
        } catch (Throwable ex) {
            inst.removeTransformer(tr);
            throw new RuntimeException(String.valueOf(ex));
        }
        return tr;
    }

    private static Object remove(Object[] a) {
        Instrumentation inst = (Instrumentation) a[0];
        inst.removeTransformer((ClassFileTransformer) a[1]);
        try {
            inst.retransformClasses(Class.forName(((String) a[2]).replace('/', '.'), false, Thread.currentThread().getContextClassLoader()));
        } catch (Throwable ignored) { }
        return "removed";
    }

    private NfInject() { }
}
