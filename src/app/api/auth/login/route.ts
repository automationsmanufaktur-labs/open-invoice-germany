import { NextResponse } from "next/server";
import { z } from "zod";
import { dbInternal } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { setSession } from "@/lib/auth/server";

export const runtime = "nodejs";

const schema = z.object({ email: z.email(), password: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const { email, password } = schema.parse(await req.json());
    const user = await dbInternal.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "E-Mail oder Passwort ist falsch." }, { status: 401 });
    }
    await setSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Bitte E-Mail und Passwort eingeben." }, { status: 400 });
    }
    console.error("auth/login:", e);
    return NextResponse.json({ error: "Anmeldung fehlgeschlagen." }, { status: 400 });
  }
}
