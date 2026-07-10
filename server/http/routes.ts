import type { Express, RequestHandler } from "express";
import {
  isAuthorizationGuard,
  type AuthorizationGuard,
} from "../auth/authorization.js";

const routeAccessDeclarationKey = Symbol("wcib.routeAccessDeclaration");

const routeMethods = [
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
] as const;

export type RouteMethod = (typeof routeMethods)[number];

export interface PublicRouteAccess {
  authorization?: never;
  public: true;
  reason: string;
}

export interface AuthorizedRouteAccess {
  authorization: AuthorizationGuard;
  public?: never;
  reason?: never;
}

export type RouteAccessDeclaration = PublicRouteAccess | AuthorizedRouteAccess;

export interface RegisteredRoute {
  access:
    | { reason: string; type: "public" }
    | { type: "authorized" };
  method: Uppercase<RouteMethod>;
  path: string;
}

type RegisterRoute = (
  path: string,
  access: RouteAccessDeclaration,
  ...handlers: RequestHandler[]
) => void;

export type RouteRegistrar = Record<RouteMethod, RegisterRoute>;

interface ExpressRoute {
  methods: Record<string, boolean>;
  path: unknown;
}

interface ExpressRouteLayer {
  [routeAccessDeclarationKey]?: RegisteredRoute;
  route?: ExpressRoute;
}

interface ExpressRouter {
  stack: ExpressRouteLayer[];
}

export class RouteAccessDeclarationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteAccessDeclarationError";
  }
}

export function createRouteRegistrar(app: Express): RouteRegistrar {
  const register = (
    method: RouteMethod,
    path: string,
    access: unknown,
    handlers: RequestHandler[],
  ): void => {
    const routeLabel = `${method.toUpperCase()} ${path}`;
    const normalizedAccess = normalizeAccessDeclaration(access, routeLabel);
    if (handlers.length === 0) {
      throw new RouteAccessDeclarationError(
        `${routeLabel} must register at least one handler`,
      );
    }

    const layersBefore = getRouteLayers(app).length;
    const registeredHandlers =
      normalizedAccess.type === "authorized"
        ? [normalizedAccess.guard, ...handlers]
        : handlers;
    app[method](path, ...registeredHandlers);

    const layersAfter = getRouteLayers(app);
    if (layersAfter.length !== layersBefore + 1) {
      throw new RouteAccessDeclarationError(
        `${routeLabel} could not be attached to the route audit`,
      );
    }

    const layer = layersAfter[layersBefore];
    if (layer === undefined) {
      throw new RouteAccessDeclarationError(
        `${routeLabel} could not be attached to the route audit`,
      );
    }
    Object.defineProperty(layer, routeAccessDeclarationKey, {
      value: toRegisteredRoute(method, path, normalizedAccess),
    });
  };

  return {
    delete: (path, access, ...handlers) =>
      register("delete", path, access, handlers),
    get: (path, access, ...handlers) =>
      register("get", path, access, handlers),
    head: (path, access, ...handlers) =>
      register("head", path, access, handlers),
    options: (path, access, ...handlers) =>
      register("options", path, access, handlers),
    patch: (path, access, ...handlers) =>
      register("patch", path, access, handlers),
    post: (path, access, ...handlers) =>
      register("post", path, access, handlers),
    put: (path, access, ...handlers) =>
      register("put", path, access, handlers),
  };
}

export function auditRouteAccessDeclarations(
  app: Express,
): readonly RegisteredRoute[] {
  const declaredRoutes: RegisteredRoute[] = [];
  const undeclaredRoutes: string[] = [];

  for (const layer of getRouteLayers(app)) {
    const actualLabels = routeLabels(layer.route);
    const declaration = layer[routeAccessDeclarationKey];
    if (declaration === undefined) {
      undeclaredRoutes.push(...actualLabels);
      continue;
    }

    const declaredLabel = `${declaration.method} ${declaration.path}`;
    if (!actualLabels.includes(declaredLabel)) {
      undeclaredRoutes.push(...actualLabels);
      continue;
    }
    declaredRoutes.push(declaration);
  }

  if (undeclaredRoutes.length > 0) {
    throw new RouteAccessDeclarationError(
      `Routes lack explicit access declarations: ${undeclaredRoutes.join(", ")}`,
    );
  }

  return Object.freeze([...declaredRoutes]);
}

type NormalizedAccess =
  | { reason: string; type: "public" }
  | { guard: AuthorizationGuard; type: "authorized" };

function normalizeAccessDeclaration(
  access: unknown,
  routeLabel: string,
): NormalizedAccess {
  if (access === null || typeof access !== "object") {
    throw missingDeclarationError(routeLabel);
  }

  const candidate = access as Record<string, unknown>;
  const declaresPublic = candidate.public === true;
  const declaresAuthorization = candidate.authorization !== undefined;
  if (declaresPublic === declaresAuthorization) {
    throw missingDeclarationError(routeLabel);
  }

  if (declaresPublic) {
    if (
      typeof candidate.reason !== "string" ||
      candidate.reason.trim().length === 0
    ) {
      throw new RouteAccessDeclarationError(
        `${routeLabel} public access requires a non-empty reason`,
      );
    }
    return { reason: candidate.reason.trim(), type: "public" };
  }

  if (!isAuthorizationGuard(candidate.authorization)) {
    throw new RouteAccessDeclarationError(
      `${routeLabel} authorization must use authorization.require(...)`,
    );
  }
  return { guard: candidate.authorization, type: "authorized" };
}

function missingDeclarationError(
  routeLabel: string,
): RouteAccessDeclarationError {
  return new RouteAccessDeclarationError(
    `${routeLabel} must declare either authorization or intentional public access`,
  );
}

function toRegisteredRoute(
  method: RouteMethod,
  path: string,
  access: NormalizedAccess,
): RegisteredRoute {
  return {
    access:
      access.type === "authorized"
        ? { type: "authorized" }
        : { reason: access.reason, type: "public" },
    method: method.toUpperCase() as Uppercase<RouteMethod>,
    path,
  };
}

function getRouteLayers(app: Express): ExpressRouteLayer[] {
  const router = (app as unknown as { router?: ExpressRouter }).router;
  return router?.stack.filter((layer) => layer.route !== undefined) ?? [];
}

function routeLabels(route: ExpressRoute | undefined): string[] {
  if (route === undefined) {
    return [];
  }

  const paths = Array.isArray(route.path) ? route.path : [route.path];
  return Object.entries(route.methods)
    .filter(([, enabled]) => enabled)
    .flatMap(([method]) =>
      paths.map((path) => `${method.toUpperCase()} ${String(path)}`),
    );
}
