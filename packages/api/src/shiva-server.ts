// SHIVA extension, Apache-2.0. Keep native SSR independent of the stock-widget router graph.
import { createRscTrpcContext } from "./rsc-context";
import { shivaRouter } from "./router/shiva";
import { createCallerFactory } from "./trpc";

// Reuse the host request identity and protected procedures without loading unrelated routers.
export const api = { shiva: createCallerFactory(shivaRouter)(createRscTrpcContext) };
