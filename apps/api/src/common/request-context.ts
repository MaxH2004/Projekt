import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

/** What is known about the current request; filled by the session guard. */
export interface RequestContext {
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Express middleware: every request runs with its own, initially empty context. */
export function requestContextMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  storage.run({}, next);
}

/** The context of the current request, or undefined outside of one (jobs, tests). */
export function currentRequest(): RequestContext | undefined {
  return storage.getStore();
}
