from rest_framework.throttling import UserRateThrottle


class UploadRateThrottle(UserRateThrottle):
    """Per-user limit on uploads (rate: DEFAULT_THROTTLE_RATES["upload"]).

    A UserRateThrottle subclass rather than `throttle_scope`, because the same
    view also serves the document list, which the frontend polls every 2s while
    files process; only POST should count. The view adds it for POST only.
    """

    scope = "upload"
