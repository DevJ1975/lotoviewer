from django.urls import path

from studio import views

urlpatterns = [
    path("", views.modules, name="modules"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("modules/<uuid:module_id>/", views.module_board, name="module_board"),
    path("modules/<uuid:module_id>/decide/", views.decide_asset, name="decide_asset"),
    path("jobs/", views.jobs, name="jobs"),
    path("healthz", views.healthz, name="healthz"),
]
