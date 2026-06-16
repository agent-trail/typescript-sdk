import { discoverSessions } from "./discover.js";
import { exportSession } from "./export.js";
import { listSessions } from "./list.js";
import { loadSession } from "./load.js";
import { shareSession } from "./share.js";
import type { SessionsClient, SessionsOptions } from "./types.js";

/**
 * Create a workflow client with shared dependencies bound once.
 *
 * @public
 */
export function createSessionsClient(options: SessionsOptions): SessionsClient {
  return {
    discover: (operationOptions = {}) => discoverSessions({ ...operationOptions, ...options }),
    list: (operationOptions = {}) => listSessions({ ...operationOptions, ...options }),
    load: (operationOptions) => loadSession({ ...operationOptions, ...options }),
    share: (operationOptions) => shareSession({ ...operationOptions, ...options }),
    export: (operationOptions) => exportSession({ ...operationOptions, ...options }),
  };
}
