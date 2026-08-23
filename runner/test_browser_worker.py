import asyncio
import base64
import io
import json
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

import browser_worker as worker


class QueueDecodingTests(unittest.TestCase):
    def test_decodes_raw_cloudflare_json_content(self):
        payload = {
            "kind": "attempt",
            "runId": "run_1",
            "attemptId": "att_1",
            "attemptIndex": 0,
            "executionGeneration": 10,
        }

        self.assertEqual(
            worker.decode_queue_message(
                {
                    "body": json.dumps(payload),
                    "metadata": {"CF-Content-Type": "json"},
                }
            ),
            payload,
        )

    def test_decodes_cloudflare_json_content(self):
        payload = {
            "kind": "attempt",
            "runId": "run_1",
            "attemptId": "att_1",
            "attemptIndex": 0,
            "executionGeneration": 10,
        }
        encoded = base64.b64encode(json.dumps(payload).encode()).decode()

        self.assertEqual(
            worker.decode_queue_message(
                {
                    "body": encoded,
                    "metadata": {"CF-Content-Type": "json"},
                }
            ),
            payload,
        )

    def test_rejects_malformed_queue_content(self):
        with self.assertRaises(worker.PoisonMessage):
            worker.decode_queue_message(
                {"body": "not-base64", "metadata": {"CF-Content-Type": "json"}}
            )


class SecretSafetyTests(unittest.TestCase):
    def setUp(self):
        self.secrets = {
            "PASSWORD": worker.SecretValue(
                value="a very secret value", allowed_domains=("example.com",)
            )
        }

    def test_substitutes_only_on_an_allowed_domain(self):
        self.assertEqual(
            worker.substitute_secrets(
                "Password: {{PASSWORD}}", self.secrets, "example.com"
            ),
            "Password: a very secret value",
        )
        with self.assertRaises(worker.ActionFailure):
            worker.substitute_secrets(
                "Password: {{PASSWORD}}", self.secrets, "evil.example"
            )

    def test_redacts_plain_and_url_encoded_secret_values(self):
        redactor = worker.Redactor(self.secrets)
        self.assertEqual(
            redactor.redact(
                "a very secret value / a%20very%20secret%20value / "
                "a+very+secret+value"
            ),
            "{{PASSWORD}} / {{PASSWORD}} / {{PASSWORD}}",
        )

    def test_sanitized_urls_drop_credentials_fragments_and_sensitive_queries(self):
        self.assertEqual(
            worker.sanitize_url(
                "https://user:password@example.com/path?token=secret&safe=yes#part"
            ),
            "https://example.com/path?token=redacted&safe=yes",
        )


class ConfigurationSafetyTests(unittest.TestCase):
    def test_environment_selector_uses_hardcoded_production_and_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runner-secrets.json"
            path.write_text(
                json.dumps(
                    {
                        "production_runner_token": "p" * 64,
                        "staging_runner_token": "s" * 64,
                    }
                ),
                encoding="utf-8",
            )
            path.chmod(0o600)

            production = worker.RunnerConfig.for_environment(
                "production", queues_token="c" * 64, secrets_path=path
            )
            staging = worker.RunnerConfig.for_environment(
                "staging", queues_token="c" * 64, secrets_path=path
            )

        self.assertEqual(production.zenguy_api_url, "https://app.zenguy.com")
        self.assertEqual(
            staging.zenguy_api_url, "https://staging-app.zenguy.com"
        )
        self.assertEqual(production.model_base_url, "http://127.0.0.1:1234/v1")
        self.assertEqual(production.model_name, "qwen/qwen3.8-27b")
        self.assertEqual(production.model_reasoning_effort, "xhigh")
        self.assertTrue(production.model_vision)
        self.assertFalse(production.headless)
        self.assertEqual(production.browser_channel, "chrome")
        self.assertNotEqual(
            production.cloudflare_queue_id, staging.cloudflare_queue_id
        )

    def test_local_secrets_require_private_file_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runner-secrets.json"
            path.write_text("{}", encoding="utf-8")
            path.chmod(0o644)
            with self.assertRaises(worker.ConfigError):
                worker.load_local_secrets(path)

    def test_remote_api_requires_https_but_local_http_is_allowed(self):
        self.assertEqual(
            worker.validate_api_url("http://127.0.0.1:8787/"),
            "http://127.0.0.1:8787",
        )
        self.assertEqual(
            worker.validate_api_url("https://staging-app.zenguy.com"),
            "https://staging-app.zenguy.com",
        )
        with self.assertRaises(worker.ConfigError):
            worker.validate_api_url("http://staging-app.zenguy.com")

    def test_browser_network_rejects_private_dns_answers(self):
        private_answer = [
            (2, 1, 6, "", ("127.0.0.1", 443)),
        ]
        with mock.patch.object(
            worker.socket,
            "getaddrinfo",
            return_value=private_answer,
        ):
            with self.assertRaises(worker.ActionFailure):
                asyncio.run(
                    worker.assert_public_network_url("https://public.example")
                )


