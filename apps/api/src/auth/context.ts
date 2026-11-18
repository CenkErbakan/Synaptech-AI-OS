import type { Actor } from "@synaptech/shared";
import type { FastifyRequest } from "fastify";

import { forbidden, unauthorized } from "../lib/errors.js";
import { getEnv } from "../lib/env.js";

export type AuthPrincipal =
  | { kind: "owner"; userId: string; displayName: string }
  | { kind: "system" };

declare module "fastify" {
  interface FastifyRequest {
    principal?: AuthPrincipal;
  }
}

export function actorFromPrincipal(principal: AuthPrincipal): Actor {
  if (principal.kind === "owner") return { kind: "user" };
  return { kind: "system" };
}

export function requireAuth(request: FastifyRequest): AuthPrincipal {
  const env = getEnv();
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw unauthorized();
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw unauthorized();

  // İstemci kimliği header/body ile gelmez; yalnızca sunucu token eşlemesi.
  if (token === env.SYNAPTECH_OWNER_TOKEN) {
    return { kind: "owner", userId: "owner-local", displayName: "Owner" };
  }
  if (token === env.SYNAPTECH_SYSTEM_TOKEN) {
    return { kind: "system" };
  }
  throw unauthorized("Geçersiz erişim jetonu.");
}

export function requireOwner(request: FastifyRequest): AuthPrincipal {
  const principal = requireAuth(request);
  if (principal.kind !== "owner") {
    throw forbidden("Bu uç nokta yalnızca Owner içindir.");
  }
  return principal;
}
