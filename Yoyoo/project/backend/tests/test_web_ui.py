from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root_redirects_to_web() -> None:
    resp = client.get("/", follow_redirects=False)
    assert resp.status_code in {302, 307}
    assert resp.headers["location"] == "/web/"


def test_web_index_is_served() -> None:
    resp = client.get("/web/")
    assert resp.status_code == 200
    assert "Yoyoo 独立 Web" in resp.text
