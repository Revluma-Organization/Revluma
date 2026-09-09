from src.config import mlflow_config


def test_tracking_uri_sanitizer_separates_embedded_credentials():
    uri, username, password = mlflow_config._sanitize_tracking_uri(
        "https://example-user:example-password@dagshub.com/team/project.mlflow"
    )

    assert uri == "https://dagshub.com/team/project.mlflow"
    assert username == "example-user"
    assert password == "example-password"
    assert "@" not in uri


def test_configured_mlflow_client_uri_contains_no_userinfo():
    assert "@" not in mlflow_config.MLFLOW_TRACKING_URI
    assert "@" not in mlflow_config.mlflow.get_tracking_uri()


def test_run_url_strips_embedded_tracking_credentials(monkeypatch):
    monkeypatch.setattr(mlflow_config, "IS_REMOTE", True)
    monkeypatch.setattr(
        mlflow_config,
        "MLFLOW_TRACKING_URI",
        "https://example-user:example-password@dagshub.com/team/project.mlflow",
    )

    run_url = mlflow_config.get_run_url("run-123", "experiment-456")

    assert run_url == (
        "https://dagshub.com/team/project/experiments/"
        "#/experiments/experiment-456/runs/run-123"
    )
    assert "example-user" not in run_url
    assert "example-password" not in run_url
    assert "@" not in run_url
