from app.intelligence.intent import classify_intent


def test_intent_followup_task_is_task_request() -> None:
    assert classify_intent("继续部署后端服务") == "task_request"


def test_intent_english_task_keywords_are_task_request() -> None:
    assert classify_intent("please deploy this again") == "task_request"


def test_intent_status_has_higher_priority() -> None:
    assert classify_intent("系统状态怎么样") == "status"


def test_intent_feedback_is_task_feedback() -> None:
    assert classify_intent("这次任务做得很好") == "task_feedback"
    assert classify_intent("task_20260206153641_0e72bec2 这次不行") == "task_feedback"


def test_intent_status_phrase_not_misclassified_as_feedback() -> None:
    assert classify_intent("状态不错吗") == "status"


def test_intent_greeting_plus_task_prefers_task_request() -> None:
    assert classify_intent("你好，请执行任务：输出 world") == "task_request"
    assert classify_intent("hello, please deploy this again") == "task_request"


def test_intent_greeting_plus_capability_prefers_capability() -> None:
    assert classify_intent("你好，你有什么能力") == "capability"
