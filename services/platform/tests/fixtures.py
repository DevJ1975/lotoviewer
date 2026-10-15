import uuid

TENANT_A = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
TENANT_B = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
ALICE = uuid.UUID("11111111-0000-0000-0000-00000000a11c")
BOB_SUPERADMIN = uuid.UUID("22222222-0000-0000-0000-000000000b0b")

TENANT_A_FACILITIES = {"A Plant 1", "A Plant 2"}
TENANT_B_FACILITIES = {"B Plant 1"}


def claims_for(user_id: uuid.UUID) -> dict[str, str]:
    return {"sub": str(user_id), "role": "authenticated", "aud": "authenticated"}
