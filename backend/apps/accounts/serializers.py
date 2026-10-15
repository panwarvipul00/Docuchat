from django.contrib.auth import password_validation
from django.db import transaction
from rest_framework import serializers

from apps.workspaces.services import create_default_workspace

from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name", "date_joined"]
        read_only_fields = fields


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "password"]

    def validate_email(self, value: str) -> str:
        value = value.lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs: dict) -> dict:
        password_validation.validate_password(
            attrs["password"], User(email=attrs["email"], full_name=attrs.get("full_name", ""))
        )
        return attrs

    @transaction.atomic
    def create(self, validated_data: dict) -> User:
        user = User.objects.create_user(**validated_data)
        create_default_workspace(user)
        return user
