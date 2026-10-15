from django.conf import settings
from django.contrib import admin
from django.urls import URLPattern, URLResolver, path

from config.views import healthz

urlpatterns: list[URLPattern | URLResolver] = [
    path("healthz", healthz, name="healthz"),
]

if settings.ADMIN_ENABLED:
    urlpatterns.append(path("admin/", admin.site.urls))
