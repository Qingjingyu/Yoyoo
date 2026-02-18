import json

from app.services.agent_router import AgentRouter


def test_agent_router_resolves_explicit_first() -> None:
    router = AgentRouter(
        default_agent_id="ceo",
        bindings=[],
    )
    route = router.resolve(
        explicit_agent_id="writer",
        channel="feishu",
        project_key="proj_a",
        peer_kind="group",
        peer_id="oc_100",
    )
    assert route.agent_id == "writer"
    assert route.memory_scope == "agent:writer"
    assert route.reason == "explicit_agent_id"
    assert route.matched is True


def test_agent_router_resolves_binding_from_env(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    bindings = {
        "bindings": [
            {
                "agentId": "writer",
                "match": {
                    "channel": "feishu",
                    "peer": {
                        "kind": "group",
                        "id": "oc_group_1",
                    },
                },
            }
        ]
    }
    monkeypatch.setenv("YOYOO_DEFAULT_AGENT_ID", "ceo")
    monkeypatch.setenv("YOYOO_AGENT_BINDINGS_JSON", json.dumps(bindings))
    router = AgentRouter.from_env()

    route = router.resolve(
        channel="feishu",
        project_key="proj_any",
        peer_kind="group",
        peer_id="oc_group_1",
    )
    assert route.agent_id == "writer"
    assert route.memory_scope == "agent:writer"
    assert route.matched is True
    assert route.reason.startswith("binding[")


def test_agent_router_uses_default_when_no_match(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("YOYOO_DEFAULT_AGENT_ID", "ceo")
    monkeypatch.setenv("YOYOO_AGENT_BINDINGS_JSON", "[]")
    router = AgentRouter.from_env()
    route = router.resolve(channel="api", project_key="general")
    assert route.agent_id == "ceo"
    assert route.memory_scope == "agent:ceo"
    assert route.matched is False
    assert route.reason == "default_agent"
