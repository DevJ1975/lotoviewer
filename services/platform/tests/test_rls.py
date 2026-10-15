import pytest
from django.db import connection, transaction

from tenancy.models import Facility
from tenancy.rls import RlsSessionError, rls_session
from tenancy.scoping import UnscopedTenantQueryError
from tests.fixtures import (
    ALICE,
    BOB_SUPERADMIN,
    TENANT_A_FACILITIES,
    TENANT_B,
    TENANT_B_FACILITIES,
    claims_for,
)

# rls_session() opens its own transaction, so these tests cannot run inside
# pytest-django's per-test transaction.
pytestmark = pytest.mark.django_db(transaction=True)


def _facility_names() -> set[str]:
    return set(Facility.objects.values_list("name", flat=True))


def test_member_sees_only_their_tenant():
    with rls_session(claims_for(ALICE)):
        assert _facility_names() == TENANT_A_FACILITIES


def test_member_cannot_widen_scope_with_another_tenants_header():
    with rls_session(claims_for(ALICE), active_tenant_id=TENANT_B):
        assert _facility_names() == set()


def test_superadmin_is_narrowed_by_active_tenant_header():
    with rls_session(claims_for(BOB_SUPERADMIN)):
        assert _facility_names() == TENANT_A_FACILITIES | TENANT_B_FACILITIES
    with rls_session(claims_for(BOB_SUPERADMIN), active_tenant_id=TENANT_B):
        assert _facility_names() == TENANT_B_FACILITIES


def test_settings_do_not_leak_past_the_session():
    with rls_session(claims_for(ALICE), active_tenant_id=TENANT_B):
        pass
    with connection.cursor() as cursor:
        cursor.execute(
            "select current_user, coalesce(current_setting('request.jwt.claims', true), ''),"
            " coalesce(current_setting('request.headers', true), '')"
        )
        user, claims, headers = cursor.fetchone()
    assert user != "authenticated"
    assert claims == ""
    assert headers == ""


def test_guard_applies_again_after_the_session():
    with rls_session(claims_for(ALICE)):
        _facility_names()
    with pytest.raises(UnscopedTenantQueryError):
        _facility_names()


def test_exception_inside_session_rolls_back_and_resets_guard():
    with pytest.raises(ZeroDivisionError), rls_session(claims_for(ALICE)):
        1 / 0  # noqa: B018
    with pytest.raises(UnscopedTenantQueryError):
        _facility_names()


def test_refuses_to_nest_inside_an_existing_transaction():
    with transaction.atomic(), pytest.raises(RlsSessionError, match="own transaction"):
        with rls_session(claims_for(ALICE)):
            pass


@pytest.mark.parametrize(
    "claims",
    [
        pytest.param({"role": "authenticated"}, id="missing-sub"),
        pytest.param({"sub": str(ALICE), "role": "service_role"}, id="service-role"),
        pytest.param({"sub": str(ALICE)}, id="missing-role"),
    ],
)
def test_rejects_claims_that_are_not_an_authenticated_user(claims):
    with pytest.raises(RlsSessionError):
        with rls_session(claims):
            pass
