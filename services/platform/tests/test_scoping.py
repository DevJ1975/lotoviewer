import pytest

from tenancy.models import Facility, Tenant
from tenancy.scoping import UnscopedTenantQueryError
from tests.fixtures import TENANT_A, TENANT_A_FACILITIES, TENANT_B, TENANT_B_FACILITIES

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    "execute",
    [
        pytest.param(lambda qs: list(qs), id="list"),
        pytest.param(lambda qs: qs.count(), id="count"),
        pytest.param(lambda qs: qs.exists(), id="exists"),
        pytest.param(lambda qs: qs.first(), id="first"),
        pytest.param(lambda qs: list(qs.iterator()), id="iterator"),
        pytest.param(lambda qs: qs.get(name="A Plant 1"), id="get"),
        pytest.param(lambda qs: list(qs.values_list("name", flat=True)), id="values_list"),
        pytest.param(lambda qs: qs.update(name="x"), id="update"),
        pytest.param(lambda qs: qs.delete(), id="delete"),
        pytest.param(lambda qs: qs.filter(tenant_id__in=[TENANT_A, TENANT_B]).count(), id="in"),
        pytest.param(lambda qs: qs.exclude(tenant_id=TENANT_B).count(), id="exclude"),
    ],
)
def test_unscoped_queries_never_reach_the_database(execute):
    with pytest.raises(UnscopedTenantQueryError):
        execute(Facility.objects.all())


def test_for_tenant_returns_only_that_tenants_rows():
    names = set(Facility.objects.for_tenant(TENANT_A).values_list("name", flat=True))
    assert names == TENANT_A_FACILITIES


@pytest.mark.parametrize(
    "build",
    [
        pytest.param(lambda: Facility.objects.filter(tenant_id=TENANT_B), id="tenant_id"),
        pytest.param(lambda: Facility.objects.filter(tenant__id=TENANT_B), id="tenant__id"),
        pytest.param(
            lambda: Facility.objects.filter(tenant=Tenant.objects.get(pk=TENANT_B)),
            id="tenant",
        ),
        pytest.param(lambda: Tenant.objects.get(pk=TENANT_B).facilities.all(), id="reverse"),
    ],
)
def test_single_tenant_filters_count_as_scoped(build):
    assert set(build().values_list("name", flat=True)) == TENANT_B_FACILITIES


def test_scope_survives_chaining():
    qs = Facility.objects.for_tenant(TENANT_A).order_by("-name").filter(status="active")
    assert list(qs.values_list("name", flat=True)) == sorted(TENANT_A_FACILITIES, reverse=True)


def test_across_all_tenants_requires_a_reason():
    with pytest.raises(ValueError, match="reason"):
        Facility.objects.across_all_tenants(reason="  ")


def test_across_all_tenants_reads_every_tenant_and_logs_why(caplog):
    caplog.set_level("INFO", logger="tenancy.scoping")
    names = set(
        Facility.objects.across_all_tenants(reason="ops rollup").values_list("name", flat=True)
    )
    assert names == TENANT_A_FACILITIES | TENANT_B_FACILITIES
    assert "ops rollup" in caplog.text


def test_tenants_table_itself_is_not_guarded():
    assert Tenant.objects.count() == 2