class WorkerIdentityTests(unittest.TestCase):
    def test_explicit_worker_id_wins(self):
        self.assertEqual(worker.resolve_worker_id("vps-hetzner_1"), "vps-hetzner_1")

    def test_hostname_is_sanitised_to_the_allowed_alphabet(self):
        with mock.patch.object(worker.socket, "gethostname", return_value="Marcos’s MacBook Pro.local"):
            self.assertEqual(worker.resolve_worker_id(None), "Marcos-s-MacBook-Pro.local")

    def test_hostname_is_capped_and_never_empty(self):
        with mock.patch.object(worker.socket, "gethostname", return_value="x" * 100):
            self.assertEqual(len(worker.resolve_worker_id("")), 64)
        with mock.patch.object(worker.socket, "gethostname", return_value="***"):
            self.assertEqual(worker.resolve_worker_id(None), "worker")

    def test_rejects_invalid_explicit_ids(self):
        with self.assertRaises(worker.ConfigError):
            worker.resolve_worker_id("bad id!")


class BrowserUseIntegrationTests(unittest.TestCase):
    @staticmethod
    def config():
        return worker.RunnerConfig(
            environment="staging",
            cloudflare_account_id="account",
            cloudflare_queue_id="queue",
            cloudflare_queues_token="c" * 64,
            zenguy_api_url="https://staging-app.zenguy.com",
            zenguy_runner_token="r" * 64,
            model_base_url="http://127.0.0.1:1234/v1",
            model_name="qwen/qwen3.8-27b",
            model_api_key="local-runner",
            model_vision=True,
            model_reasoning_effort="xhigh",
            allow_remote_model=False,
            headless=False,
            browser_channel="chrome",
            poll_seconds=5,
            visibility_timeout_ms=900_000,
        )

    def test_configures_browser_use_chat_openai_for_bionic(self):
        class FakeChatOpenAI:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

        runtime = worker.BrowserUseRuntime(
            Agent=None,
            BrowserProfile=None,
            ChatOpenAI=FakeChatOpenAI,
            Tools=None,
            ActionResult=None,
            NavigateAction=None,
        )

        model = worker.create_browser_use_model(self.config(), runtime)

        self.assertEqual(model.kwargs["model"], "qwen/qwen3.8-27b")
        self.assertEqual(model.kwargs["base_url"], "http://127.0.0.1:1234/v1")
        self.assertEqual(model.kwargs["reasoning_effort"], "xhigh")
        self.assertEqual(
            model.kwargs["reasoning_models"], ["qwen/qwen3.8-27b"]
        )
        self.assertIsNone(model.kwargs["temperature"])
        self.assertEqual(type(model).__name__, "BionicChatOpenAI")

    def test_translates_zenguy_placeholders_for_browser_use(self):
        secrets = {
            "PASSWORD": worker.SecretValue(
                value="actual-secret", allowed_domains=("example.com",)
            )
        }

        task, start_url = worker.browser_use_task(
            {
                "startUrl": "https://example.com/login",
                "instructions": "Enter {{PASSWORD}} and verify the dashboard",
            },
            secrets,
        )

        self.assertIn("<secret>PASSWORD</secret>", task)
        self.assertNotIn("actual-secret", task)
        self.assertEqual(start_url, "https://example.com/login")

    def test_extracts_and_validates_browser_use_json_after_model_prose(self):
        raw = (
            "I verified both conditions.\n"
            '{"status":"PASSED","summary":"verified",'
            '"expected_result":"heading","actual_result":"heading visible",'
            '"failure_reason":""}'
        )

        result = worker.validate_json_model_from_text(
            raw, worker.BrowserTestResult
        )

        self.assertEqual(result.status, "PASSED")

    def test_rejects_unknown_placeholder_before_browser_use_runs(self):
        with self.assertRaises(worker.PoisonMessage):
            worker.browser_use_secret_text("Use {{MISSING}}", {})

    def test_scopes_browser_use_sensitive_data_by_domain(self):
        secrets = {
            "PASSWORD": worker.SecretValue(
                value="actual-secret",
                allowed_domains=("example.com", "*.login.example.com"),
            )
        }

        self.assertEqual(
            worker.browser_use_sensitive_data(secrets),
            {
                "example.com": {"PASSWORD": "actual-secret"},
                "*.login.example.com": {"PASSWORD": "actual-secret"},
            },
        )

    def test_step_description_excludes_browser_use_reasoning(self):
        class FakeAction:
            @staticmethod
            def model_dump(**_kwargs):
                return {"click": {"index": 2}}

        item = SimpleNamespace(
            model_output=SimpleNamespace(
                action=[FakeAction()],
                current_state=SimpleNamespace(
                    thinking="private intermediate reasoning"
                ),
            ),
            result=[SimpleNamespace(error=None)],
        )

        action_type, description = worker.describe_browser_use_history_item(
            item, worker.Redactor({})
        )

        self.assertEqual(action_type, "click")
        self.assertEqual(description, 'click {"index":2}')
        self.assertNotIn("reasoning", description)

    def test_converts_browser_use_screenshot_to_jpeg(self):
        from PIL import Image

        source = io.BytesIO()
        Image.new("RGB", (4, 4), (255, 0, 0)).save(source, format="PNG")
        encoded = base64.b64encode(source.getvalue()).decode("ascii")

        converted = worker.screenshot_as_jpeg_base64(encoded, 60)

        self.assertIsNotNone(converted)
        self.assertTrue(base64.b64decode(converted).startswith(b"\xff\xd8\xff"))

    def test_maps_structured_browser_use_result_to_runner_outcome(self):
        history = SimpleNamespace(
            structured_output=worker.BrowserTestResult(
                status="PASSED",
                summary="Heading verified",
                expected_result="Example Domain heading",
                actual_result="Example Domain heading was visible",
                failure_reason="",
            ),
            usage=SimpleNamespace(
                total_tokens=42, total_prompt_tokens=30, total_completion_tokens=12
            ),
            urls=lambda: ["https://example.com/"],
        )

        outcome = worker.browser_use_outcome(
            history,
            {"instructions": "Verify the heading"},
            worker.Redactor({}),
            "qwen/qwen3.8-27b",
        )

        self.assertEqual(outcome["status"], "PASSED")
        self.assertEqual(outcome["tokenUsage"], 42)
        self.assertEqual(outcome["inputTokens"], 30)
        self.assertEqual(outcome["outputTokens"], 12)
        self.assertEqual(outcome["runnerKind"], "primary")
        self.assertEqual(outcome["visitedUrls"], ["https://example.com/"])
        self.assertIn("browser-use-0.13.8", outcome["runnerVersion"])

    def test_outcome_omits_the_token_breakdown_when_browser_use_lacks_it(self):
        history = SimpleNamespace(
            structured_output=worker.BrowserTestResult(
                status="PASSED",
                summary="ok",
                expected_result="ok",
                actual_result="ok",
                failure_reason="",
            ),
            usage=SimpleNamespace(total_tokens=42),
            urls=lambda: [],
        )

        outcome = worker.browser_use_outcome(
            history, {"instructions": "x"}, worker.Redactor({}), "qwen/qwen3.8-27b"
        )

        self.assertEqual(outcome["tokenUsage"], 42)
        self.assertNotIn("inputTokens", outcome)
        self.assertNotIn("outputTokens", outcome)

    def test_llm_provider_failure_maps_to_system_error(self):
        history = SimpleNamespace(
            structured_output=None,
            errors=lambda: [
                "Error code: 429 - {'error': {'message': 'You have no credits "
                "remaining.', 'type': 'insufficient_quota', 'code': "
                "'credit_balance_exhausted'}}"
            ],
            final_result=lambda: None,
            usage=SimpleNamespace(total_tokens=0),
            urls=lambda: [],
        )

        outcome = worker.browser_use_outcome(
            history,
            {"instructions": "Verify the heading"},
            worker.Redactor({}),
            "gpt-5-mini",
        )

        self.assertEqual(outcome["status"], "SYSTEM_ERROR")
        self.assertEqual(outcome["systemErrorCode"], "LLM_UNAVAILABLE")
        self.assertIn("insufficient_quota", outcome["failureReason"])

    def test_agent_stop_without_llm_error_stays_failed(self):
        history = SimpleNamespace(
            structured_output=None,
            errors=lambda: ["Element with index 7 was not clickable"],
            final_result=lambda: None,
            usage=SimpleNamespace(total_tokens=1200),
            urls=lambda: ["https://example.com/"],
        )

        outcome = worker.browser_use_outcome(
            history,
            {"instructions": "Verify the heading"},
            worker.Redactor({}),
            "gpt-5-mini",
        )

        self.assertEqual(outcome["status"], "FAILED")
        self.assertNotIn("systemErrorCode", outcome)

    def test_browser_use_telemetry_and_cloud_sync_are_disabled(self):
        self.assertEqual(worker.os.environ["ANONYMIZED_TELEMETRY"], "false")
        self.assertEqual(worker.os.environ["BROWSER_USE_CLOUD_SYNC"], "false")
        self.assertEqual(worker.os.environ["BROWSER_USE_SETUP_LOGGING"], "false")

    def test_browser_use_is_the_pinned_runtime_dependency(self):
        requirements = Path(__file__).with_name("requirements.txt").read_text(
            encoding="utf-8"
        )
        self.assertEqual(requirements.strip(), "browser-use[core]==0.13.8")


