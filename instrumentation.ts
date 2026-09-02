import type { Instrumentation } from "next";
import { reportError } from "@/lib/monitoring";

export function register() {}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const typed = error instanceof Error ? error : new Error(String(error));
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : undefined;
  await reportError({
    source: "server",
    message: typed.message,
    stack: typed.stack?.slice(0, 4000),
    digest,
    path: request.path,
    method: request.method,
    context: { routePath: context.routePath, routeType: context.routeType },
  });
};
