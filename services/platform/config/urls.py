from django.conf import settings
from django.contrib import admin
from django.urls import URLPattern, URLResolver, path

from config.api import api
from config.views import healthz

urlpatterns: list[URLPattern | URLResolver] = [
    path("healthz", healthz, name="healthz"),
    path("api/v1/", api.urls),
]

if settings.ADMIN_ENABLED:
    urlpatterns.append(path("admin/", admin.site.urls))
