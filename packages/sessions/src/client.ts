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
    discover: (operationOptions = {}) => discoverSessions({ ...options, ...operationOptions }),
    list: (operationOptions = {}) => listSessions({ ...options, ...operationOptions }),
    load: (operationOptions) => loadSession({ ...options, ...operationOptions }),
    share: (operationOptions) => shareSession({ ...options, ...operationOptions }),
    export: (operationOptions) => exportSession({ ...options, ...operationOptions }),
  };
}
