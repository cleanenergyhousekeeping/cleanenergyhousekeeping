/* begin[clockin_test_shell_runtime_loader] */
(async function () {
  const LIVE_BACKEND_URL =
    "https://script.google.com/macros/s/AKfycbz9NS-QSV31FZRy1jWDPBEQQ8Ht4x7UIPegNYp01nwASfwgtZ6pGieYsOeYMcQf62G5/exec";
  const TEST_BACKEND_URL =
    "https://script.google.com/macros/s/AKfycbzATssnUzIbUl1lX_zUzQTxB3_0Jk0UMGjLXuLkCNFj4p40gNOACQS6ybwCBnUJl1uo/exec";

  const response = await fetch("/clockin/app.js", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to load the production shell runtime baseline.");
  }

  let source = await response.text();
  source = source.replaceAll(LIVE_BACKEND_URL, TEST_BACKEND_URL);
  source = source.replaceAll('"ce_shell_auth_v1"', '"ce_shell_test_auth_v1"');
  source = source.replaceAll('"ce_shell_queue_v1"', '"ce_shell_test_queue_v1"');
  source = source.replaceAll("/clockin/", "/clockin-test/");

  new Function(source)();
})().catch(function (error) {
  console.error("TEST shell runtime failed to load.", error);

  const statusText = document.getElementById("statusText");
  if (statusText) {
    statusText.style.display = "block";
    statusText.textContent = "TEST shell runtime failed to load.";
  }
});
/* end[clockin_test_shell_runtime_loader] */
