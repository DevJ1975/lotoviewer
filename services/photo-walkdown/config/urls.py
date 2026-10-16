from django.urls import path

from walkdown import views

urlpatterns = [
    path("", views.departments, name="departments"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("d/<slug:slug>/", views.department, name="department"),
    path("m/<int:pk>/", views.machine, name="machine"),
    path("m/<int:pk>/status/", views.machine_status, name="machine_status"),
    path("thumb/<int:pk>/<str:slot>.jpg", views.thumb, name="thumb"),
    path("search/", views.search, name="search"),
    path("sync/", views.sync_page, name="sync"),
    path("offline/", views.offline, name="offline"),
    path("precache/<slug:slug>.json", views.precache_manifest, name="precache"),
    path("export/photo-audit.json", views.export_photo_audit, name="export_photo_audit"),
    path("report/", views.report, name="report"),
    path("report/download.<str:fmt>", views.report_download, name="report_download"),
    path("r/<str:token>/", views.client_report, name="client_report"),
    path("api/captures/", views.api_capture, name="api_capture"),
    path("sw.js", views.service_worker, name="service_worker"),
    path("manifest.webmanifest", views.web_manifest, name="manifest"),
    path("healthz", views.healthz, name="healthz"),
]
