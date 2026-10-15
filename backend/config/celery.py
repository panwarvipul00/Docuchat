"""Celery app. Tasks are added in Phase 2; the worker container runs this now so
the compose stack is complete."""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("docuchat")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
