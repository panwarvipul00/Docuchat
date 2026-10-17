from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import HttpRequest, JsonResponse
from django.urls import include, path


def health(request: HttpRequest) -> JsonResponse:
    """Liveness check for the hosting platform. A plain Django view, so it skips
    DRF's auth and rate limits."""
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.workspaces.urls")),
    path("api/", include("apps.documents.urls")),
    path("api/", include("apps.chat.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
