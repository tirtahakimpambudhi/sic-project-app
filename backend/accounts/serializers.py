from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Role, User


class UserSerializer(serializers.ModelSerializer):
    """Profile of the signed-in user (login response and /auth/me/)."""

    class Meta:
        model = User
        fields = ("id", "username", "first_name", "last_name", "role")


class SlopTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds the user profile to the login response so the SPA can route by role immediately."""

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class ManagedUserSerializer(serializers.ModelSerializer):
    """User administration (Operator only). The password is write-only and always hashed."""

    password = serializers.CharField(write_only=True, required=False, allow_blank=False, trim_whitespace=False)
    full_name = serializers.SerializerMethodField()
    is_self = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id", "username", "first_name", "last_name", "full_name", "role",
            "is_active", "is_self", "last_login", "date_joined", "password",
        )
        read_only_fields = ("last_login", "date_joined")

    def get_full_name(self, obj: User) -> str:
        return obj.get_full_name() or obj.username

    def get_is_self(self, obj: User) -> bool:
        request = self.context.get("request")
        return bool(request and request.user.pk == obj.pk)

    # -- validation -------------------------------------------------------------------------------
    def validate_username(self, value: str) -> str:
        return value.strip()

    def validate(self, attrs):
        password = attrs.get("password")
        if self.instance is None and not password:
            raise serializers.ValidationError({"password": "Kata sandi wajib diisi untuk pengguna baru."})
        if password:
            validate_password(password, user=self.instance or User(username=attrs.get("username", "")))

        if self.instance is not None:
            self._guard_account_safety(self.instance, attrs)
        return attrs

    def _guard_account_safety(self, user: User, attrs: dict) -> None:
        """Prevent lock-outs: nobody can demote/deactivate themselves or the last active Operator."""
        new_role = attrs.get("role", user.role)
        new_active = attrs.get("is_active", user.is_active)
        loses_operator_power = user.role == Role.OPERATOR and (new_role != Role.OPERATOR or not new_active)
        if not loses_operator_power:
            return

        if self.context["request"].user.pk == user.pk:
            raise serializers.ValidationError(
                {"detail": "Anda tidak dapat menurunkan role atau menonaktifkan akun Anda sendiri."}
            )
        other_operators = User.objects.filter(role=Role.OPERATOR, is_active=True).exclude(pk=user.pk).exists()
        if not other_operators:
            raise serializers.ValidationError({"detail": "Minimal harus ada satu Operator aktif."})

    # -- persistence ------------------------------------------------------------------------------
    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.is_staff = user.role == Role.OPERATOR  # Django admin access follows the role
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.is_staff = instance.role == Role.OPERATOR
        if password:
            instance.set_password(password)
        instance.save()
        return instance