class WorkerLeaseTests(unittest.IsolatedAsyncioTestCase):
    async def test_claim_uses_the_delivery_lease_not_the_message_id(self):
        class FakeQueue:
            def __init__(self):
                self.acknowledged = []

            async def acknowledge(self, lease_id):
                self.acknowledged.append(lease_id)

        class FakeApp:
            def __init__(self):
                self.claims = []

            async def claim(self, delivery_id, message):
                self.claims.append((delivery_id, message))
                return None

        instance = object.__new__(worker.Worker)
        instance.queue = FakeQueue()
        instance.app = FakeApp()
        instance.executor = None
        message = {
            "kind": "attempt",
            "runId": "run_1",
            "attemptId": "att_1",
            "attemptIndex": 0,
            "executionGeneration": 10,
        }

        await instance._process(
            {
                "id": "stable-message-id",
                "lease_id": "unique-delivery-lease",
                "body": message,
            }
        )

        self.assertEqual(
            instance.app.claims,
            [("unique-delivery-lease", message)],
        )
        self.assertEqual(instance.queue.acknowledged, ["unique-delivery-lease"])


class FallbackConfigurationTests(unittest.TestCase):
    ENVIRON = {
        "ZENGUY_RUNNER_TOKEN": "r" * 64,
        "OPENAI_API_KEY": "sk-test-key",
    }

    def test_fallback_config_uses_openai_defaults_without_cloudflare(self):
        config = worker.RunnerConfig.for_fallback(
            "staging",
            environ=self.ENVIRON,
            secrets_path=Path("/nonexistent/runner-secrets.json"),
        )

        self.assertEqual(config.mode, "fallback")
        self.assertEqual(config.environment, "staging")
        self.assertEqual(config.zenguy_api_url, "https://staging-app.zenguy.com")
        self.assertEqual(config.zenguy_runner_token, "r" * 64)
        self.assertEqual(config.model_base_url, "https://api.openai.com/v1")
        self.assertEqual(config.model_name, "gpt-5-mini")
        self.assertEqual(config.model_api_key, "sk-test-key")
        self.assertEqual(config.model_reasoning_effort, "low")
        self.assertTrue(config.allow_remote_model)
        self.assertTrue(config.model_native_structured)
        self.assertTrue(config.headless)
        self.assertEqual(config.cloudflare_queues_token, "")
        self.assertIn("fallback", config.runner_version)
        self.assertEqual(config.runner_kind, "fallback")

    def test_fallback_config_honors_environment_overrides(self):
        config = worker.RunnerConfig.for_fallback(
            "production",
            environ={
                **self.ENVIRON,
                "ZENGUY_FALLBACK_MODEL": "gpt-5.6-luna",
                "ZENGUY_FALLBACK_REASONING_EFFORT": "medium",
                "ZENGUY_FALLBACK_HEADLESS": "false",
                "ZENGUY_FALLBACK_POLL_SECONDS": "3",
            },
            secrets_path=Path("/nonexistent/runner-secrets.json"),
        )

        self.assertEqual(config.zenguy_api_url, "https://app.zenguy.com")
        self.assertEqual(config.model_name, "gpt-5.6-luna")
        self.assertEqual(config.model_reasoning_effort, "medium")
        self.assertFalse(config.headless)
        self.assertEqual(config.poll_seconds, 3.0)

    def test_fallback_config_reads_tokens_from_the_local_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runner-secrets.json"
            path.write_text(
                json.dumps(
                    {
                        "staging_runner_token": "s" * 64,
                        "openai_api_key": "sk-from-json",
                    }
                ),
                encoding="utf-8",
            )
            path.chmod(0o600)

            config = worker.RunnerConfig.for_fallback(
                "staging", environ={}, secrets_path=path
            )

        self.assertEqual(config.zenguy_runner_token, "s" * 64)
        self.assertEqual(config.model_api_key, "sk-from-json")

    def test_fallback_config_requires_both_credentials(self):
        missing = Path("/nonexistent/runner-secrets.json")
        with self.assertRaises(worker.ConfigError):
            worker.RunnerConfig.for_fallback(
                "staging",
                environ={"OPENAI_API_KEY": "sk-test-key"},
                secrets_path=missing,
            )
        with self.assertRaises(worker.ConfigError):
            worker.RunnerConfig.for_fallback(
                "staging",
                environ={"ZENGUY_RUNNER_TOKEN": "r" * 64},
                secrets_path=missing,
            )

    def test_fallback_config_rejects_insecure_remote_model_endpoint(self):
        with self.assertRaises(worker.ConfigError):
            worker.RunnerConfig.for_fallback(
                "staging",
                environ={
                    **self.ENVIRON,
                    "ZENGUY_FALLBACK_MODEL_BASE_URL": "http://models.example.com/v1",
                },
                secrets_path=Path("/nonexistent/runner-secrets.json"),
            )

    def test_remote_model_endpoint_must_use_https_even_when_allowed(self):
        worker._local_model_url_allowed("https://api.openai.com/v1", True)
        with self.assertRaises(worker.ConfigError):
            worker._local_model_url_allowed("http://api.openai.com/v1", True)


