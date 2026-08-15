import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

/* begin[relay_test_migrations] */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
/* end[relay_test_migrations] */
