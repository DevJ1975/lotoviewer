import logging

from django.contrib import messages
from django.contrib.auth import login, logout
from django.http import Http404, HttpResponse, HttpResponseForbidden
from django.shortcuts import redirect, render
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from . import auth, supabase
from .content import board_assets, set_approval
from .models import AssetApproval, MediaJob

log = logging.getLogger(__name__)


def _client_ip(request) -> str:
    return request.META.get("REMOTE_ADDR", "")


def _access(request) -> auth.Access:
    return auth.Access.from_session(request.session.get("access"))


@require_GET
def healthz(request):
    return HttpResponse("ok", content_type="text/plain")


@require_http_methods(["GET", "POST"])
def login_view(request):
    next_url = request.POST.get("next") or request.GET.get("next") or "/"
    if not url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}):
        next_url = "/"
    error = None
    if request.method == "POST":
        email = request.POST.get("email", "").strip()
        password = request.POST.get("password", "")
        try:
            user, supabase_user_id, access = auth.authenticate_supabase_user(
                email, password, _client_ip(request))
        except supabase.InvalidCredentials:
            error = "Email or password is incorrect."
        except auth.NotAuthorized:
            error = "Media Studio is limited to platform superadmins and studio tenant admins."
        except auth.TooManyAttempts:
            error = "Too many attempts. Wait 15 minutes and try again."
        except (supabase.SupabaseError, supabase.httpx.HTTPError):
            log.exception("Sign-in failed")
            error = "Sign-in is unavailable right now. Try again shortly."
        else:
            login(request, user)
            request.session["supabase_user_id"] = supabase_user_id
            request.session["access"] = access.to_session()
            request.session["access_checked_at"] = timezone.now().timestamp()
            return redirect(next_url)
    return render(request, "studio/login.html", {"error": error, "next": next_url})


@require_POST
def logout_view(request):
    logout(request)
    return redirect("/login/")


@require_GET
def modules(request):
    access = _access(request)
    try:
        rows = supabase.list_modules(include_global=access.superadmin,
                                     tenant_ids=set(access.admin_tenant_ids))
    except (supabase.SupabaseError, supabase.httpx.HTTPError) as error:
        return render(request, "studio/modules.html", {"modules": [], "error": str(error)})
    for row in rows:
        versions = sorted(row.get("strike_module_versions") or [], key=lambda v: v["version_number"])
        row["latest"] = versions[-1] if versions else None
        assets = board_assets((row["latest"] or {}).get("content") or {"blocks": []})
        row["pending"] = sum(1 for a in assets if a.ai_generated and not a.approved_at)
        row["asset_count"] = len(assets)
    return render(request, "studio/modules.html", {"modules": rows})


def _load_board(request, module_id: str):
    module = supabase.get_module(module_id)
    if not module:
        raise Http404("No such module")
    if not _access(request).can_edit(module):
        return module, None
    versions = sorted(module.get("strike_module_versions") or [], key=lambda v: v["version_number"])
    editable = [v for v in versions if v["status"] in supabase.EDITABLE_STATUSES]
    version = editable[-1] if editable else (versions[-1] if versions else None)
    return module, version


@require_GET
def module_board(request, module_id: str):
    module, version = _load_board(request, module_id)
    if version is None and not _access(request).can_edit(module):
        return HttpResponseForbidden("You cannot review this module.")
    assets, video_url = [], None
    if version:
        for asset in board_assets(version.get("content") or {"blocks": []}):
            assets.append({
                "asset": asset,
                "url": supabase.signed_url(asset.path),
                "captions_url": supabase.signed_url(asset.captions_path) if asset.captions_path else None,
            })
        if version.get("download_path"):
            video_url = supabase.signed_url(version["download_path"])
    history = AssetApproval.objects.filter(module_slug=module["slug"])[:25]
    return render(request, "studio/board.html", {
        "module": module, "version": version, "assets": assets, "video_url": video_url,
        "editable": bool(version and version["status"] in supabase.EDITABLE_STATUSES),
        "history": history,
    })


@require_POST
def decide_asset(request, module_id: str):
    module, version = _load_board(request, module_id)
    if version is None:
        return HttpResponseForbidden("You cannot review this module.")
    asset_path = request.POST.get("asset_path", "")
    kind = request.POST.get("kind", "")
    decision = request.POST.get("decision", "")
    notes = request.POST.get("notes", "").strip()[:2000]
    if kind not in AssetApproval.Kind.values or decision not in AssetApproval.Decision.values:
        return HttpResponse("Unknown asset kind or decision.", status=400)
    if decision == AssetApproval.Decision.REJECTED and not notes:
        messages.error(request, "Say what needs to change when rejecting an asset.")
        return redirect("module_board", module_id=module_id)

    approved = decision == AssetApproval.Decision.APPROVED
    if kind != AssetApproval.Kind.VIDEO:
        stamp = timezone.now().isoformat() if approved else None
        content, matched = set_approval(version.get("content") or {"blocks": []}, asset_path,
                                        request.user.email if approved else None, stamp)
        if matched == 0:
            return HttpResponse("That asset is not part of this version.", status=400)
        try:
            supabase.update_editable_version(version["id"], {"content": content})
        except supabase.PublishedVersionError as error:
            messages.error(request, str(error))
            return redirect("module_board", module_id=module_id)
    elif asset_path != version.get("download_path"):
        return HttpResponse("That video is not part of this version.", status=400)

    AssetApproval.objects.create(
        module_slug=module["slug"], version_number=version["version_number"],
        asset_path=asset_path, kind=kind, decision=decision, approved_by=request.user.email,
        approved_by_id=request.session.get("supabase_user_id", ""), notes=notes)
    messages.success(request, f"{'Approved' if approved else 'Rejected'} {asset_path}.")
    return redirect("module_board", module_id=module_id)


@require_GET
def jobs(request):
    return render(request, "studio/jobs.html", {"jobs": MediaJob.objects.all()[:100]})
