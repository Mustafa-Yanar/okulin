"""Yerel Okulin arayüzünde sentetik rollerle giriş duman testi."""

from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:43127"
PASSWORD = "Test1234!"
ARTIFACT_DIR = Path(".test-runtime/ui-artifacts")

ROLES = [
    ("Yönetim", "testkurs_mudur", "director", None),
    ("Yönetim", "testkurs_mudury", "director", True),
    ("Yönetim", "testkurs_rehber", "counselor", None),
    ("Yönetim", "testkurs_muhasebe", "accountant", None),
    ("Yönetim", "testkurs_hq", "org_admin", None),
    ("Öğretmen", "testkurs_ogretmen", "teacher", None),
    ("Öğrenci", "testkurs_ogrenci", "student", None),
    ("Veli", "905310000101", "parent", None),
]

ACCESS_MATRIX = {
    "testkurs_mudur": {"/api/students": 200, "/api/finance": 200, "/api/audit": 200, "/api/config": 200},
    "testkurs_mudury": {"/api/students": 200, "/api/finance": 200, "/api/audit": 200, "/api/config": 200},
    "testkurs_rehber": {"/api/students": 200, "/api/finance": 403, "/api/audit": 403, "/api/config": 200},
    "testkurs_muhasebe": {"/api/students": 200, "/api/finance": 200, "/api/audit": 403, "/api/config": 200},
    "testkurs_hq": {"/api/students": 403, "/api/finance": 403, "/api/audit": 403, "/api/config": 403},
    "testkurs_ogretmen": {"/api/students": 200, "/api/finance": 403, "/api/audit": 403, "/api/config": 403},
    "testkurs_ogrenci": {"/api/students": 403, "/api/finance": 403, "/api/audit": 403, "/api/config": 403},
    "905310000101": {"/api/students": 403, "/api/finance": 403, "/api/audit": 403, "/api/config": 403},
}


def main() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    external_requests: list[str] = []
    server_errors: list[str] = []
    failed_requests: list[str] = []
    browser_console_errors: list[str] = []
    page_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        for card, username, expected_role, expected_asst in ROLES:
            context = browser.new_context(base_url=BASE_URL)

            def route_request(route):
                host = urlparse(route.request.url).hostname
                if host not in {"127.0.0.1", "localhost", None}:
                    external_requests.append(route.request.url)
                    route.abort()
                else:
                    route.continue_()

            context.route("**/*", route_request)
            page = context.new_page()
            page.set_default_timeout(90_000)
            page.on("pageerror", lambda error, user=username: page_errors.append(f"{user}: {error}"))

            def record_failed_request(request, user=username):
                # Next App Router'ın prefetch RSC isteği, bağlam kapanırken bilinçli
                # iptal olabilir; gerçek ağ/sunucu arızası değildir.
                if request.failure == "net::ERR_ABORTED" and "_rsc=" in request.url:
                    return
                failed_requests.append(f"{user}: {request.url} — {request.failure}")

            page.on("requestfailed", record_failed_request)
            page.on(
                "console",
                lambda message, user=username: browser_console_errors.append(
                    f"{user}: {message.text}"
                ) if message.type == "error" else None,
            )
            page.on(
                "response",
                lambda response, user=username: server_errors.append(
                    f"{user}: {response.status} {response.url}"
                ) if response.status >= 500 else None,
            )

            try:
                page.goto("/", wait_until="networkidle")
                page.get_by_role("button", name=card).click()
                page.locator("form input:not([type='password'])").fill(username)
                page.locator("form input[type='password']").fill(PASSWORD)
                with page.expect_response(
                    lambda response: response.url.endswith("/api/auth")
                    and response.request.method == "POST"
                ) as response_info:
                    page.get_by_role("button", name="Giriş Yap", exact=True).click()

                response = response_info.value
                assert response.status == 200, f"{username} giriş HTTP {response.status}: {response.text()}"
                page.wait_for_function(
                    """async () => {
                      const r = await fetch('/api/auth');
                      const data = await r.json();
                      return Boolean(data.session);
                    }"""
                )
                page.wait_for_load_state("networkidle")
                session = page.evaluate("async () => (await (await fetch('/api/auth')).json()).session")
                assert session["role"] == expected_role, f"{username}: rol {session}"
                if expected_asst is not None:
                    assert session.get("asst") is expected_asst, f"{username}: müdür yardımcısı işareti yok"
                assert "Nasıl giriş yapacaksınız?" not in page.locator("body").inner_text()

                for endpoint, expected_status in ACCESS_MATRIX[username].items():
                    access_response = context.request.get(f"{BASE_URL}{endpoint}")
                    assert access_response.status == expected_status, (
                        f"{username}: {endpoint} HTTP {access_response.status}, beklenen {expected_status}"
                    )

                if expected_role == "parent":
                    own_finance = context.request.get(f"{BASE_URL}/api/finance?studentId=s_101_1")
                    foreign_finance = context.request.get(f"{BASE_URL}/api/finance?studentId=s_202_1")
                    assert own_finance.status == 200, f"veli kendi çocuğu finansı: {own_finance.status}"
                    assert foreign_finance.status == 403, f"veli yabancı öğrenci finansı: {foreign_finance.status}"
                print(f"GEÇTİ: {username} → {expected_role}")
            except Exception:
                page.screenshot(path=str(ARTIFACT_DIR / f"failed-{username}.png"), full_page=True)
                print(f"HATA AYRINTISI ({username})")
                print("Sayfa metni:", page.locator("body").inner_text()[:1000])
                print("Dış istekler:", external_requests)
                print("Başarısız istekler:", failed_requests)
                print("5xx yanıtlar:", server_errors)
                print("Tarayıcı konsolu:", browser_console_errors)
                print("Sayfa hataları:", page_errors)
                raise
            finally:
                context.close()

        browser.close()

    assert not external_requests, f"Dış ağa çıkış denemesi: {external_requests}"
    assert not server_errors, f"Yerel sunucu 5xx yanıtları: {server_errors}"
    assert not failed_requests, f"Başarısız yerel istekler: {failed_requests}"
    assert not browser_console_errors, f"Tarayıcı konsol hataları: {browser_console_errors}"
    assert not page_errors, f"Tarayıcı çalışma zamanı hataları: {page_errors}"
    print(f"TAMAMLANDI: {len(ROLES)} sentetik rol, dış ağ yok, 5xx yok, tarayıcı hatası yok.")


if __name__ == "__main__":
    main()
