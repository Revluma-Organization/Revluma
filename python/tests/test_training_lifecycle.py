from src.training.lifecycle import PIPELINES, _production_eligible, _run_ids


def _pipeline(name):
    return next(pipeline for pipeline in PIPELINES if pipeline.name == name)


def test_single_model_lifecycle_reads_top_level_training_contract():
    pipeline = _pipeline("abandonment")
    result = {"production_eligible": True, "run_id": "run-1"}

    assert _production_eligible(pipeline, result)
    assert _run_ids(pipeline, result) == {"abandonment": "run-1"}


def test_multi_model_lifecycle_requires_every_sensitivity_gate():
    pipeline = _pipeline("sensitivity")
    result = {
        "pss_metrics": {"production_eligible": True, "run_id": "pss-run"},
        "css_metrics": {"production_eligible": True, "run_id": "css-run"},
        "tss_metrics": {"production_eligible": False, "run_id": "tss-run"},
    }

    assert not _production_eligible(pipeline, result)
    assert _run_ids(pipeline, result) == {
        "sensitivity_pss": "pss-run",
        "sensitivity_css": "css-run",
        "sensitivity_tss": "tss-run",
    }
