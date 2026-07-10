import type { Response } from "express";
import {
  getAuthorizedRequestContext,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";

export type AuthorizedFieldProjector<TSource, TProjected> = (
  source: Readonly<TSource>,
  context: AuthorizedRequestContext,
) => TProjected;

export function projectAuthorizedFields<TSource, TProjected>(
  res: Response,
  source: TSource,
  projector: AuthorizedFieldProjector<TSource, TProjected>,
): TProjected {
  const context = getAuthorizedRequestContext(res);
  return projector(source, context);
}
