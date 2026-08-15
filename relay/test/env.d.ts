/* begin[relay_test_environment] */
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  interface Env {
    TEST_MIGRATIONS: D1Migration[];
  }

  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {}
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
/* end[relay_test_environment] */