class FallbackModelTests(unittest.TestCase):
    def test_configures_plain_browser_use_chat_openai_for_openai(self):
        class FakeChatOpenAI:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

        runtime = worker.BrowserUseRuntime(
            Agent=None,
            BrowserProfile=None,
            ChatOpenAI=FakeChatOpenAI,
            Tools=None,
            ActionResult=None,
            NavigateAction=None,
        )
        config = worker.RunnerConfig.for_fallback(
            "staging",
            environ={
                "ZENGUY_RUNNER_TOKEN": "r" * 64,
                "OPENAI_API_KEY": "sk-test-key",
            },
            secrets_path=Path("/nonexistent/runner-secrets.json"),
        )

        model = worker.create_browser_use_model(config, runtime)

        self.assertIs(type(model), FakeChatOpenAI)
        self.assertEqual(model.kwargs["model"], "gpt-5-mini")
        self.assertEqual(model.kwargs["base_url"], "https://api.openai.com/v1")
        self.assertEqual(model.kwargs["api_key"], "sk-test-key")
        self.assertEqual(model.kwargs["reasoning_effort"], "low")

    def test_outcome_reports_the_configured_runner_version(self):
        history = SimpleNamespace(
            structured_output=worker.BrowserTestResult(
                status="PASSED",
                summary="ok",
                expected_result="ok",
                actual_result="ok",
                failure_reason="",
            ),
            usage=SimpleNamespace(total_tokens=1),
            urls=lambda: [],
        )

        outcome = worker.browser_use_outcome(
            history,
            {"instructions": "x"},
            worker.Redactor({}),
            "gpt-5-mini",
            runner_version="zenguy-fallback-runner/2.0.0",
            runner_kind="fallback",
        )

        self.assertEqual(outcome["runnerVersion"], "zenguy-fallback-runner/2.0.0")
        self.assertEqual(outcome["runnerKind"], "fallback")


class FallbackWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_executes_claimed_stale_jobs_with_unique_delivery_ids(self):
        class FakeApp:
            def __init__(self):
                self.delivery_ids = []

            async def claim_stale(self, delivery_id):
                self.delivery_ids.append(delivery_id)
                if len(self.delivery_ids) == 1:
                    return {"reference": {"attemptId": "att_1"}}
                return None

        class FakeExecutor:
            def __init__(self):
                self.jobs = []

            async def execute(self, job):
                self.jobs.append(job)

        instance = object.__new__(worker.FallbackWorker)
        instance.app = FakeApp()
        instance.executor = FakeExecutor()

        first = await instance._poll_once()
        second = await instance._poll_once()

        self.assertTrue(first)
        self.assertFalse(second)
        self.assertEqual(
            instance.executor.jobs, [{"reference": {"attemptId": "att_1"}}]
        )
        delivery_ids = instance.app.delivery_ids
        self.assertEqual(len(delivery_ids), 2)
        self.assertNotEqual(delivery_ids[0], delivery_ids[1])
        for value in delivery_ids:
            self.assertTrue(value.startswith("fallback-"))
            self.assertLessEqual(len(value), 256)

    async def test_claim_stale_posts_to_the_stale_endpoint(self):
        client = object.__new__(worker.AppClient)
        client.worker_id = "fallback-worker"
        calls = []

        async def execute_post(path, payload, **_kwargs):
            calls.append((path, payload))
            return {"data": {"disposition": "EXECUTE", "job": {"reference": {}}}}

        client._post = execute_post
        job = await client.claim_stale("fallback-x")
        self.assertEqual(
            calls,
            [
                (
                    "/attempts/claim-stale",
                    {"deliveryId": "fallback-x", "workerId": "fallback-worker"},
                )
            ],
        )
        self.assertEqual(job, {"reference": {}})

        async def skip_post(_path, _payload, **_kwargs):
            return {"data": {"disposition": "SKIP"}}

        client._post = skip_post
        self.assertIsNone(await client.claim_stale("fallback-y"))


class AppClientIdentityTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _config(**overrides):
        base = dict(
            environment="staging",
            cloudflare_account_id="account",
            cloudflare_queue_id="queue",
            cloudflare_queues_token="c" * 64,
            zenguy_api_url="https://staging-app.zenguy.com",
            zenguy_runner_token="r" * 64,
            model_base_url="http://127.0.0.1:1234/v1",
            model_name="qwen/qwen3.8-27b",
            model_api_key="local-runner",
            model_vision=True,
            model_reasoning_effort="xhigh",
            allow_remote_model=False,
            headless=False,
            browser_channel="chrome",
            poll_seconds=5,
            visibility_timeout_ms=900_000,
            worker_id="mac-1",
        )
        base.update(overrides)
        return worker.RunnerConfig(**base)

    async def test_claim_posts_the_configured_worker_id(self):
        client = worker.AppClient(self._config())
        with mock.patch.object(
            worker,
            "_json_request",
            return_value={
                "data": {"disposition": "EXECUTE", "job": {"reference": {}}}
            },
        ) as fake:
            await client.claim("delivery-1", {"kind": "attempt"})

        self.assertEqual(fake.call_args.kwargs["payload"]["workerId"], "mac-1")

    async def test_claim_stale_posts_the_configured_worker_id(self):
        client = worker.AppClient(self._config())
        with mock.patch.object(
            worker,
            "_json_request",
            return_value={
                "data": {"disposition": "EXECUTE", "job": {"reference": {}}}
            },
        ) as fake:
            await client.claim_stale("delivery-2")

        self.assertEqual(fake.call_args.kwargs["payload"]["workerId"], "mac-1")

    def test_heartbeat_sync_posts_to_the_heartbeat_endpoint(self):
        client = worker.AppClient(self._config())
        payload = {
            "workerId": "mac-1",
            "mode": "local",
            "version": "v1",
            "startedAt": 1,
        }

        with mock.patch.object(
            worker, "_json_request", return_value={"data": {}}
        ) as fake:
            client.heartbeat_sync(payload)

        args, kwargs = fake.call_args
        self.assertTrue(args[0].endswith("/api/runner/heartbeat"))
        self.assertEqual(kwargs["method"], "POST")
        self.assertEqual(kwargs["timeout"], 10)
        self.assertEqual(kwargs["payload"], payload)
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer " + "r" * 64)


