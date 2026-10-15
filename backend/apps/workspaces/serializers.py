from rest_framework import serializers

from .models import Workspace


class WorkspaceSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = ["id", "name", "owner", "role", "created_at"]
        read_only_fields = ["id", "owner", "role", "created_at"]

    def get_role(self, obj: Workspace) -> str | None:
        user = self.context["request"].user
        membership = next((m for m in obj.memberships.all() if m.user_id == user.id), None)
        return membership.role if membership else None
