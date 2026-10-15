"""Read-only, unmanaged views of Supabase-owned tables.

Supabase SQL migrations (apps/web/migrations) own these tables; Django never
creates, alters or writes them, which is why every model is
`managed = False`. Only the columns this service needs are mapped — an
unmanaged model may safely omit columns, but must never declare one that
does not exist. Keep field definitions in step with the migration named in
each docstring.
"""

from __future__ import annotations

from django.db import models

from tenancy.scoping import TenantScopedQuerySet


class Tenant(models.Model):
    """public.tenants — migration 027 (+083, 164, 283)."""

    id = models.UUIDField(primary_key=True)
    tenant_number = models.TextField(null=True)
    slug = models.TextField(unique=True)
    name = models.TextField()
    status = models.TextField()
    is_demo = models.BooleanField()
    disabled_at = models.DateTimeField(null=True)
    modules = models.JSONField()
    settings = models.JSONField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "tenants"
        ordering = ("tenant_number",)

    def __str__(self) -> str:
        return f"#{self.tenant_number} {self.name}" if self.tenant_number else self.name


class Profile(models.Model):
    """public.profiles — migration 003 (+027 is_superadmin)."""

    id = models.UUIDField(primary_key=True)
    email = models.TextField(unique=True)
    full_name = models.TextField(null=True)
    is_superadmin = models.BooleanField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "profiles"

    def __str__(self) -> str:
        return self.email


class TenantMembership(models.Model):
    """public.tenant_memberships — migration 027 (+190 invite columns)."""

    pk = models.CompositePrimaryKey("user_id", "tenant_id")
    user = models.ForeignKey(Profile, on_delete=models.DO_NOTHING, db_column="user_id")
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.DO_NOTHING,
        db_column="tenant_id",
        related_name="memberships",
    )
    role = models.TextField()
    invite_cancelled_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField()

    objects = TenantScopedQuerySet["TenantMembership"].as_manager()

    class Meta:
        managed = False
        db_table = "tenant_memberships"

    def __str__(self) -> str:
        return f"{self.user_id} @ {self.tenant_id} ({self.role})"


class Facility(models.Model):
    """public.facilities — migration 209."""

    id = models.UUIDField(primary_key=True)
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.DO_NOTHING,
        db_column="tenant_id",
        related_name="facilities",
    )
    name = models.TextField()
    code = models.TextField(null=True)
    is_primary = models.BooleanField()
    status = models.TextField()
    created_at = models.DateTimeField()

    objects = TenantScopedQuerySet["Facility"].as_manager()

    class Meta:
        managed = False
        db_table = "facilities"
        verbose_name_plural = "facilities"

    def __str__(self) -> str:
        return self.name


class AiInvocation(models.Model):
    """public.ai_invocations — migration 047 (+128 cache columns)."""

    id = models.BigAutoField(primary_key=True)
    user_id = models.UUIDField()
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.DO_NOTHING,
        db_column="tenant_id",
        null=True,
        related_name="ai_invocations",
    )
    surface = models.TextField()
    model = models.TextField()
    status = models.TextField()
    input_tokens = models.IntegerField(null=True)
    output_tokens = models.IntegerField(null=True)
    cache_read_tokens = models.IntegerField(null=True)
    cache_write_tokens = models.IntegerField(null=True)
    occurred_at = models.DateTimeField()

    objects = TenantScopedQuerySet["AiInvocation"].as_manager()

    class Meta:
        managed = False
        db_table = "ai_invocations"

    def __str__(self) -> str:
        return f"{self.surface} · {self.model} · {self.status}"


class CronRun(models.Model):
    """public.cron_runs — migration 056. Platform-wide, not tenant-owned."""

    id = models.BigAutoField(primary_key=True)
    cron_path = models.TextField()
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True)
    status = models.TextField(null=True)
    summary = models.TextField(null=True)
    trigger = models.TextField()

    class Meta:
        managed = False
        db_table = "cron_runs"
        ordering = ("-started_at",)

    def __str__(self) -> str:
        return f"{self.cron_path} @ {self.started_at:%Y-%m-%d %H:%M}"
