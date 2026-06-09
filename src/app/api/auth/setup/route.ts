import { NextResponse } from "next/server";
import { z } from "zod";
import { dbInternal } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { setSession } from "@/lib/auth/server";

export const runtime = "nodejs";

const schema = z.object({ email: z.email(), password: z.string().min(8) });

export async function POST(req: Request) {
  try {
    if ((await dbInternal.user.count()) > 0) {
      return NextResponse.json({ error: "Es existiert bereits ein Konto." }, { status: 409 });
    }
    const { email, password } = schema.parse(await req.json());
    const user = await dbInternal.user.create({ data: { email, passwordHash: hashPassword(password) } });
    await setSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "E-Mail ungültig oder Passwort zu kurz (min. 8 Zeichen)." }, { status: 400 });
    }
    console.error("auth/setup:", e);
    return NextResponse.json({ error: "Einrichtung fehlgeschlagen." }, { status: 400 });
  }
}