class HeartbeatTests(unittest.TestCase):
    def _app(self, calls, fail=False):
        class FakeApp:
            def heartbeat_sync(self, payload):
                calls.append(payload)
                if fail:
                    raise worker.RetryableRunnerError("down")
        return FakeApp()

    def test_beat_once_posts_the_identity_payload(self):
        calls = []
        beat = worker.Heartbeat(self._app(calls), worker_id="mac-1", mode="local", version="v1", started_at=123)
        self.assertTrue(beat.beat_once())
        self.assertEqual(calls, [{"workerId": "mac-1", "mode": "local", "version": "v1", "startedAt": 123}])

    def test_failures_are_logged_and_do_not_raise(self):
        calls = []
        beat = worker.Heartbeat(self._app(calls, fail=True), worker_id="mac-1", mode="fallback", version="v1", started_at=1)
        with mock.patch.object(worker, "log") as log:
            self.assertFalse(beat.beat_once())
        log.assert_called_once_with("heartbeat_failed", workerId="mac-1", error="RetryableRunnerError")

    def test_http_failures_include_the_response_status(self):
        calls = []

        class FakeApp:
            def heartbeat_sync(self, payload):
                calls.append(payload)
                raise worker.HttpRequestError(401, "unauthorized")

        beat = worker.Heartbeat(
            FakeApp(), worker_id="mac-1", mode="local", version="v1", started_at=1
        )
        with mock.patch.object(worker, "log") as log:
            self.assertFalse(beat.beat_once())
        log.assert_called_once_with(
            "heartbeat_failed", workerId="mac-1", error="HttpRequestError", status=401
        )

    def test_thread_beats_on_the_interval_until_stopped(self):
        calls = []
        reached_three = threading.Event()

        class FakeApp:
            def heartbeat_sync(self, payload):
                calls.append(payload)
                if len(calls) >= 3:
                    reached_three.set()

        beat = worker.Heartbeat(
            FakeApp(), worker_id="mac-1", mode="local", version="v1", started_at=1, interval=0.01
        )
        beat.start()
        self.assertTrue(
            reached_three.wait(5), "heartbeat thread did not reach 3 calls in time"
        )
        beat.stop()
        count = len(calls)
        self.assertGreaterEqual(count, 3)
        time.sleep(0.05)
        self.assertEqual(len(calls), count)


if __name__ == "__main__":
    unittest.main()
