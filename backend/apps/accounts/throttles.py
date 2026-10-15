from typing import TYPE_CHECKING

from rest_framework.request import Request
from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle

if TYPE_CHECKING:
    # Type-only: these classes are in DEFAULT_THROTTLE_CLASSES, which DRF loads
    # while rest_framework.views is still importing, so a runtime import of
    # APIView here would be circular.
    from rest_framework.views import APIView


class StaffExemptMixin:
    """Let staff accounts (the site owner, e.g. from `createsuperuser`) bypass a throttle.

    Limits exist to protect the API quota from the public, not from the owner.
    Anonymous requests are never staff, so per-IP limits on login still apply.
    """

    def allow_request(self, request: Request, view: "APIView") -> bool:
        if getattr(request.user, "is_staff", False):
            return True
        return super().allow_request(request, view)  # type: ignore[misc]


class StaffExemptUserRateThrottle(StaffExemptMixin, UserRateThrottle):
    pass


class StaffExemptScopedRateThrottle(StaffExemptMixin, ScopedRateThrottle):
    pass
