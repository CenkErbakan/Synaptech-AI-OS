import { NextRequest, NextResponse } from "next/server";

function apiBase(): string {
  return process.env.SYNAPTECH_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:3101";
}

function ownerToken(): string | null {
  return process.env.SYNAPTECH_OWNER_TOKEN || null;
}

async function proxy(request: NextRequest, path: string[]) {
  const token = ownerToken();
  if (!token) {
    return NextResponse.json(
      { error: { code: "InternalError", message: "SYNAPTECH_OWNER_TOKEN eksik." } },
      { status: 500 },
    );
  }

  const target = `${apiBase()}/api/${path.join("/")}${request.nextUrl.search}`;
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  const idem = request.headers.get("idempotency-key");
  if (idem) headers.set("Idempotency-Key", idem);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }

  try {
    const upstream = await fetch(target, init);
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "IntegrationUnavailable", message: "Control API erişilemiyor." } },
      { status: 503 },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path);
}
