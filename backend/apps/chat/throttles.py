import math
from datetime import timedelta

from django.conf import settings
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import APIException, Throttled
from rest_framework.request import Request
from rest_framework.throttling import BaseThrottle
from rest_framework.views import APIView

from .models import Message


class TokenBudgetExceeded(Throttled):
    """A 429 with our own message and a Retry-After header.

    Skips Throttled's "Expected available in N seconds." suffix, which reads
    badly for a wait measured in hours.
    """

    def __init__(self, wait: float, detail: str) -> None:
        APIException.__init__(self, detail)
        self.wait = math.ceil(wait)


class DailyTokenBudgetThrottle(BaseThrottle):
    """Caps the LLM tokens each user can spend per UTC day.

    Request-rate limits don't bound cost: one question carries ~5k tokens of
    retrieved context and another far less. Summing `Message.tokens_used`, which
    every answer already records, caps spending however requests are spread.

    It's a soft limit: checked before answering, so the answer that crosses the
    line still completes, and parallel requests can overshoot by a few answers.
    That's fine for cost control and avoids locking.
    """

    def allow_request(self, request: Request, view: APIView) -> bool:
        budget = settings.DAILY_TOKEN_BUDGET
        # Staff (the site owner) are exempt; tokens are still recorded per message.
        if not budget or request.user.is_staff:
            return True
        now = timezone.now()
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        used = (
            Message.objects.filter(
                conversation__user=request.user, created_at__gte=day_start
            ).aggregate(total=Sum("tokens_used"))["total"]
            or 0
        )
        if used < budget:
            return True
        # Raise instead of returning False so the user gets a clear message
        # rather than DRF's generic "Request was throttled".
        wait = (day_start + timedelta(days=1) - now).total_seconds()
        hours = math.ceil(wait / 3600)
        raise TokenBudgetExceeded(
            wait=wait,
            detail=(
                f"You've reached today's limit of {budget:,} tokens. "
                f"It resets at midnight UTC (in about {hours} h)."
            ),
        )
