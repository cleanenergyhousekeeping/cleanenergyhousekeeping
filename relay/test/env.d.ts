/* begin[relay_test_environment] */
declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {}
}
/* end[relay_test_environment] */
